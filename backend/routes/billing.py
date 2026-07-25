from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from database import get_db
from models.stage3 import SalesBill, SalesBillItem, Medicine, MedicineBatch, Procedure, StockLedger
from models.people import PetOwner
from models.masters import GstRate
from models.clinic import ClinicSetup
from models.accounts import GLPosting
from schemas.billing import SalesBillCreate, SalesBillOut
from utils.billing import calculate_line_item, calculate_bill_totals
from utils.stock import post_stock_ledger
from utils.doc_sequence import get_next_doc_no
from utils.gl_utils import create_gl_account, get_gl_by_code, get_current_fy
from models.users import User

router = APIRouter(prefix="/billing/sales", tags=["Billing"])


def _post_sales_bill_to_gl(db: Session, bill: SalesBill, owner: PetOwner, processed_lines: list, totals: dict):
    """Post a confirmed Sales Bill to the General Ledger.

    DR the owner's Debtor account for the full amount owed (net_payable), CR Sales
    revenue (split Medicine vs Procedure lines into SALES-MED / SALES-VET so P&L can
    tell them apart) and CR the GST payable accounts for the tax collected. Any
    rounding difference (net_payable is rounded to the nearest rupee, the revenue/tax
    legs aren't) is folded into the revenue leg so the entry balances exactly.

    Silently skips (no GL posting, bill still saves) if there's no owner or no active
    Financial Year configured — see chart_of_accounts.md project memory for why this is
    a known limitation rather than a hard failure.
    """
    if not owner:
        return
    fy = get_current_fy(db)
    if not fy:
        return

    if not owner.gl_account_id:
        owner.gl_account_id = create_gl_account("owner", owner.name, db)
        db.flush()

    med_taxable = sum(Decimal(str(l["taxable_amt"])) for l in processed_lines if l["line_type"] == "Medicine")
    proc_taxable = sum(Decimal(str(l["taxable_amt"])) for l in processed_lines if l["line_type"] == "Procedure")
    cgst_amt = Decimal(str(totals.get("cgst_amt", 0)))
    sgst_amt = Decimal(str(totals.get("sgst_amt", 0)))
    igst_amt = Decimal(str(totals.get("igst_amt", 0)))
    round_off = Decimal(str(totals.get("round_off", 0)))
    net_payable = Decimal(str(totals.get("net_payable", 0)))

    if net_payable == 0:
        return

    # Fold the rounding difference into whichever revenue leg is in use so DR == CR exactly.
    if med_taxable != 0:
        med_taxable += round_off
    elif proc_taxable != 0:
        proc_taxable += round_off
    else:
        med_taxable += round_off

    def _gl_or_raise(code: str) -> int:
        gl_id = get_gl_by_code(db, code)
        if not gl_id:
            raise HTTPException(500, f"GL account '{code}' not found — check Chart of Accounts setup (see migrations/seed_gl_master.sql)")
        return gl_id

    common = dict(fy_code=fy.fy_code, posting_date=bill.bill_date, voucher_type="SalesBill",
                  voucher_no=bill.bill_number, voucher_ref_id=bill.bill_id, narration=f"Sales Bill {bill.bill_number}")

    db.add(GLPosting(**common, gl_id=owner.gl_account_id, dr_amount=net_payable, cr_amount=0))
    if med_taxable > 0:
        db.add(GLPosting(**common, gl_id=_gl_or_raise("SALES-MED"), dr_amount=0, cr_amount=med_taxable))
    if proc_taxable > 0:
        db.add(GLPosting(**common, gl_id=_gl_or_raise("SALES-VET"), dr_amount=0, cr_amount=proc_taxable))
    if cgst_amt > 0:
        db.add(GLPosting(**common, gl_id=_gl_or_raise("GST-CGST-PAY"), dr_amount=0, cr_amount=cgst_amt))
    if sgst_amt > 0:
        db.add(GLPosting(**common, gl_id=_gl_or_raise("GST-SGST-PAY"), dr_amount=0, cr_amount=sgst_amt))
    if igst_amt > 0:
        db.add(GLPosting(**common, gl_id=_gl_or_raise("GST-IGST-PAY"), dr_amount=0, cr_amount=igst_amt))

    bill.fy_code = fy.fy_code


def _reverse_sales_bill_gl(db: Session, bill_id: int):
    db.query(GLPosting).filter(GLPosting.voucher_type == "SalesBill", GLPosting.voucher_ref_id == bill_id).delete()


def _valid_created_by(db: Session):
    """Return a real users.user_id in THIS (tenant) DB, else None.

    Bills are saved into a per-tenant company DB whose users table may not
    contain user_id=1, so hardcoding it triggers a FK violation. We fall back
    to the first existing user, or None (the created_by column is nullable)."""
    row = db.query(User.user_id).order_by(User.user_id).first()
    return row[0] if row else None

@router.post("/confirm", response_model=SalesBillOut)
def confirm_sales_bill(data: SalesBillCreate, db: Session = Depends(get_db)):
    """Creates and CONFIRMS a sales bill. Posts to stock ledger immediately."""
    created_by = _valid_created_by(db)
    clinic = db.query(ClinicSetup).first()
    if not clinic: raise HTTPException(400, "Clinic Setup missing")
    
    owner = db.query(PetOwner).filter(PetOwner.owner_id == data.owner_id).first()
    is_interstate = False
    if owner and owner.state_code and clinic.state_code:
        is_interstate = (owner.state_code != clinic.state_code)

    processed_lines = []
    
    for line in data.items:
        gst_rate_id = None
        hsn_code = ""
        description = ""
        unit = ""
        
        if line.line_type == 'Medicine':
            m = db.query(Medicine).filter(Medicine.medicine_id == line.medicine_id).first()
            if not m: raise HTTPException(404, f"Medicine {line.medicine_id} not found")
            gst_rate_id = m.gst_rate_id
            hsn_code = m.hsn.hsn_code if m.hsn else ""
            description = m.medicine_name
            unit = m.unit.unit_name if m.unit else ""
            
            batch = db.query(MedicineBatch).filter(MedicineBatch.batch_id == line.batch_id).first()
            if not batch: raise HTTPException(404, f"Batch {line.batch_id} not found")
            if batch.current_qty < line.qty:
                raise HTTPException(422, f"Insufficient stock: {m.medicine_name}")

        elif line.line_type == 'Procedure':
            p = db.query(Procedure).filter(Procedure.procedure_id == line.procedure_id).first()
            if not p: raise HTTPException(404, f"Procedure {line.procedure_id} not found")
            gst_rate_id = p.gst_rate_id
            hsn_code = p.hsn.hsn_code if p.hsn else ""
            description = p.procedure_name

        gst_rate = db.query(GstRate).filter(GstRate.gst_rate_id == gst_rate_id).first()
        if not gst_rate: raise HTTPException(400, "GST Rate missing")
            
        calc = calculate_line_item(line.rate, line.qty, line.discount_pct, gst_rate, is_interstate)

        # Without-GST mode: zero out all tax fields, line total = taxable amount only
        if not data.with_gst:
            calc.update({
                "cgst_pct": 0, "cgst_amt": 0,
                "sgst_pct": 0, "sgst_amt": 0,
                "igst_pct": 0, "igst_amt": 0,
                "total_tax": 0,
                "line_total": calc["taxable_amt"],
            })
        
        item_data = {
            **line.model_dump(),
            **calc,
            "description": description,
            "hsn_code": hsn_code,
            "unit": unit,
            "gst_rate_id": gst_rate_id,
            "gst_pct": gst_rate.gst_percent
        }
        processed_lines.append(item_data)

    totals = calculate_bill_totals(processed_lines)
    
    bill_no = get_next_doc_no(db, "SB")
    bill = SalesBill(
        **data.model_dump(exclude={"items", "with_gst"}),
        **totals,
        bill_number=bill_no,
        is_interstate=is_interstate,
        status="Confirmed",
        created_by=created_by
    )
    db.add(bill)
    db.flush()

    for i_data in processed_lines:
        item = SalesBillItem(**i_data, bill_id=bill.bill_id)
        db.add(item)

        if item.line_type == 'Medicine':
            post_stock_ledger(
                db, item.medicine_id, item.batch_id,
                txn_type="SALE", qty=item.qty,
                ref_type="SalesBill", ref_id=bill.bill_id, ref_number=bill.bill_number,
                created_by=created_by
            )

    _post_sales_bill_to_gl(db, bill, owner, processed_lines, totals)

    db.commit()
    db.refresh(bill)
    return bill

@router.get("/", response_model=List[SalesBillOut])
def list_bills(db: Session = Depends(get_db)):
    return db.query(SalesBill).options(
        joinedload(SalesBill.owner),
        joinedload(SalesBill.pet),
        joinedload(SalesBill.doctor),
        joinedload(SalesBill.items)
    ).order_by(SalesBill.created_at.desc()).all()

@router.get("/{bill_id}", response_model=SalesBillOut)
def get_bill(bill_id: int, db: Session = Depends(get_db)):
    bill = db.query(SalesBill).options(
        joinedload(SalesBill.owner),
        joinedload(SalesBill.pet),
        joinedload(SalesBill.doctor),
        joinedload(SalesBill.items)
    ).filter(SalesBill.bill_id == bill_id).first()
    if not bill: raise HTTPException(404, "Bill not found")
    return bill

@router.get("/by-number/{bill_number}", response_model=SalesBillOut)
def get_bill_by_number(bill_number: str, db: Session = Depends(get_db)):
    bill = db.query(SalesBill).options(
        joinedload(SalesBill.owner),
        joinedload(SalesBill.pet),
        joinedload(SalesBill.doctor),
        joinedload(SalesBill.items)
    ).filter(SalesBill.bill_number == bill_number).first()
    if not bill: raise HTTPException(404, "Bill not found")
    return bill

@router.put("/{bill_id}", response_model=SalesBillOut)
def update_sales_bill(bill_id: int, data: SalesBillCreate, db: Session = Depends(get_db)):
    bill = db.query(SalesBill).filter(SalesBill.bill_id == bill_id).first()
    if not bill: raise HTTPException(404, "Bill not found")
    
    # 1. REVERSE STOCK
    old_items = db.query(SalesBillItem).filter(SalesBillItem.bill_id == bill_id).all()
    for item in old_items:
        if item.line_type == 'Medicine':
            batch = db.query(MedicineBatch).filter_by(batch_id=item.batch_id).first()
            if batch: batch.current_qty += item.qty
            med = db.query(Medicine).filter_by(medicine_id=item.medicine_id).first()
            if med: med.current_stock += item.qty
    
    # Delete old items, ledger, and GL postings — re-posted fresh below from the new totals
    db.query(SalesBillItem).filter(SalesBillItem.bill_id == bill_id).delete()
    db.query(StockLedger).filter(StockLedger.ref_type == "SalesBill", StockLedger.ref_id == bill_id).delete()
    _reverse_sales_bill_gl(db, bill_id)

    # 2. APPLY NEW DATA (Same as POST but keep bill_id/bill_number)
    clinic = db.query(ClinicSetup).first()
    owner = db.query(PetOwner).filter(PetOwner.owner_id == data.owner_id).first()
    is_interstate = (owner.state_code != clinic.state_code) if (owner and owner.state_code and clinic.state_code) else False

    processed_lines = []
    for line in data.items:
        # (Abridged logic for brevity, matches POST)
        gst_rate = None
        if line.line_type == 'Medicine':
            m = db.query(Medicine).filter(Medicine.medicine_id == line.medicine_id).first()
            gst_rate_id = m.gst_rate_id
            description, hsn, unit = m.medicine_name, (m.hsn.hsn_code if m.hsn else ""), (m.unit.unit_name if m.unit else "")
        else:
            p = db.query(Procedure).filter(Procedure.procedure_id == line.procedure_id).first()
            gst_rate_id = p.gst_rate_id
            description, hsn, unit = p.procedure_name, (p.hsn.hsn_code if p.hsn else ""), ""

        gst_rate = db.query(GstRate).filter(GstRate.gst_rate_id == gst_rate_id).first()
        calc = calculate_line_item(line.rate, line.qty, line.discount_pct, gst_rate, is_interstate)

        # Without-GST mode: zero out all tax fields
        if not data.with_gst:
            calc.update({
                "cgst_pct": 0, "cgst_amt": 0,
                "sgst_pct": 0, "sgst_amt": 0,
                "igst_pct": 0, "igst_amt": 0,
                "total_tax": 0,
                "line_total": calc["taxable_amt"],
            })

        processed_lines.append({**line.model_dump(), **calc, "description": description, "hsn_code": hsn, "unit": unit, "gst_rate_id": gst_rate_id, "gst_pct": gst_rate.gst_percent})

    totals = calculate_bill_totals(processed_lines)
    
    # Update header
    for key, val in data.model_dump(exclude={"items", "with_gst"}).items():
        setattr(bill, key, val)
    for key, val in totals.items():
        setattr(bill, key, val)
    bill.is_interstate = is_interstate
    
    for i_data in processed_lines:
        item = SalesBillItem(**i_data, bill_id=bill.bill_id)
        db.add(item)
        if item.line_type == 'Medicine':
            post_stock_ledger(db, item.medicine_id, item.batch_id, txn_type="SALE", qty=item.qty, ref_type="SalesBill", ref_id=bill.bill_id, ref_number=bill.bill_number, created_by=_valid_created_by(db))

    _post_sales_bill_to_gl(db, bill, owner, processed_lines, totals)

    db.commit()
    db.refresh(bill)
    return bill

@router.delete("/{bill_id}")
def delete_sales_bill(bill_id: int, db: Session = Depends(get_db)):
    bill = db.query(SalesBill).filter(SalesBill.bill_id == bill_id).first()
    if not bill: raise HTTPException(404, "Bill not found")
    
    items = db.query(SalesBillItem).filter(SalesBillItem.bill_id == bill_id).all()
    for item in items:
        if item.line_type == 'Medicine':
            batch = db.query(MedicineBatch).filter_by(batch_id=item.batch_id).first()
            if batch: batch.current_qty += item.qty
            med = db.query(Medicine).filter_by(medicine_id=item.medicine_id).first()
            if med: med.current_stock += item.qty
                
    db.query(StockLedger).filter(StockLedger.ref_type == "SalesBill", StockLedger.ref_id == bill_id).delete()
    _reverse_sales_bill_gl(db, bill_id)
    db.delete(bill)
    db.commit()
    return {"message": "Sales bill deleted"}
