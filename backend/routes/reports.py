from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text
from typing import List, Optional
from datetime import date
from decimal import Decimal

from database import get_db
from models.phase4 import GLMaster, OpeningBalance
from models.accounts import GLPosting
from models.stage3 import SalesBill, SalesBillItem
from models.phase3 import PurchaseBill, PurchaseBillItem, Supplier
from models.clinic import ClinicSetup
from models.accounts import CreditNote, CreditNoteItem, DebitNote, DebitNoteItem
from sqlalchemy import func

router = APIRouter(prefix="/reports", tags=["Reports"])

@router.get("/general-ledger")
def get_general_ledger(
    gl_id: int = Query(..., description="GL Account ID"),
    fy_code: str = Query(..., description="Financial Year Code"),
    from_date: Optional[date] = Query(None, description="From Date"),
    to_date: Optional[date] = Query(None, description="To Date"),
    db: Session = Depends(get_db)
):
    gl_account = db.query(GLMaster).filter(GLMaster.gl_id == gl_id).first()
    if not gl_account:
        raise HTTPException(status_code=404, detail="GL Account not found")

    # Get Opening Balance for this FY
    ob = db.query(OpeningBalance).filter(
        OpeningBalance.gl_id == gl_id,
        OpeningBalance.fy_code == fy_code
    ).first()
    
    opening_dr = Decimal("0.00")
    opening_cr = Decimal("0.00")
    
    if ob:
        if ob.balance_type == "DR":
            opening_dr = ob.amount or Decimal("0.00")
        else:
            opening_cr = ob.amount or Decimal("0.00")
            
    # Also we need to get any postings before from_date if from_date is provided
    # so we can compute the correct opening balance as of from_date.
    if from_date:
        pre_postings = db.query(GLPosting).filter(
            GLPosting.gl_id == gl_id,
            GLPosting.fy_code == fy_code,
            GLPosting.posting_date < from_date
        ).all()
        for p in pre_postings:
            opening_dr += (p.dr_amount or Decimal("0.00"))
            opening_cr += (p.cr_amount or Decimal("0.00"))
            
    # Calculate net opening balance (DR is positive, CR is negative for running balance context, 
    # but let's just present it clearly or compute a single running_balance number)
    # We will assume running_balance is (Total DR - Total CR). 
    running_balance = opening_dr - opening_cr
    
    # Get Transactions in range
    query = db.query(GLPosting).filter(
        GLPosting.gl_id == gl_id,
        GLPosting.fy_code == fy_code
    )
    if from_date:
        query = query.filter(GLPosting.posting_date >= from_date)
    if to_date:
        query = query.filter(GLPosting.posting_date <= to_date)
        
    postings = query.order_by(GLPosting.posting_date.asc(), GLPosting.posting_id.asc()).all()
    
    transactions = []
    for p in postings:
        running_balance += (p.dr_amount or Decimal("0.00")) - (p.cr_amount or Decimal("0.00"))
        transactions.append({
            "posting_date": p.posting_date,
            "voucher_type": p.voucher_type,
            "voucher_no": p.voucher_no,
            "narration": p.narration,
            "dr_amount": p.dr_amount,
            "cr_amount": p.cr_amount,
            "running_balance": running_balance,
            "balance_type": "DR" if running_balance >= 0 else "CR"
        })
        
    return {
        "account": {
            "gl_code": gl_account.gl_code,
            "gl_name": gl_account.gl_name,
            "group_name": gl_account.group_name
        },
        "opening_balance": {
            "dr": opening_dr,
            "cr": opening_cr,
            "net": opening_dr - opening_cr,
            "balance_type": "DR" if (opening_dr - opening_cr) >= 0 else "CR"
        },
        "transactions": transactions,
        "closing_balance": {
            "net": running_balance,
            "balance_type": "DR" if running_balance >= 0 else "CR"
        }
    }

@router.get("/trial-balance")
def get_trial_balance(
    fy_code: str = Query(..., description="Financial Year Code"),
    as_of_date: Optional[date] = Query(None, description="As of Date (defaults to today)"),
    db: Session = Depends(get_db)
):
    if not as_of_date:
        as_of_date = date.today()
        
    # We can do this efficiently using SQL
    sql = text("""
        WITH opening AS (
            SELECT gl_id, 
                   CASE WHEN balance_type = 'DR' THEN amount ELSE 0 END as op_dr,
                   CASE WHEN balance_type = 'CR' THEN amount ELSE 0 END as op_cr
            FROM opening_balances
            WHERE fy_code = :fy_code
        ),
        postings AS (
            SELECT gl_id,
                   SUM(dr_amount) as trx_dr,
                   SUM(cr_amount) as trx_cr
            FROM gl_postings
            WHERE fy_code = :fy_code AND posting_date <= :as_of_date
            GROUP BY gl_id
        ),
        combined AS (
            SELECT m.gl_id, m.gl_code, m.gl_name, m.group_name,
                   COALESCE(o.op_dr, 0) + COALESCE(p.trx_dr, 0) as total_dr,
                   COALESCE(o.op_cr, 0) + COALESCE(p.trx_cr, 0) as total_cr
            FROM gl_master m
            LEFT JOIN opening o ON m.gl_id = o.gl_id
            LEFT JOIN postings p ON m.gl_id = p.gl_id
        ),
        net_balances AS (
            SELECT gl_id, gl_code, gl_name, group_name,
                   CASE WHEN (total_dr - total_cr) > 0 THEN (total_dr - total_cr) ELSE 0 END as closing_dr,
                   CASE WHEN (total_dr - total_cr) < 0 THEN (total_cr - total_dr) ELSE 0 END as closing_cr
            FROM combined
        )
        SELECT * FROM net_balances
        WHERE closing_dr > 0 OR closing_cr > 0
        ORDER BY group_name, gl_name;
    """)
    
    results = db.execute(sql, {"fy_code": fy_code, "as_of_date": as_of_date}).mappings().all()
    
    # Group by group_name
    grouped = {}
    grand_total_dr = Decimal("0.00")
    grand_total_cr = Decimal("0.00")
    
    for row in results:
        gname = row["group_name"] or "Others"
        if gname not in grouped:
            grouped[gname] = []
            
        grouped[gname].append({
            "gl_id": row["gl_id"],
            "gl_code": row["gl_code"],
            "gl_name": row["gl_name"],
            "dr": row["closing_dr"],
            "cr": row["closing_cr"]
        })
        
        grand_total_dr += row["closing_dr"]
        grand_total_cr += row["closing_cr"]
        
    return {
        "groups": [{"group_name": k, "accounts": v} for k, v in grouped.items()],
        "grand_total_dr": grand_total_dr,
        "grand_total_cr": grand_total_cr,
        "is_balanced": grand_total_dr == grand_total_cr,
        "as_of_date": as_of_date
    }

@router.get("/cash-book")
def get_cash_book(
    fy_code: str = Query(..., description="Financial Year Code"),
    from_date: Optional[date] = Query(None, description="From Date"),
    to_date: Optional[date] = Query(None, description="To Date"),
    db: Session = Depends(get_db)
):
    # Find Cash GLs
    cash_gls = db.query(GLMaster).filter(GLMaster.gl_code.like("CASH%")).all()
    if not cash_gls:
        return {"message": "No cash accounts found", "transactions": []}
        
    cash_gl_ids = [gl.gl_id for gl in cash_gls]
    
    # Calculate initial opening balance for all cash accounts combined up to from_date
    opening_dr = Decimal("0.00")
    opening_cr = Decimal("0.00")
    
    ob_records = db.query(OpeningBalance).filter(
        OpeningBalance.gl_id.in_(cash_gl_ids),
        OpeningBalance.fy_code == fy_code
    ).all()
    
    for ob in ob_records:
        if ob.balance_type == "DR":
            opening_dr += (ob.amount or Decimal("0.00"))
        else:
            opening_cr += (ob.amount or Decimal("0.00"))
            
    if from_date:
        pre_postings = db.query(GLPosting).filter(
            GLPosting.gl_id.in_(cash_gl_ids),
            GLPosting.fy_code == fy_code,
            GLPosting.posting_date < from_date
        ).all()
        for p in pre_postings:
            opening_dr += (p.dr_amount or Decimal("0.00"))
            opening_cr += (p.cr_amount or Decimal("0.00"))
            
    running_balance = opening_dr - opening_cr
    
    # Fetch transactions
    query = db.query(GLPosting).filter(
        GLPosting.gl_id.in_(cash_gl_ids),
        GLPosting.fy_code == fy_code
    )
    if from_date:
        query = query.filter(GLPosting.posting_date >= from_date)
    if to_date:
        query = query.filter(GLPosting.posting_date <= to_date)
        
    postings = query.order_by(GLPosting.posting_date.asc(), GLPosting.posting_id.asc()).all()
    
    transactions = []
    daily_summary = {}
    
    for p in postings:
        running_balance += (p.dr_amount or Decimal("0.00")) - (p.cr_amount or Decimal("0.00"))
        date_str = p.posting_date.isoformat()
        
        if date_str not in daily_summary:
            daily_summary[date_str] = {"dr": Decimal("0.00"), "cr": Decimal("0.00")}
        
        daily_summary[date_str]["dr"] += (p.dr_amount or Decimal("0.00"))
        daily_summary[date_str]["cr"] += (p.cr_amount or Decimal("0.00"))
        
        transactions.append({
            "posting_date": p.posting_date,
            "gl_id": p.gl_id,
            "voucher_type": p.voucher_type,
            "voucher_no": p.voucher_no,
            "narration": p.narration,
            "dr_amount": p.dr_amount,
            "cr_amount": p.cr_amount,
            "running_balance": running_balance,
            "balance_type": "DR" if running_balance >= 0 else "CR"
        })
        
    return {
        "opening_balance": {
            "net": opening_dr - opening_cr,
            "balance_type": "DR" if (opening_dr - opening_cr) >= 0 else "CR"
        },
        "daily_summary": daily_summary,
        "transactions": transactions,
        "closing_balance": {
            "net": running_balance,
            "balance_type": "DR" if running_balance >= 0 else "CR"
        }
    }


# ---------------------------------------------------------------------------
# GST Reports Endpoints
# ---------------------------------------------------------------------------
#
# NOTE (2026-07-24): every one of these five endpoints previously referenced
# column names that don't exist on the real models — SalesBill.taxable_amount
# (real column: taxable_amt), SalesBill.bill_no (real: bill_number),
# SalesBill.gstin (real: party_gstin), PetOwner.owner_name (real: name),
# SalesBillItem.quantity (real: qty), and PurchaseBill.taxable_amount /
# cgst_amount / sgst_amount / igst_amount (none of these exist on PurchaseBill
# at all — it only has a blended `gst_amount` column that record_purchase()
# in routes/pharmacy.py never even populates). Every endpoint below raised an
# AttributeError the instant it was called — rewritten against the actual
# schema. Purchase-side taxable/cgst/sgst/igst are recomputed from
# PurchaseBillItem line data (purchase_price × qty, gst_pct) using the same
# formula and interstate CGST+SGST-vs-IGST split as
# routes/pharmacy.py's _post_purchase_bill_to_gl / _is_interstate_purchase.


def _purchase_bill_is_interstate(supplier, clinic) -> bool:
    if supplier and supplier.state_code and clinic and clinic.state_code:
        return supplier.state_code != clinic.state_code
    return False


def _purchase_bill_tax_breakdown(bill, supplier, clinic):
    """Recompute (taxable, cgst, sgst, igst) for one PurchaseBill from its items."""
    taxable = Decimal("0.00")
    total_gst = Decimal("0.00")
    for item in bill.items:
        qty = Decimal(item.quantity or 0) + Decimal(item.free_quantity or 0)
        gross = (item.purchase_price or Decimal("0.00")) * qty
        gst_amt = gross * ((item.gst_pct or Decimal("0.00")) / Decimal("100"))
        taxable += gross
        total_gst += gst_amt

    if _purchase_bill_is_interstate(supplier, clinic):
        return taxable, Decimal("0.00"), Decimal("0.00"), total_gst
    half = (total_gst / 2).quantize(Decimal("0.01"))
    return taxable, half, total_gst - half, Decimal("0.00")


@router.get("/gst/sales-register")
def get_sales_register(
    fy_code: str = Query(..., description="Financial Year Code"),
    from_date: Optional[date] = Query(None, description="From Date"),
    to_date: Optional[date] = Query(None, description="To Date"),
    db: Session = Depends(get_db),
):
    """Sales Register with credit notes as negative rows."""
    sales_q = db.query(SalesBill).options(joinedload(SalesBill.owner)).filter(SalesBill.fy_code == fy_code)
    if from_date:
        sales_q = sales_q.filter(SalesBill.bill_date >= from_date)
    if to_date:
        sales_q = sales_q.filter(SalesBill.bill_date <= to_date)
    sales = sales_q.all()

    cn_q = db.query(CreditNote).filter(CreditNote.fy_code == fy_code)
    if from_date:
        cn_q = cn_q.filter(CreditNote.voucher_date >= from_date)
    if to_date:
        cn_q = cn_q.filter(CreditNote.voucher_date <= to_date)
    credit_notes = cn_q.all()

    rows = []
    for sb in sales:
        taxable = sb.taxable_amt or Decimal("0.00")
        cgst = sb.cgst_amt or Decimal("0.00")
        sgst = sb.sgst_amt or Decimal("0.00")
        igst = sb.igst_amt or Decimal("0.00")
        rows.append({
            "date": sb.bill_date,
            "voucher_no": sb.bill_number,
            "party_name": sb.owner.name if sb.owner else None,
            "gstin": sb.party_gstin,
            "taxable": float(taxable),
            "cgst": float(cgst),
            "sgst": float(sgst),
            "igst": float(igst),
            "total": float(taxable + cgst + sgst + igst),
            "type": "sales",
        })
    for cn in credit_notes:
        taxable = cn.taxable_amount or Decimal("0.00")
        cgst = cn.cgst_amount or Decimal("0.00")
        sgst = cn.sgst_amount or Decimal("0.00")
        igst = cn.igst_amount or Decimal("0.00")
        rows.append({
            "date": cn.voucher_date,
            "voucher_no": cn.voucher_no,
            "party_name": cn.party_name,
            "gstin": cn.gstin,
            "taxable": -float(taxable),
            "cgst": -float(cgst),
            "sgst": -float(sgst),
            "igst": -float(igst),
            "total": -float(taxable + cgst + sgst + igst),
            "type": "credit_note",
        })
    rows.sort(key=lambda r: r["date"])
    return {"sales_register": rows}


@router.get("/gst/b2b")
def get_gst_b2b(
    fy_code: str = Query(..., description="Financial Year Code"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """B2B report – only customers with GSTIN, net of credit notes."""
    sales_q = db.query(SalesBill).options(joinedload(SalesBill.owner)).filter(
        SalesBill.fy_code == fy_code,
        SalesBill.party_gstin != None,
        SalesBill.party_gstin != ""
    )
    if from_date:
        sales_q = sales_q.filter(SalesBill.bill_date >= from_date)
    if to_date:
        sales_q = sales_q.filter(SalesBill.bill_date <= to_date)
    sales = sales_q.all()

    cn_q = db.query(CreditNote).filter(
        CreditNote.fy_code == fy_code,
        CreditNote.gstin != None,
        CreditNote.gstin != ""
    )
    if from_date:
        cn_q = cn_q.filter(CreditNote.voucher_date >= from_date)
    if to_date:
        cn_q = cn_q.filter(CreditNote.voucher_date <= to_date)
    credit_notes = cn_q.all()

    agg = {}
    for sb in sales:
        gstin = sb.party_gstin
        if gstin not in agg:
            agg[gstin] = {"party_name": sb.owner.name if sb.owner else None, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0}
        agg[gstin]["taxable"] += float(sb.taxable_amt or 0)
        agg[gstin]["cgst"] += float(sb.cgst_amt or 0)
        agg[gstin]["sgst"] += float(sb.sgst_amt or 0)
        agg[gstin]["igst"] += float(sb.igst_amt or 0)
    for cn in credit_notes:
        gstin = cn.gstin
        if gstin not in agg:
            agg[gstin] = {"party_name": cn.party_name, "taxable": 0.0, "cgst": 0.0, "sgst": 0.0, "igst": 0.0}
        agg[gstin]["taxable"] -= float(cn.taxable_amount or 0)
        agg[gstin]["cgst"] -= float(cn.cgst_amount or 0)
        agg[gstin]["sgst"] -= float(cn.sgst_amount or 0)
        agg[gstin]["igst"] -= float(cn.igst_amount or 0)

    result = []
    for gstin, vals in agg.items():
        total = vals["taxable"] + vals["cgst"] + vals["sgst"] + vals["igst"]
        result.append({"gstin": gstin, "total": total, **vals})
    return {"b2b": result}


@router.get("/gst/hsn-summary")
def get_hsn_summary(
    fy_code: str = Query(...),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """HSN summary for sales items."""
    q = (
        db.query(
            SalesBillItem.hsn_code.label("hsn_code"),
            func.sum(SalesBillItem.qty).label("total_qty"),
            func.sum(SalesBillItem.taxable_amt).label("total_taxable"),
            func.sum(SalesBillItem.cgst_amt).label("total_cgst"),
            func.sum(SalesBillItem.sgst_amt).label("total_sgst"),
            func.sum(SalesBillItem.igst_amt).label("total_igst"),
        )
        .join(SalesBill, SalesBill.bill_id == SalesBillItem.bill_id)
        .filter(SalesBill.fy_code == fy_code)
    )
    if from_date:
        q = q.filter(SalesBill.bill_date >= from_date)
    if to_date:
        q = q.filter(SalesBill.bill_date <= to_date)
    q = q.group_by(SalesBillItem.hsn_code)
    rows = q.all()
    result = []
    for r in rows:
        taxable = float(r.total_taxable or 0)
        cgst = float(r.total_cgst or 0)
        sgst = float(r.total_sgst or 0)
        igst = float(r.total_igst or 0)
        result.append({
            "hsn_code": r.hsn_code or "—",
            "total_qty": float(r.total_qty or 0),
            "total_taxable": taxable,
            "total_cgst": cgst,
            "total_sgst": sgst,
            "total_igst": igst,
            "total": taxable + cgst + sgst + igst,
        })
    return {"hsn_summary": result}


@router.get("/gst/gstr3b-summary")
def get_gstr3b_summary(
    fy_code: str = Query(...),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """GSTR‑3B summary calculations."""
    # Outward (sales + credit notes negative)
    sales_q = db.query(
        func.coalesce(func.sum(SalesBill.taxable_amt), 0).label("taxable"),
        func.coalesce(func.sum(SalesBill.cgst_amt), 0).label("cgst"),
        func.coalesce(func.sum(SalesBill.sgst_amt), 0).label("sgst"),
        func.coalesce(func.sum(SalesBill.igst_amt), 0).label("igst"),
    ).filter(SalesBill.fy_code == fy_code)
    if from_date:
        sales_q = sales_q.filter(SalesBill.bill_date >= from_date)
    if to_date:
        sales_q = sales_q.filter(SalesBill.bill_date <= to_date)
    s = sales_q.one()
    cn_q = db.query(
        func.coalesce(func.sum(CreditNote.taxable_amount), 0).label("taxable"),
        func.coalesce(func.sum(CreditNote.cgst_amount), 0).label("cgst"),
        func.coalesce(func.sum(CreditNote.sgst_amount), 0).label("sgst"),
        func.coalesce(func.sum(CreditNote.igst_amount), 0).label("igst"),
    ).filter(CreditNote.fy_code == fy_code)
    if from_date:
        cn_q = cn_q.filter(CreditNote.voucher_date >= from_date)
    if to_date:
        cn_q = cn_q.filter(CreditNote.voucher_date <= to_date)
    cn = cn_q.one()
    outward_taxable = float(s.taxable) - float(cn.taxable)
    outward_cgst = float(s.cgst) - float(cn.cgst)
    outward_sgst = float(s.sgst) - float(cn.sgst)
    outward_igst = float(s.igst) - float(cn.igst)

    # Inward — PurchaseBill has no tax-head columns of its own; recompute from line items
    pb_q = db.query(PurchaseBill).options(joinedload(PurchaseBill.items)).filter(PurchaseBill.fy_code == fy_code)
    if from_date:
        pb_q = pb_q.filter(PurchaseBill.bill_date >= from_date)
    if to_date:
        pb_q = pb_q.filter(PurchaseBill.bill_date <= to_date)
    purchase_bills = pb_q.all()
    clinic = db.query(ClinicSetup).first()
    supplier_ids = {pb.supplier_id for pb in purchase_bills}
    suppliers = {
        sup.supplier_id: sup
        for sup in db.query(Supplier).filter(Supplier.supplier_id.in_(supplier_ids)).all()
    } if supplier_ids else {}

    inward_cgst = Decimal("0.00")
    inward_sgst = Decimal("0.00")
    inward_igst = Decimal("0.00")
    for pb in purchase_bills:
        _, cgst, sgst, igst = _purchase_bill_tax_breakdown(pb, suppliers.get(pb.supplier_id), clinic)
        inward_cgst += cgst
        inward_sgst += sgst
        inward_igst += igst

    dn_q = db.query(
        func.coalesce(func.sum(DebitNote.cgst_amount), 0).label("cgst"),
        func.coalesce(func.sum(DebitNote.sgst_amount), 0).label("sgst"),
        func.coalesce(func.sum(DebitNote.igst_amount), 0).label("igst"),
    ).filter(DebitNote.fy_code == fy_code)
    if from_date:
        dn_q = dn_q.filter(DebitNote.voucher_date >= from_date)
    if to_date:
        dn_q = dn_q.filter(DebitNote.voucher_date <= to_date)
    dn = dn_q.one()
    inward_cgst_credit = float(inward_cgst) - float(dn.cgst)
    inward_sgst_credit = float(inward_sgst) - float(dn.sgst)
    inward_igst_credit = float(inward_igst) - float(dn.igst)

    return {
        "outward_taxable": outward_taxable,
        "outward_cgst": outward_cgst,
        "outward_sgst": outward_sgst,
        "outward_igst": outward_igst,
        "inward_cgst_credit": inward_cgst_credit,
        "inward_sgst_credit": inward_sgst_credit,
        "inward_igst_credit": inward_igst_credit,
        "net_cgst_payable": outward_cgst - inward_cgst_credit,
        "net_sgst_payable": outward_sgst - inward_sgst_credit,
        "net_igst_payable": outward_igst - inward_igst_credit,
    }


@router.get("/gst/purchase-register")
def get_purchase_register(
    fy_code: str = Query(...),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """Purchase Register with debit notes as negative rows.

    PurchaseBill has no taxable/cgst/sgst/igst columns — recomputed from
    PurchaseBillItem line data, see _purchase_bill_tax_breakdown above.
    """
    pb_q = db.query(PurchaseBill).options(joinedload(PurchaseBill.items)).filter(PurchaseBill.fy_code == fy_code)
    if from_date:
        pb_q = pb_q.filter(PurchaseBill.bill_date >= from_date)
    if to_date:
        pb_q = pb_q.filter(PurchaseBill.bill_date <= to_date)
    purchase_bills = pb_q.all()

    clinic = db.query(ClinicSetup).first()
    supplier_ids = {pb.supplier_id for pb in purchase_bills}
    suppliers = {
        sup.supplier_id: sup
        for sup in db.query(Supplier).filter(Supplier.supplier_id.in_(supplier_ids)).all()
    } if supplier_ids else {}

    dn_q = db.query(DebitNote).filter(DebitNote.fy_code == fy_code)
    if from_date:
        dn_q = dn_q.filter(DebitNote.voucher_date >= from_date)
    if to_date:
        dn_q = dn_q.filter(DebitNote.voucher_date <= to_date)
    debit_notes = dn_q.all()

    rows = []
    for pb in purchase_bills:
        supplier = suppliers.get(pb.supplier_id)
        taxable, cgst, sgst, igst = _purchase_bill_tax_breakdown(pb, supplier, clinic)
        rows.append({
            "date": pb.bill_date,
            "voucher_no": pb.bill_no,
            "party_name": supplier.supplier_name if supplier else None,
            "gstin": supplier.gstin if supplier else None,
            "taxable": float(taxable),
            "cgst": float(cgst),
            "sgst": float(sgst),
            "igst": float(igst),
            "total": float(taxable + cgst + sgst + igst),
            "type": "purchase",
        })
    for dn in debit_notes:
        taxable = dn.taxable_amount or Decimal("0.00")
        cgst = dn.cgst_amount or Decimal("0.00")
        sgst = dn.sgst_amount or Decimal("0.00")
        igst = dn.igst_amount or Decimal("0.00")
        rows.append({
            "date": dn.voucher_date,
            "voucher_no": dn.voucher_no,
            "party_name": dn.party_name,
            "gstin": None,
            "taxable": -float(taxable),
            "cgst": -float(cgst),
            "sgst": -float(sgst),
            "igst": -float(igst),
            "total": -float(taxable + cgst + sgst + igst),
            "type": "debit_note",
        })
    rows.sort(key=lambda r: r["date"])
    return {"purchase_register": rows}

@router.get("/bank-book")
def get_bank_book(
    fy_code: str = Query(..., description="Financial Year Code"),
    bank_gl_id: Optional[int] = Query(None, description="Specific Bank GL ID"),
    from_date: Optional[date] = Query(None, description="From Date"),
    to_date: Optional[date] = Query(None, description="To Date"),
    db: Session = Depends(get_db)
):
    query_gls = db.query(GLMaster).filter(GLMaster.sub_group == "Cash & Bank", GLMaster.gl_code.like("BANK%"))
    if bank_gl_id:
        query_gls = query_gls.filter(GLMaster.gl_id == bank_gl_id)
        
    bank_gls = query_gls.all()
    if not bank_gls:
        return {"message": "No bank accounts found", "accounts": []}
        
    accounts_data = []
    
    for gl in bank_gls:
        # Calculate opening balance
        opening_dr = Decimal("0.00")
        opening_cr = Decimal("0.00")
        
        ob = db.query(OpeningBalance).filter(
            OpeningBalance.gl_id == gl.gl_id,
            OpeningBalance.fy_code == fy_code
        ).first()
        
        if ob:
            if ob.balance_type == "DR":
                opening_dr = ob.amount or Decimal("0.00")
            else:
                opening_cr = ob.amount or Decimal("0.00")
                
        if from_date:
            pre_postings = db.query(GLPosting).filter(
                GLPosting.gl_id == gl.gl_id,
                GLPosting.fy_code == fy_code,
                GLPosting.posting_date < from_date
            ).all()
            for p in pre_postings:
                opening_dr += (p.dr_amount or Decimal("0.00"))
                opening_cr += (p.cr_amount or Decimal("0.00"))
                
        running_balance = opening_dr - opening_cr
        
        # Transactions
        query = db.query(GLPosting).filter(
            GLPosting.gl_id == gl.gl_id,
            GLPosting.fy_code == fy_code
        )
        if from_date:
            query = query.filter(GLPosting.posting_date >= from_date)
        if to_date:
            query = query.filter(GLPosting.posting_date <= to_date)
            
        postings = query.order_by(GLPosting.posting_date.asc(), GLPosting.posting_id.asc()).all()
        
        transactions = []
        daily_summary = {}
        
        for p in postings:
            running_balance += (p.dr_amount or Decimal("0.00")) - (p.cr_amount or Decimal("0.00"))
            date_str = p.posting_date.isoformat()
            
            if date_str not in daily_summary:
                daily_summary[date_str] = {"dr": Decimal("0.00"), "cr": Decimal("0.00")}
            
            daily_summary[date_str]["dr"] += (p.dr_amount or Decimal("0.00"))
            daily_summary[date_str]["cr"] += (p.cr_amount or Decimal("0.00"))
            
            transactions.append({
                "posting_date": p.posting_date,
                "voucher_type": p.voucher_type,
                "voucher_no": p.voucher_no,
                "narration": p.narration,
                "dr_amount": p.dr_amount,
                "cr_amount": p.cr_amount,
                "running_balance": running_balance,
                "balance_type": "DR" if running_balance >= 0 else "CR"
            })
            
        accounts_data.append({
            "account": {
                "gl_id": gl.gl_id,
                "gl_code": gl.gl_code,
                "gl_name": gl.gl_name
            },
            "opening_balance": {
                "net": opening_dr - opening_cr,
                "balance_type": "DR" if (opening_dr - opening_cr) >= 0 else "CR"
            },
            "daily_summary": daily_summary,
            "transactions": transactions,
            "closing_balance": {
                "net": running_balance,
                "balance_type": "DR" if running_balance >= 0 else "CR"
            }
        })
        
    return {"accounts": accounts_data}

# ---------------------------------------------------------------------------
# Debtor & Creditor Outstanding Reports
# ---------------------------------------------------------------------------

from sqlalchemy import func
from models.stage3 import SalesBill  # noqa: F811
from models.accounts import ReceiptVoucherDetail, PaymentVoucherDetail  # noqa: F811
from models.people import PetOwner
from models.phase3 import PurchaseBill, Supplier  # noqa: F811

@router.get("/debtor-outstanding")
def get_debtor_outstanding(
    fy_code: str = Query(..., description="Financial Year Code"),
    owner_id: Optional[int] = Query(None, description="Owner ID (optional)"),
    db: Session = Depends(get_db),
):
    """Return outstanding amounts per debtor (pet owner).

    If ``owner_id`` is provided, include detailed bill-level information.
    """
    # Base subquery aggregating per bill
    # NOTE (2026-07-24): SalesBill has no `net_amount` column (that's PurchaseBill) —
    # the actual "amount owed by the customer" column on SalesBill is `net_payable`.
    # This previously raised AttributeError on every call.
    bill_subq = (
        db.query(
            SalesBill.owner_id.label("owner_id"),
            SalesBill.bill_id.label("bill_id"),
            SalesBill.net_payable.label("net_amount"),
            func.coalesce(func.sum(ReceiptVoucherDetail.amount_received), 0).label("received"),
        )
        .outerjoin(ReceiptVoucherDetail, ReceiptVoucherDetail.bill_id == SalesBill.bill_id)
        .filter(SalesBill.fy_code == fy_code)
        .group_by(SalesBill.owner_id, SalesBill.bill_id, SalesBill.net_payable)
    ).subquery()

    # Aggregate per owner
    owner_agg = (
        db.query(
            bill_subq.c.owner_id,
            func.sum(bill_subq.c.net_amount).label("total_billed"),
            func.sum(bill_subq.c.received).label("total_received"),
            (func.sum(bill_subq.c.net_amount) - func.sum(bill_subq.c.received)).label("outstanding"),
        )
        .group_by(bill_subq.c.owner_id)
        .having((func.sum(bill_subq.c.net_amount) - func.sum(bill_subq.c.received)) > 0)
    ).subquery()

    query = (
        db.query(
            owner_agg.c.owner_id,
            PetOwner.name.label("owner_name"),  # PetOwner has no `owner_name` column — real column is `name`
            owner_agg.c.total_billed,
            owner_agg.c.total_received,
            owner_agg.c.outstanding,
        )
        .join(PetOwner, PetOwner.owner_id == owner_agg.c.owner_id)
    )

    if owner_id:
        query = query.filter(owner_agg.c.owner_id == owner_id)

    results = query.all()

    response = []
    for row in results:
        entry: dict = {
            "owner_id": row.owner_id,
            "owner_name": row.owner_name,
            "total_billed": float(row.total_billed),
            "total_received": float(row.total_received),
            "outstanding": float(row.outstanding),
        }
        # Add bill‑level details when a specific owner is requested
        if owner_id:
            bills = (
                db.query(
                    bill_subq.c.bill_id,
                    bill_subq.c.net_amount,
                    bill_subq.c.received,
                    (bill_subq.c.net_amount - bill_subq.c.received).label("outstanding"),
                )
                .filter(bill_subq.c.owner_id == owner_id)
                .all()
            )
            entry["bills"] = [
                {
                    "bill_id": b.bill_id,
                    "net_amount": float(b.net_amount),
                    "received": float(b.received),
                    "outstanding": float(b.outstanding),
                }
                for b in bills
            ]
        response.append(entry)
    return {"debtor_outstanding": response}


@router.get("/creditor-outstanding")
def get_creditor_outstanding(
    fy_code: str = Query(..., description="Financial Year Code"),
    supplier_id: Optional[int] = Query(None, description="Supplier ID (optional)"),
    db: Session = Depends(get_db),
):
    """Return outstanding amounts per creditor (supplier).

    If ``supplier_id`` is provided, include detailed bill‑level information.
    """
    # Base subquery aggregating per purchase bill
    bill_subq = (
        db.query(
            PurchaseBill.supplier_id.label("supplier_id"),
            PurchaseBill.bill_id.label("bill_id"),
            PurchaseBill.net_amount.label("net_amount"),
            func.coalesce(func.sum(PaymentVoucherDetail.amount_paid), 0).label("paid"),
        )
        .outerjoin(PaymentVoucherDetail, PaymentVoucherDetail.bill_id == PurchaseBill.bill_id)
        .filter(PurchaseBill.fy_code == fy_code)
        .group_by(PurchaseBill.supplier_id, PurchaseBill.bill_id, PurchaseBill.net_amount)
    ).subquery()

    # Aggregate per supplier
    supplier_agg = (
        db.query(
            bill_subq.c.supplier_id,
            func.sum(bill_subq.c.net_amount).label("total_billed"),
            func.sum(bill_subq.c.paid).label("total_paid"),
            (func.sum(bill_subq.c.net_amount) - func.sum(bill_subq.c.paid)).label("outstanding"),
        )
        .group_by(bill_subq.c.supplier_id)
        .having((func.sum(bill_subq.c.net_amount) - func.sum(bill_subq.c.paid)) > 0)
    ).subquery()

    query = (
        db.query(
            supplier_agg.c.supplier_id,
            Supplier.supplier_name,
            supplier_agg.c.total_billed,
            supplier_agg.c.total_paid,
            supplier_agg.c.outstanding,
        )
        .join(Supplier, Supplier.supplier_id == supplier_agg.c.supplier_id)
    )

    if supplier_id:
        query = query.filter(supplier_agg.c.supplier_id == supplier_id)

    results = query.all()

    response = []
    for row in results:
        entry: dict = {
            "supplier_id": row.supplier_id,
            "supplier_name": row.supplier_name,
            "total_billed": float(row.total_billed),
            "total_paid": float(row.total_paid),
            "outstanding": float(row.outstanding),
        }
        if supplier_id:
            bills = (
                db.query(
                    bill_subq.c.bill_id,
                    bill_subq.c.net_amount,
                    bill_subq.c.paid,
                    (bill_subq.c.net_amount - bill_subq.c.paid).label("outstanding"),
                )
                .filter(bill_subq.c.supplier_id == supplier_id)
                .all()
            )
            entry["bills"] = [
                {
                    "bill_id": b.bill_id,
                    "net_amount": float(b.net_amount),
                    "paid": float(b.paid),
                    "outstanding": float(b.outstanding),
                }
                for b in bills
            ]
        response.append(entry)
    return {"creditor_outstanding": response}

