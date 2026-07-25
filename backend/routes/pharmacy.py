"""routes/pharmacy.py — Purchase Bills, Dispensing, and Stock Logic"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

from database import get_db
from models.stage3 import (
    Medicine, MedicineBatch, StockLedger
)
from models.phase3 import (
    Supplier,
    PurchaseBill, PurchaseBillItem,
    PharmacyBill, PharmacyBillItem
)
from models.clinic import ClinicSetup
from models.accounts import GLPosting
from schemas.pharmacy import (
    PurchaseBillCreate, PurchaseBillOut,
    PharmacyBillCreate, PharmacyBillOut
)
from utils.doc_sequence import get_next_doc_no
from utils.stock import post_stock_ledger
from utils.gl_utils import create_gl_account, get_gl_by_code, get_current_fy

router = APIRouter(prefix="/pharmacy", tags=["Pharmacy"])


def _post_purchase_bill_to_gl(db: Session, bill: PurchaseBill, supplier: Supplier, total_taxable: Decimal, total_gst: Decimal, is_interstate: bool):
    """Post a recorded Purchase Bill to the General Ledger.

    DR Medicine Purchases (taxable portion) + DR GST input-credit accounts (the tax
    paid, recoverable), CR the supplier's Creditor account for the full net amount
    owed. Mirrors _post_sales_bill_to_gl in routes/billing.py — see that function's
    docstring and chart_of_accounts.md project memory for the known-limitation notes
    (skips silently if there's no active Financial Year; PurchaseBill has no CGST/SGST/
    IGST split so an intrastate purchase's total_gst is assumed split evenly).
    """
    if not supplier:
        return
    fy = get_current_fy(db)
    if not fy:
        return
    if total_taxable == 0 and total_gst == 0:
        return

    if not supplier.gl_account_id:
        supplier.gl_account_id = create_gl_account("supplier", supplier.supplier_name, db)
        db.flush()

    def _gl_or_raise(code: str) -> int:
        gl_id = get_gl_by_code(db, code)
        if not gl_id:
            raise HTTPException(500, f"GL account '{code}' not found — check Chart of Accounts setup (see migrations/seed_gl_master.sql)")
        return gl_id

    common = dict(fy_code=fy.fy_code, posting_date=bill.bill_date, voucher_type="PurchaseBill",
                  voucher_no=bill.bill_no, voucher_ref_id=bill.bill_id, narration=f"Purchase Bill {bill.bill_no}")

    if total_taxable > 0:
        db.add(GLPosting(**common, gl_id=_gl_or_raise("PURCH-MED"), dr_amount=total_taxable, cr_amount=0))
    if total_gst > 0:
        if is_interstate:
            db.add(GLPosting(**common, gl_id=_gl_or_raise("GST-IGST-IN"), dr_amount=total_gst, cr_amount=0))
        else:
            half = (total_gst / 2).quantize(Decimal("0.01"))
            db.add(GLPosting(**common, gl_id=_gl_or_raise("GST-CGST-IN"), dr_amount=half, cr_amount=0))
            db.add(GLPosting(**common, gl_id=_gl_or_raise("GST-SGST-IN"), dr_amount=(total_gst - half), cr_amount=0))
    db.add(GLPosting(**common, gl_id=supplier.gl_account_id, dr_amount=0, cr_amount=total_taxable + total_gst))

    bill.fy_code = fy.fy_code


def _reverse_purchase_bill_gl(db: Session, bill_id: int):
    db.query(GLPosting).filter(GLPosting.voucher_type == "PurchaseBill", GLPosting.voucher_ref_id == bill_id).delete()


def _is_interstate_purchase(supplier: Optional[Supplier], clinic: Optional[ClinicSetup]) -> bool:
    if supplier and supplier.state_code and clinic and clinic.state_code:
        return supplier.state_code != clinic.state_code
    return False


# ── PURCHASE BILLING (INWARD STOCK) ──────────────────────────
@router.post("/purchase", response_model=PurchaseBillOut)
def record_purchase(data: PurchaseBillCreate, db: Session = Depends(get_db)):
    """Records a purchase bill and adds items to batch-wise stock"""
    bill_no = get_next_doc_no(db, "PUR")
    
    # 1. Create Purchase Bill Header
    bill = PurchaseBill(
        bill_no=bill_no,
        supplier_id=data.supplier_id,
        supplier_invoice_no=data.supplier_invoice_no,
        bill_date=data.bill_date,
        discount_amount=data.discount_amount,
        notes=data.notes,
        status="Completed"
    )
    db.add(bill)
    db.flush() # Get bill_id

    total_net = Decimal("0")
    total_gst = Decimal("0")

    # 2. Process Items
    for item in data.items:
        # Calculate totals
        gross = item.purchase_price * (item.quantity + item.free_quantity)
        gst_amt = gross * (item.gst_pct / 100)
        net = gross + gst_amt
        total_net += net
        total_gst += gst_amt

        # Add Bill Item
        pb_item = PurchaseBillItem(
            bill_id=bill.bill_id,
            medicine_id=item.medicine_id,
            batch_no=item.batch_no,
            mfg_date=item.mfg_date,
            expiry_date=item.expiry_date,
            quantity=item.quantity,
            free_quantity=item.free_quantity,
            purchase_price=item.purchase_price,
            sale_price=item.sale_price,
            gst_pct=item.gst_pct,
            line_total=net
        )
        db.add(pb_item)
        
        # 3. Update Inventory (Batches) — find or create the batch
        total_qty = item.quantity + item.free_quantity
        batch = db.query(MedicineBatch).filter(
            MedicineBatch.medicine_id == item.medicine_id,
            MedicineBatch.batch_no == item.batch_no
        ).first()
        
        if not batch:
            batch = MedicineBatch(
                medicine_id=item.medicine_id,
                batch_no=item.batch_no,
                mfg_date=item.mfg_date,
                expiry_date=item.expiry_date,
                purchase_price=item.purchase_price,
                sale_price=item.sale_price,
                source="Purchase",
                current_qty=Decimal("0")   # post_stock_ledger will add qty
            )
            db.add(batch)
            db.flush()  # get batch_id
        else:
            # Update prices on existing batch
            batch.purchase_price = item.purchase_price
            batch.sale_price = item.sale_price
        
        # 4. Use post_stock_ledger — updates batch.current_qty AND recalculates
        #    medicine.current_stock as sum of ALL batches (opening + purchase)
        post_stock_ledger(
            db,
            medicine_id=item.medicine_id,
            batch_id=batch.batch_id,
            txn_type="PURCHASE",
            qty=float(total_qty),
            ref_type="PUR",
            ref_id=bill.bill_id,
            ref_number=bill.bill_no,
            created_by=1
        )

    bill.net_amount = total_net

    supplier = db.query(Supplier).filter(Supplier.supplier_id == data.supplier_id).first()
    clinic = db.query(ClinicSetup).first()
    is_interstate = _is_interstate_purchase(supplier, clinic)
    _post_purchase_bill_to_gl(db, bill, supplier, total_net - total_gst, total_gst, is_interstate)

    db.commit()
    db.refresh(bill)
    return bill


@router.get("/purchase", response_model=List[PurchaseBillOut])
def list_purchase_bills(
    q: Optional[str] = Query(None),
    supplier_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(PurchaseBill).options(joinedload(PurchaseBill.items))
    if q:
        query = query.filter(
            (PurchaseBill.bill_no.ilike(f"%{q}%")) |
            (PurchaseBill.supplier_invoice_no.ilike(f"%{q}%"))
        )
    if supplier_id:
        query = query.filter(PurchaseBill.supplier_id == supplier_id)
    return query.order_by(PurchaseBill.created_at.desc()).all()


@router.get("/purchase/{bill_id}", response_model=PurchaseBillOut)
def get_purchase_bill(bill_id: int, db: Session = Depends(get_db)):
    bill = db.query(PurchaseBill).options(joinedload(PurchaseBill.items)).filter(PurchaseBill.bill_id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Purchase bill not found")
    return bill


@router.delete("/purchase/{bill_id}")
def delete_purchase_bill(bill_id: int, db: Session = Depends(get_db)):
    bill = db.query(PurchaseBill).filter(PurchaseBill.bill_id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
    
    # Stock Reversal — use post_stock_ledger so current_stock is recalculated from sum
    items = db.query(PurchaseBillItem).filter(PurchaseBillItem.bill_id == bill_id).all()
    for item in items:
        batch = db.query(MedicineBatch).filter(
            MedicineBatch.medicine_id == item.medicine_id,
            MedicineBatch.batch_no == item.batch_no
        ).first()
        if batch:
            reversal_qty = float(item.quantity + item.free_quantity)
            post_stock_ledger(
                db,
                medicine_id=item.medicine_id,
                batch_id=batch.batch_id,
                txn_type="PURCH_RETURN",
                qty=reversal_qty,
                ref_type="PUR_DEL",
                ref_id=bill_id,
                ref_number=f"DEL-{bill.bill_no}",
                created_by=1
            )
        
        # Delete ledger entries for this bill
        db.query(StockLedger).filter(
            StockLedger.ref_type == "PUR",
            StockLedger.ref_id == bill_id
        ).delete()

    _reverse_purchase_bill_gl(db, bill_id)
    db.delete(bill)
    db.commit()
    return {"message": "Purchase bill deleted and stock reversed"}


@router.put("/purchase/{bill_id}", response_model=PurchaseBillOut)
def update_purchase_bill(bill_id: int, data: PurchaseBillCreate, db: Session = Depends(get_db)):
    """Updates a purchase bill by reversing old stock and applying new data"""
    bill = db.query(PurchaseBill).filter(PurchaseBill.bill_id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")
        
    # 1. Reverse stock for existing items via post_stock_ledger
    old_items = db.query(PurchaseBillItem).filter(PurchaseBillItem.bill_id == bill_id).all()
    for item in old_items:
        batch = db.query(MedicineBatch).filter(
            MedicineBatch.medicine_id == item.medicine_id,
            MedicineBatch.batch_no == item.batch_no
        ).first()
        if batch:
            reversal_qty = float(item.quantity + item.free_quantity)
            post_stock_ledger(
                db,
                medicine_id=item.medicine_id,
                batch_id=batch.batch_id,
                txn_type="PURCH_RETURN",
                qty=reversal_qty,
                ref_type="PUR_REV",
                ref_id=bill_id,
                ref_number=f"REV-{bill.bill_no}",
                created_by=1
            )
        db.query(StockLedger).filter(
            StockLedger.ref_type == "PUR",
            StockLedger.ref_id == bill_id
        ).delete()

    _reverse_purchase_bill_gl(db, bill_id)

    # 2. Clear old items
    db.query(PurchaseBillItem).filter(PurchaseBillItem.bill_id == bill_id).delete()

    # 3. Update header fields
    bill.supplier_id = data.supplier_id
    bill.supplier_invoice_no = data.supplier_invoice_no
    bill.bill_date = data.bill_date
    bill.discount_amount = data.discount_amount
    bill.notes = data.notes
    
    # 4. Re-apply new items using post_stock_ledger
    total_net = Decimal("0")
    total_gst = Decimal("0")
    for item in data.items:
        gross = item.purchase_price * (item.quantity + item.free_quantity)
        gst_amt = gross * (item.gst_pct / 100)
        net = gross + gst_amt
        total_net += net
        total_gst += gst_amt

        pb_item = PurchaseBillItem(
            bill_id=bill.bill_id,
            medicine_id=item.medicine_id,
            batch_no=item.batch_no,
            mfg_date=item.mfg_date,
            expiry_date=item.expiry_date,
            quantity=item.quantity,
            free_quantity=item.free_quantity,
            purchase_price=item.purchase_price,
            sale_price=item.sale_price,
            gst_pct=item.gst_pct,
            line_total=net
        )
        db.add(pb_item)
        
        total_qty = item.quantity + item.free_quantity
        batch = db.query(MedicineBatch).filter(
            MedicineBatch.medicine_id == item.medicine_id,
            MedicineBatch.batch_no == item.batch_no
        ).first()
        if not batch:
            batch = MedicineBatch(
                medicine_id=item.medicine_id,
                batch_no=item.batch_no,
                mfg_date=item.mfg_date,
                expiry_date=item.expiry_date,
                purchase_price=item.purchase_price,
                sale_price=item.sale_price,
                source="Purchase",
                current_qty=Decimal("0")
            )
            db.add(batch)
            db.flush()
        else:
            batch.purchase_price = item.purchase_price
            batch.sale_price = item.sale_price
            
        post_stock_ledger(
            db,
            medicine_id=item.medicine_id,
            batch_id=batch.batch_id,
            txn_type="PURCHASE",
            qty=float(total_qty),
            ref_type="PUR",
            ref_id=bill.bill_id,
            ref_number=bill.bill_no,
            created_by=1
        )

    bill.net_amount = total_net

    supplier = db.query(Supplier).filter(Supplier.supplier_id == bill.supplier_id).first()
    clinic = db.query(ClinicSetup).first()
    is_interstate = _is_interstate_purchase(supplier, clinic)
    _post_purchase_bill_to_gl(db, bill, supplier, total_net - total_gst, total_gst, is_interstate)

    db.commit()
    db.refresh(bill)
    return bill


# ── PHARMACY BILLING (DISPENSING / SALES) ────────────────────
@router.post("/bill", response_model=PharmacyBillOut)
def record_sale(data: PharmacyBillCreate, db: Session = Depends(get_db)):
    """Records a pharmacy bill and deducts items from batch-wise stock"""
    bill_no = get_next_doc_no(db, "PHM")
    
    bill = PharmacyBill(
        pharma_bill_no=bill_no,
        owner_id=data.owner_id,
        pet_id=data.pet_id,
        prescription_id=data.prescription_id,
        bill_date=datetime.now().date(),
        payment_mode=data.payment_mode,
        discount_amount=data.discount_amount,
        status="Completed"
    )
    db.add(bill)
    db.flush()
    
    total_net = Decimal("0")
    
    for item in data.items:
        # Verify Stock Availability
        batch = db.query(MedicineBatch).filter(MedicineBatch.batch_id == item.batch_id).first()
        if not batch or batch.current_qty < item.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock in batch {batch.batch_no if batch else 'N/A'}")
            
        # Calculate item total
        gross = item.sale_price * item.quantity
        disc = gross * (item.discount_pct / 100)
        net = gross - disc
        total_net += net
        
        # Create Bill Line
        med = db.query(Medicine).filter(Medicine.medicine_id == item.medicine_id).first()
        pb_item = PharmacyBillItem(
            pharmacy_bill_id=bill.pharmacy_bill_id,
            medicine_id=item.medicine_id,
            batch_id=item.batch_id,
            medicine_name=med.medicine_name if med else "Unknown",
            batch_no=batch.batch_no,
            expiry_date=batch.expiry_date,
            quantity=item.quantity,
            sale_price=item.sale_price,
            discount_pct=item.discount_pct,
            line_total=net,
            rx_item_id=item.rx_item_id
        )
        db.add(pb_item)
        
        # ── STOCK DEDUCTION via post_stock_ledger (recalculates medicine.current_stock from sum) ──
        post_stock_ledger(
            db,
            medicine_id=item.medicine_id,
            batch_id=batch.batch_id,
            txn_type="SALE",
            qty=float(item.quantity),
            ref_type="PHM",
            ref_id=bill.pharmacy_bill_id,
            ref_number=bill.pharma_bill_no,
            created_by=1
        )

    bill.net_amount = total_net - data.discount_amount
    db.commit()
    db.refresh(bill)
    return bill

@router.get("/bills", response_model=List[PharmacyBillOut])
def list_pharmacy_bills(db: Session = Depends(get_db)):
    return db.query(PharmacyBill).order_by(PharmacyBill.created_at.desc()).all()
