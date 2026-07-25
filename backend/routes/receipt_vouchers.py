from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

from database import get_db
from models.accounts import ReceiptVoucher, ReceiptVoucherDetail, GLPosting
from models.accounts import BankArrival
from schemas.accounts import (
    ReceiptVoucherCreate, ReceiptVoucherOut
)
from utils.doc_sequence import get_next_doc_no, format_fy

router = APIRouter(prefix="/accounts/receipt-vouchers", tags=["Accounts"])


def _ensure_rv_sequence(db: Session, fy_code: str):
    """Ensure 'RV' doc_type row exists in doc_sequences before generating a number."""
    db.execute(text("""
        INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
        VALUES ('RV', 'RV-', 0, 5, true, :fy, true)
        ON CONFLICT (doc_type) DO NOTHING;
    """), {"fy": format_fy(fy_code)})
    db.commit()


@router.get("/next-voucher-no")
def get_next_voucher_preview(fy_code: str = Query("2025-26"), db: Session = Depends(get_db)):
    """
    Peek at the next RV- number without consuming it — for display in the form header.
    """
    _ensure_rv_sequence(db, fy_code)
    result = db.execute(text("""
        SELECT
            CASE
                WHEN use_fin_year AND fin_year != ''
                    THEN prefix || fin_year || LPAD((current_no + 1)::TEXT, pad_length, '0')
                ELSE
                    prefix || LPAD((current_no + 1)::TEXT, pad_length, '0')
            END AS next_no
        FROM doc_sequences
        WHERE doc_type = 'RV'
    """)).fetchone()
    return {"voucher_no": result[0] if result else "RV-Auto"}


@router.post("/", response_model=ReceiptVoucherOut)
def create_receipt_voucher(data: ReceiptVoucherCreate, db: Session = Depends(get_db)):
    if not data.receipt_no:
        _ensure_rv_sequence(db, data.fy_code)
        data.receipt_no = get_next_doc_no(db, "RV")

    try:
        # Create Header
        rv = ReceiptVoucher(
            fy_code=data.fy_code,
            receipt_no=data.receipt_no,
            receipt_date=data.receipt_date,
            owner_id=data.owner_id,
            gl_party_id=data.gl_party_id,
            gl_cashbank_id=data.gl_cashbank_id,
            total_amount=data.total_amount,
            payment_type=data.payment_type,
            ref_no=data.ref_no,
            ref_date=data.ref_date,
            narration=data.narration,
            status="Posted"
        )
        db.add(rv)
        db.flush()

        # Create Details — one row per bill/arrival line
        arrival_funded = Decimal("0")
        for i, det in enumerate(data.details, start=1):
            rv_det = ReceiptVoucherDetail(
                receipt_id=rv.receipt_id,
                line_no=i,
                vou_type=det.vou_type,
                bill_id=det.bill_id,
                bill_no=det.bill_no,
                bill_date=det.bill_date,
                bill_amount=det.bill_amount,
                prev_received=det.prev_received,
                balance_amount=det.balance_amount,
                amount_received=det.amount_received,
                arrival_id=det.arrival_id
            )
            db.add(rv_det)

            # If this line is linked to a Bank Arrival, update that arrival's entered_amount.
            # The cash/bank leg for this money was already posted when the Bank Arrival
            # itself was recorded, so it must NOT be posted again below.
            if det.arrival_id:
                ba = db.query(BankArrival).filter(BankArrival.arrival_id == det.arrival_id).first()
                if ba:
                    arrival_funded += det.amount_received
                    ba.entered_amount = (ba.entered_amount or Decimal("0")) + det.amount_received
                    if ba.entered_amount >= ba.amount:
                        ba.status = 'Matched'
                    else:
                        ba.status = 'PartiallyMatched'

        fresh_cash = data.total_amount - arrival_funded

        # Auto-post to gl_postings — only for the fresh-cash portion. The portion
        # matched against a pre-existing Bank Arrival already posted DR bank / CR
        # party when that arrival was recorded; re-posting it here would double-count
        # both the cash inflow and the party's credit.
        if fresh_cash > 0:
            # DR: Cash/Bank account (money comes IN to bank)
            db.add(GLPosting(
                fy_code=data.fy_code,
                posting_date=data.receipt_date,
                gl_id=data.gl_cashbank_id,
                voucher_type="ReceiptVoucher",
                voucher_no=data.receipt_no,
                voucher_ref_id=rv.receipt_id,
                dr_amount=fresh_cash,
                cr_amount=0,
                narration=data.narration
            ))

            # CR: Party account (reduces customer outstanding)
            db.add(GLPosting(
                fy_code=data.fy_code,
                posting_date=data.receipt_date,
                gl_id=data.gl_party_id,
                voucher_type="ReceiptVoucher",
                voucher_no=data.receipt_no,
                voucher_ref_id=rv.receipt_id,
                dr_amount=0,
                cr_amount=fresh_cash,
                narration=data.narration
            ))

        db.commit()
        db.refresh(rv)
        return rv

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create receipt voucher: {e}")


@router.get("/", response_model=List[ReceiptVoucherOut])
def list_receipt_vouchers(
    fy_code: Optional[str] = Query(None),
    gl_party_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(ReceiptVoucher)
    if fy_code:
        query = query.filter(ReceiptVoucher.fy_code == fy_code)
    if status:
        query = query.filter(ReceiptVoucher.status == status)
    if gl_party_id:
        query = query.filter(ReceiptVoucher.gl_party_id == gl_party_id)

    return query.order_by(ReceiptVoucher.created_at.desc()).all()


@router.get("/fetch-bills/{owner_id}")
def fetch_bills(owner_id: int, db: Session = Depends(get_db)):
    """
    Fetch pending sales bills + open bank arrivals for a given owner.
    Called when the user selects a party and clicks 'Fetch Bills'.

    sales_bills column names:
        bill_number   → aliased as bill_no
        net_payable   → aliased as net_amount
    """
    try:
        # ── Sales Bills: outstanding balance per bill ─────────────────────
        bills = db.execute(text("""
            SELECT
                sb.bill_id,
                sb.bill_number                                             AS bill_no,
                sb.bill_date,
                sb.net_payable                                             AS net_amount,
                COALESCE(SUM(rvd.amount_received), 0)                      AS prev_received,
                (sb.net_payable - COALESCE(SUM(rvd.amount_received), 0))   AS balance
            FROM sales_bills sb
            LEFT JOIN receipt_voucher_details rvd ON sb.bill_id = rvd.bill_id
            LEFT JOIN receipt_vouchers rv
                   ON rvd.receipt_id = rv.receipt_id
                  AND rv.status != 'Cancelled'
            WHERE sb.owner_id = :owner_id
              AND sb.status NOT IN ('Cancelled', 'Draft')
            GROUP BY sb.bill_id, sb.bill_number, sb.bill_date, sb.net_payable
            HAVING (sb.net_payable - COALESCE(SUM(rvd.amount_received), 0)) > 0
            ORDER BY sb.bill_date
        """), {"owner_id": owner_id}).fetchall()

        # ── Get owner's GL account for bank arrivals lookup ───────────────
        # pet_owners.gl_account_id is auto-created when the owner is registered
        # bank_arrivals.gl_party_id uses the same gl_master.gl_id
        owner_row = db.execute(
            text("SELECT gl_account_id FROM pet_owners WHERE owner_id = :oid"),
            {"oid": owner_id}
        ).fetchone()
        gl_id = owner_row[0] if owner_row and owner_row[0] else -1

        # ── Bank Arrivals: open / partially matched for this owner's GL ───
        arrivals = db.execute(text("""
            SELECT
                arrival_id,
                voucher_no   AS arrival_no,
                voucher_date,
                amount,
                entered_amount,
                balance,
                ref_doc_no,
                ref_doc_date
            FROM bank_arrivals
            WHERE gl_party_id = :gl_id
              AND status IN ('Open', 'PartiallyMatched')
            ORDER BY voucher_date
        """), {"gl_id": gl_id}).fetchall()

        return {
            "bills": [dict(b._mapping) for b in bills],
            "arrivals": [dict(a._mapping) for a in arrivals],
            "gl_party_id": gl_id
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"fetch-bills error: {str(e)}")


@router.get("/{receipt_id}", response_model=ReceiptVoucherOut)
def get_receipt_voucher(receipt_id: int, db: Session = Depends(get_db)):
    rv = db.query(ReceiptVoucher).filter(ReceiptVoucher.receipt_id == receipt_id).first()
    if not rv:
        raise HTTPException(status_code=404, detail="Receipt Voucher not found")
    return rv


@router.delete("/{receipt_id}")
def delete_receipt_voucher(receipt_id: int, db: Session = Depends(get_db)):
    rv = db.query(ReceiptVoucher).filter(ReceiptVoucher.receipt_id == receipt_id).first()
    if not rv:
        raise HTTPException(status_code=404, detail="Receipt Voucher not found")

    try:
        rv.status = "Cancelled"

        # Reverse GL Postings
        db.query(GLPosting).filter(
            GLPosting.voucher_type == 'ReceiptVoucher',
            GLPosting.voucher_ref_id == receipt_id
        ).delete()

        # Adjust Bank Arrivals — subtract what was entered
        for det in rv.details:
            if det.arrival_id:
                ba = db.query(BankArrival).filter(BankArrival.arrival_id == det.arrival_id).first()
                if ba:
                    ba.entered_amount = max(Decimal("0"), (ba.entered_amount or Decimal("0")) - det.amount_received)
                    ba.status = 'Open' if ba.entered_amount == 0 else 'PartiallyMatched'

        db.commit()
        return {"message": "Receipt Voucher cancelled successfully"}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to cancel receipt voucher: {e}")
