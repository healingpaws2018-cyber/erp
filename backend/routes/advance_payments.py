from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime
from decimal import Decimal

from database import get_db
from models.accounts import AdvancePayment, GLPosting
from schemas.accounts import (
    AdvancePaymentCreate, AdvancePaymentUpdate, AdvancePaymentOut
)
from utils.doc_sequence import get_next_doc_no, format_fy
from utils.gl_utils import get_gl_by_code

router = APIRouter(prefix="/accounts/advance-payments", tags=["Accounts"])


def _post_advance_payment_to_gl(db: Session, adv: AdvancePayment, data: AdvancePaymentCreate):
    """
    Advance "Given" (party_type='Supplier'): we prepay a supplier before a bill
    exists. DR ADV-SUP (prepaid asset increases) / CR gl_cashbank_id (money leaves
    the bank).
    Advance "Received" (party_type='Customer'): a customer pays us before a bill
    exists. DR gl_cashbank_id (money arrives) / CR ADV-CUST (liability — we owe
    them goods/services, or a refund).
    """
    if (data.amount or 0) <= 0:
        return
    common = dict(
        fy_code=data.fy_code,
        posting_date=data.voucher_date,
        voucher_type="AdvancePayment",
        voucher_no=data.voucher_no,
        voucher_ref_id=adv.adv_id,
        narration=data.narration,
    )
    if data.party_type == "Customer":
        adv_gl = get_gl_by_code(db, "ADV-CUST")
        if not adv_gl:
            raise HTTPException(status_code=500, detail="Chart of Accounts is missing system account 'ADV-CUST' (Advance from Customers).")
        db.add(GLPosting(**common, gl_id=data.gl_cashbank_id, dr_amount=data.amount, cr_amount=0))
        db.add(GLPosting(**common, gl_id=adv_gl, dr_amount=0, cr_amount=data.amount))
    else:
        adv_gl = get_gl_by_code(db, "ADV-SUP")
        if not adv_gl:
            raise HTTPException(status_code=500, detail="Chart of Accounts is missing system account 'ADV-SUP' (Advance to Suppliers).")
        db.add(GLPosting(**common, gl_id=adv_gl, dr_amount=data.amount, cr_amount=0))
        db.add(GLPosting(**common, gl_id=data.gl_cashbank_id, dr_amount=0, cr_amount=data.amount))


def _ensure_ad_sequence(db: Session, fy_code: str):
    """Ensure the 'AD' doc_type exists in doc_sequences before generating a number."""
    db.execute(text("""
        INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
        VALUES ('AD', 'AD-', 0, 5, true, :fy, true)
        ON CONFLICT (doc_type) DO NOTHING;
    """), {"fy": format_fy(fy_code)})
    db.commit()


@router.get("/next-voucher-no")
def get_next_voucher_preview(fy_code: str = Query("2025-26"), db: Session = Depends(get_db)):
    """
    Peek at the next voucher number that would be issued for 'AD' doc_type.
    Does NOT consume/increment the sequence — purely for display in the form.
    """
    _ensure_ad_sequence(db, fy_code)
    result = db.execute(text("""
        SELECT
            CASE
                WHEN use_fin_year AND fin_year != ''
                    THEN prefix || fin_year || LPAD((current_no + 1)::TEXT, pad_length, '0')
                ELSE
                    prefix || LPAD((current_no + 1)::TEXT, pad_length, '0')
            END AS next_no
        FROM doc_sequences
        WHERE doc_type = 'AD'
    """)).fetchone()
    return {"voucher_no": result[0] if result else "AD-Auto"}


@router.post("/", response_model=AdvancePaymentOut)
def create_advance_payment(data: AdvancePaymentCreate, db: Session = Depends(get_db)):
    if not data.voucher_no:
        _ensure_ad_sequence(db, data.fy_code)
        data.voucher_no = get_next_doc_no(db, "AD")

    try:
        adv = AdvancePayment(
            fy_code=data.fy_code,
            voucher_no=data.voucher_no,
            voucher_date=data.voucher_date,
            gl_party_id=data.gl_party_id,
            party_name=data.party_name,
            party_type=data.party_type,
            gl_cashbank_id=data.gl_cashbank_id,
            cashbank_name=data.cashbank_name,
            amount=data.amount,
            adjusted_amount=Decimal("0"),
            doc_no=data.doc_no,
            doc_date=data.doc_date,
            narration=data.narration,
            status="Open"
        )
        db.add(adv)
        db.flush()

        _post_advance_payment_to_gl(db, adv, data)

        db.commit()
        db.refresh(adv)
        return adv
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create advance payment: {e}")


@router.get("/", response_model=List[AdvancePaymentOut])
def list_advance_payments(
    fy_code: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    party_type: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(AdvancePayment)
    if fy_code:
        query = query.filter(AdvancePayment.fy_code == fy_code)
    if status:
        query = query.filter(AdvancePayment.status == status)
    if party_type:
        query = query.filter(AdvancePayment.party_type == party_type)

    return query.order_by(AdvancePayment.created_at.desc()).all()


@router.get("/{adv_id}", response_model=AdvancePaymentOut)
def get_advance_payment(adv_id: int, db: Session = Depends(get_db)):
    adv = db.query(AdvancePayment).filter(AdvancePayment.adv_id == adv_id).first()
    if not adv:
        raise HTTPException(status_code=404, detail="Advance Payment not found")
    return adv


@router.put("/{adv_id}", response_model=AdvancePaymentOut)
def update_advance_payment(adv_id: int, data: AdvancePaymentUpdate, db: Session = Depends(get_db)):
    adv = db.query(AdvancePayment).filter(AdvancePayment.adv_id == adv_id).first()
    if not adv:
        raise HTTPException(status_code=404, detail="Advance Payment not found")

    if data.voucher_date is not None:
        adv.voucher_date = data.voucher_date
    if data.doc_no is not None:
        adv.doc_no = data.doc_no
    if data.doc_date is not None:
        adv.doc_date = data.doc_date
    if data.narration is not None:
        adv.narration = data.narration
    if data.status is not None:
        adv.status = data.status

    db.commit()
    db.refresh(adv)
    return adv


@router.delete("/{adv_id}")
def delete_advance_payment(adv_id: int, db: Session = Depends(get_db)):
    adv = db.query(AdvancePayment).filter(AdvancePayment.adv_id == adv_id).first()
    if not adv:
        raise HTTPException(status_code=404, detail="Advance Payment not found")

    if (adv.adjusted_amount or Decimal("0")) > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot cancel: this advance has already been adjusted against one or more payment vouchers. Cancel those first."
        )

    try:
        adv.status = "Cancelled"

        # Reverse GL Postings
        db.query(GLPosting).filter(
            GLPosting.voucher_type == 'AdvancePayment',
            GLPosting.voucher_ref_id == adv_id
        ).delete()

        db.commit()
        return {"message": "Advance Payment cancelled successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to cancel advance payment: {e}")
