from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal

from database import get_db
from models.accounts import CreditNote, CreditNoteItem, GLPosting
from models.phase4 import GLMaster
from schemas.accounts import (
    CreditNoteCreate, CreditNoteOut
)
from utils.doc_sequence import get_next_doc_no, format_fy

router = APIRouter(prefix="/accounts/credit-notes", tags=["Accounts"])

def get_gl_by_code(db: Session, code: str) -> Optional[int]:
    gl = db.query(GLMaster).filter(GLMaster.gl_code == code).first()
    return gl.gl_id if gl else None

@router.post("/", response_model=CreditNoteOut)
def create_credit_note(data: CreditNoteCreate, db: Session = Depends(get_db)):
    if not data.voucher_no:
        formatted_fy = format_fy(data.fy_code) if data.fy_code else ""
        db.execute(text("""
            INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
            VALUES ('CN', 'CN-', 0, 5, true, :fy, true)
            ON CONFLICT (doc_type) DO UPDATE
                SET fin_year = EXCLUDED.fin_year
                WHERE doc_sequences.fin_year != EXCLUDED.fin_year;
        """), {"fy": formatted_fy})
        db.commit()
        data.voucher_no = get_next_doc_no(db, "CN")
        
    try:
        # Create Header
        cn = CreditNote(
            fy_code=data.fy_code,
            voucher_no=data.voucher_no,
            voucher_date=data.voucher_date,
            ref_bill_id=data.ref_bill_id,
            ref_bill_no=data.ref_bill_no,
            ref_bill_date=data.ref_bill_date,
            gl_party_id=data.gl_party_id,
            party_name=data.party_name,
            gl_credit_id=data.gl_credit_id,
            credit_desc=data.credit_desc,
            address1=data.address1,
            address2=data.address2,
            city=data.city,
            state_code=data.state_code,
            gstin=data.gstin,
            is_interstate=data.is_interstate,
            total_qty=data.total_qty,
            gross_amount=data.gross_amount,
            discount_pct=data.discount_pct,
            discount_amt=data.discount_amt,
            taxable_amount=data.taxable_amount,
            cgst_rate=data.cgst_rate,
            cgst_amount=data.cgst_amount,
            sgst_rate=data.sgst_rate,
            sgst_amount=data.sgst_amount,
            igst_rate=data.igst_rate,
            igst_amount=data.igst_amount,
            round_off=data.round_off,
            net_amount=data.net_amount,
            narration=data.narration,
            status="Confirmed"
        )
        db.add(cn)
        db.flush()

        # Create Items
        for i, item in enumerate(data.items, start=1):
            cn_item = CreditNoteItem(
                cn_id=cn.cn_id,
                line_no=i,
                medicine_id=item.medicine_id,
                procedure_id=item.procedure_id,
                item_code=item.item_code,
                item_name=item.item_name,
                hsn_code=item.hsn_code,
                unit=item.unit,
                quantity=item.quantity,
                rate=item.rate,
                discount_pct=item.discount_pct,
                discount_amt=item.discount_amt,
                taxable_amount=item.taxable_amount,
                gst_pct=item.gst_pct,
                cgst_amount=item.cgst_amount,
                sgst_amount=item.sgst_amount,
                igst_amount=item.igst_amount,
                line_total=item.line_total
            )
            db.add(cn_item)
            
        # Post to GL
        # A credit note reduces what the customer owes (AR is a Debtor/asset with a
        # normal DEBIT balance, so reducing it takes a CREDIT) and reduces net sales
        # (a contra-revenue / GST-liability reduction, both of which take a DEBIT —
        # see chart_of_accounts.md project memory for the full reasoning; this used to
        # be backwards, posting a DR to the party and a CR everywhere else, which
        # pushed the customer's balance the WRONG direction on every credit note).
        # CR: gl_party_id (net_amount)      — customer owes less
        # DR: gl_credit_id (taxable_amount) — sales return
        # DR: GST-CGST-PAY (cgst_amount)    — reduce GST liability
        # DR: GST-SGST-PAY (sgst_amount)
        # [if interstate: DR: GST-IGST-PAY]

        cr_party = GLPosting(
            fy_code=data.fy_code,
            posting_date=data.voucher_date,
            gl_id=data.gl_party_id,
            voucher_type="CreditNote",
            voucher_no=data.voucher_no,
            voucher_ref_id=cn.cn_id,
            dr_amount=0,
            cr_amount=data.net_amount or 0,
            narration=data.narration
        )
        db.add(cr_party)

        if data.gl_credit_id and (data.taxable_amount or 0) > 0:
            dr_sales_ret = GLPosting(
                fy_code=data.fy_code,
                posting_date=data.voucher_date,
                gl_id=data.gl_credit_id,
                voucher_type="CreditNote",
                voucher_no=data.voucher_no,
                voucher_ref_id=cn.cn_id,
                dr_amount=data.taxable_amount,
                cr_amount=0,
                narration=data.narration
            )
            db.add(dr_sales_ret)

        if not data.is_interstate:
            if (data.cgst_amount or 0) > 0:
                cgst_gl = get_gl_by_code(db, "GST-CGST-PAY")
                if cgst_gl:
                    db.add(GLPosting(fy_code=data.fy_code, posting_date=data.voucher_date, gl_id=cgst_gl, voucher_type="CreditNote", voucher_no=data.voucher_no, voucher_ref_id=cn.cn_id, dr_amount=data.cgst_amount, cr_amount=0, narration=data.narration))
            if (data.sgst_amount or 0) > 0:
                sgst_gl = get_gl_by_code(db, "GST-SGST-PAY")
                if sgst_gl:
                    db.add(GLPosting(fy_code=data.fy_code, posting_date=data.voucher_date, gl_id=sgst_gl, voucher_type="CreditNote", voucher_no=data.voucher_no, voucher_ref_id=cn.cn_id, dr_amount=data.sgst_amount, cr_amount=0, narration=data.narration))
        else:
            if (data.igst_amount or 0) > 0:
                igst_gl = get_gl_by_code(db, "GST-IGST-PAY")
                if igst_gl:
                    db.add(GLPosting(fy_code=data.fy_code, posting_date=data.voucher_date, gl_id=igst_gl, voucher_type="CreditNote", voucher_no=data.voucher_no, voucher_ref_id=cn.cn_id, dr_amount=data.igst_amount, cr_amount=0, narration=data.narration))

        db.commit()
        db.refresh(cn)
        return cn
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create credit note: {e}")

@router.get("/", response_model=List[CreditNoteOut])
def list_credit_notes(
    fy_code: Optional[str] = Query(None),
    gl_party_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(CreditNote)
    if fy_code:
        query = query.filter(CreditNote.fy_code == fy_code)
    if gl_party_id:
        query = query.filter(CreditNote.gl_party_id == gl_party_id)
        
    return query.order_by(CreditNote.created_at.desc()).all()

@router.get("/{cn_id}", response_model=CreditNoteOut)
def get_credit_note(cn_id: int, db: Session = Depends(get_db)):
    cn = db.query(CreditNote).filter(CreditNote.cn_id == cn_id).first()
    if not cn:
        raise HTTPException(status_code=404, detail="Credit Note not found")
    return cn

@router.delete("/{cn_id}")
def delete_credit_note(cn_id: int, db: Session = Depends(get_db)):
    cn = db.query(CreditNote).filter(CreditNote.cn_id == cn_id).first()
    if not cn:
        raise HTTPException(status_code=404, detail="Credit Note not found")
        
    try:
        cn.status = "Cancelled"
        # Reverse GL Postings
        db.query(GLPosting).filter(
            GLPosting.voucher_type == 'CreditNote',
            GLPosting.voucher_ref_id == cn_id
        ).delete()
        
        db.commit()
        return {"message": "Credit Note cancelled successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to cancel credit note: {e}")
