from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

from database import get_db
from models.accounts import PaymentVoucher, PaymentVoucherDetail, GLPosting, AdvancePayment
from models.phase3 import Supplier, PurchaseBill
from schemas.accounts import PaymentVoucherCreate, PaymentVoucherOut
from utils.doc_sequence import get_next_doc_no, format_fy
from utils.gl_utils import get_gl_by_code

router = APIRouter(prefix="/accounts/payment-vouchers", tags=["Accounts"])


def _ensure_pv_sequence(db: Session, fy_code: str):
    """Ensure 'PV' doc_type row exists in doc_sequences and fin_year matches current FY."""
    formatted_fy = format_fy(fy_code)
    db.execute(text("""
        INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
        VALUES ('PV', 'PV-', 0, 5, true, :fy, true)
        ON CONFLICT (doc_type) DO UPDATE
            SET fin_year = EXCLUDED.fin_year
            WHERE doc_sequences.fin_year != EXCLUDED.fin_year;
    """), {"fy": formatted_fy})
    db.commit()


@router.get("/next-voucher-no")
def get_next_voucher_preview(fy_code: str = Query("2026-27"), db: Session = Depends(get_db)):
    """
    Peek at the next PV- number without consuming it.
    """
    _ensure_pv_sequence(db, fy_code)
    result = db.execute(text("""
        SELECT
            CASE
                WHEN use_fin_year AND fin_year != ''
                    THEN prefix || fin_year || LPAD((current_no + 1)::TEXT, pad_length, '0')
                ELSE
                    prefix || LPAD((current_no + 1)::TEXT, pad_length, '0')
            END AS next_no
        FROM doc_sequences
        WHERE doc_type = 'PV'
    """)).fetchone()
    return {"voucher_no": result[0] if result else "PV-Auto"}


@router.post("/", response_model=PaymentVoucherOut)
def create_payment_voucher(data: PaymentVoucherCreate, db: Session = Depends(get_db)):
    if not data.voucher_no:
        _ensure_pv_sequence(db, data.fy_code)
        data.voucher_no = get_next_doc_no(db, "PV")

    try:
        # Create Header
        pv = PaymentVoucher(
            fy_code=data.fy_code,
            voucher_no=data.voucher_no,
            voucher_date=data.voucher_date,
            gl_party_id=data.gl_party_id,
            party_name=data.party_name,
            gl_cashbank_id=data.gl_cashbank_id,
            cashbank_name=data.cashbank_name,
            total_amount=data.total_amount,
            payment_type=data.payment_type,
            ref_no=data.ref_no,
            ref_date=data.ref_date,
            narration=data.narration,
            status="Posted"
        )
        db.add(pv)
        db.flush()

        # Create Details — one row per purchase bill
        advance_funded = Decimal("0")
        for i, det in enumerate(data.details, start=1):
            pv_det = PaymentVoucherDetail(
                payment_id=pv.payment_id,
                line_no=i,
                vou_type=det.vou_type,
                bill_id=det.bill_id,
                bill_no=det.bill_no,
                bill_date=det.bill_date,
                bill_amount=det.bill_amount,
                prev_paid=det.prev_paid,
                balance_amount=det.balance_amount,
                amount_paid=det.amount_paid,
                adv_id=det.adv_id
            )
            db.add(pv_det)

            # If this line is adjusted against a pre-existing Advance Payment, drain
            # that advance instead of treating it as fresh cash going out (see below).
            if det.adv_id:
                adv = db.query(AdvancePayment).filter(AdvancePayment.adv_id == det.adv_id).first()
                if adv:
                    advance_funded += det.amount_paid
                    adv.adjusted_amount = (adv.adjusted_amount or Decimal("0")) + det.amount_paid
                    adv.status = 'Matched' if adv.adjusted_amount >= adv.amount else 'PartiallyMatched'

        fresh_cash = data.total_amount - advance_funded

        # Auto-post to gl_postings
        # DR: Party account (reduces liability/creditor) — full amount, since the
        # bill's liability is reduced either way it's funded.
        db.add(GLPosting(
            fy_code=data.fy_code,
            posting_date=data.voucher_date,
            gl_id=data.gl_party_id,
            voucher_type="PaymentVoucher",
            voucher_no=data.voucher_no,
            voucher_ref_id=pv.payment_id,
            dr_amount=data.total_amount,
            cr_amount=0,
            narration=data.narration
        ))

        # CR: Cash/Bank account (money goes OUT of bank) — only the fresh-cash
        # portion. The portion adjusted against a pre-existing Advance Payment
        # already left the bank when that advance was posted, so it's drained from
        # ADV-SUP instead (avoids double-counting the cash outflow).
        if fresh_cash > 0:
            db.add(GLPosting(
                fy_code=data.fy_code,
                posting_date=data.voucher_date,
                gl_id=data.gl_cashbank_id,
                voucher_type="PaymentVoucher",
                voucher_no=data.voucher_no,
                voucher_ref_id=pv.payment_id,
                dr_amount=0,
                cr_amount=fresh_cash,
                narration=data.narration
            ))

        # CR: ADV-SUP (Advance to Suppliers) — drains the prepaid asset for the
        # portion of this payment that was adjusted against an existing advance.
        if advance_funded > 0:
            adv_sup_gl = get_gl_by_code(db, "ADV-SUP")
            if not adv_sup_gl:
                raise HTTPException(status_code=500, detail="Chart of Accounts is missing system account 'ADV-SUP' (Advance to Suppliers).")
            db.add(GLPosting(
                fy_code=data.fy_code,
                posting_date=data.voucher_date,
                gl_id=adv_sup_gl,
                voucher_type="PaymentVoucher",
                voucher_no=data.voucher_no,
                voucher_ref_id=pv.payment_id,
                dr_amount=0,
                cr_amount=advance_funded,
                narration=data.narration
            ))

        db.commit()
        db.refresh(pv)
        return pv

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create payment voucher: {e}")


@router.get("/", response_model=List[PaymentVoucherOut])
def list_payment_vouchers(
    fy_code: Optional[str] = Query(None),
    gl_party_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(PaymentVoucher)
    if fy_code:
        query = query.filter(PaymentVoucher.fy_code == fy_code)
    if status:
        query = query.filter(PaymentVoucher.status == status)
    if gl_party_id:
        query = query.filter(PaymentVoucher.gl_party_id == gl_party_id)

    return query.order_by(PaymentVoucher.created_at.desc()).all()


@router.get("/fetch-bills/{supplier_id}")
def fetch_bills(supplier_id: int, db: Session = Depends(get_db)):
    """
    Fetch pending purchase bills for a given supplier.
    Called when the user selects a party and clicks 'Fetch Bills'.
    """
    try:
        # ── Purchase Bills: outstanding balance per bill ─────────────────────
        bills = db.execute(text("""
            SELECT
                pb.bill_id,
                pb.bill_no,
                pb.bill_date,
                pb.net_amount,
                COALESCE(SUM(pvd.amount_paid), 0)                        AS prev_paid,
                (pb.net_amount - COALESCE(SUM(pvd.amount_paid), 0))      AS balance
            FROM purchase_bills pb
            LEFT JOIN payment_voucher_details pvd ON pb.bill_id = pvd.bill_id
            LEFT JOIN payment_vouchers pv
                   ON pvd.payment_id = pv.payment_id
                  AND pv.status != 'Cancelled'
            WHERE pb.supplier_id = :supplier_id
              AND pb.status NOT IN ('Cancelled', 'Draft')
            GROUP BY pb.bill_id, pb.bill_no, pb.bill_date, pb.net_amount
            HAVING (pb.net_amount - COALESCE(SUM(pvd.amount_paid), 0)) > 0
            ORDER BY pb.bill_date
        """), {"supplier_id": supplier_id}).fetchall()

        # ── Get supplier's GL account ───────────────
        sup_row = db.execute(
            text("SELECT gl_account_id FROM suppliers WHERE supplier_id = :sid"),
            {"sid": supplier_id}
        ).fetchone()
        gl_id = sup_row[0] if sup_row and sup_row[0] else -1

        return {
            "bills": [dict(b._mapping) for b in bills],
            "gl_party_id": gl_id
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"fetch-bills error: {str(e)}")


@router.get("/{payment_id}", response_model=PaymentVoucherOut)
def get_payment_voucher(payment_id: int, db: Session = Depends(get_db)):
    pv = db.query(PaymentVoucher).filter(PaymentVoucher.payment_id == payment_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Payment Voucher not found")
    return pv


@router.delete("/{payment_id}")
def delete_payment_voucher(payment_id: int, db: Session = Depends(get_db)):
    pv = db.query(PaymentVoucher).filter(PaymentVoucher.payment_id == payment_id).first()
    if not pv:
        raise HTTPException(status_code=404, detail="Payment Voucher not found")

    try:
        pv.status = "Cancelled"

        # Reverse GL Postings
        db.query(GLPosting).filter(
            GLPosting.voucher_type == 'PaymentVoucher',
            GLPosting.voucher_ref_id == payment_id
        ).delete()

        # Reverse advance adjustments — give back what was drained from each advance
        for det in pv.details:
            if det.adv_id:
                adv = db.query(AdvancePayment).filter(AdvancePayment.adv_id == det.adv_id).first()
                if adv:
                    adv.adjusted_amount = max(Decimal("0"), (adv.adjusted_amount or Decimal("0")) - det.amount_paid)
                    if adv.adjusted_amount == 0:
                        adv.status = 'Open'
                    elif adv.adjusted_amount >= adv.amount:
                        adv.status = 'Matched'
                    else:
                        adv.status = 'PartiallyMatched'

        db.commit()
        return {"message": "Payment Voucher cancelled successfully"}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to cancel payment voucher: {e}")
