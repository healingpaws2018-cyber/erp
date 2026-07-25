from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime, date
from decimal import Decimal

from database import get_db
from models.accounts import DebitNote, DebitNoteItem, GLPosting
from models.phase4 import GLMaster
from schemas.accounts import (
    DebitNoteCreate, DebitNoteOut
)
from utils.doc_sequence import get_next_doc_no, format_fy

router = APIRouter(prefix="/accounts/debit-notes", tags=["Accounts"])

def get_gl_by_code(db: Session, code: str) -> Optional[int]:
    gl = db.query(GLMaster).filter(GLMaster.gl_code == code).first()
    return gl.gl_id if gl else None

@router.post("/", response_model=DebitNoteOut)
def create_debit_note(data: DebitNoteCreate, db: Session = Depends(get_db)):
    if not data.voucher_no:
        formatted_fy = format_fy(data.fy_code) if data.fy_code else ""
        db.execute(text("""
            INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
            VALUES ('DN', 'DN-', 0, 5, true, :fy, true)
            ON CONFLICT (doc_type) DO UPDATE
                SET fin_year = EXCLUDED.fin_year
                WHERE doc_sequences.fin_year != EXCLUDED.fin_year;
        """), {"fy": formatted_fy})
        db.commit()
        data.voucher_no = get_next_doc_no(db, "DN")
        
    try:
        # Create Header
        dn = DebitNote(
            fy_code=data.fy_code,
            voucher_no=data.voucher_no,
            voucher_date=data.voucher_date,
            ref_bill_id=data.ref_bill_id,
            ref_bill_no=data.ref_bill_no,
            ref_bill_date=data.ref_bill_date,
            gl_party_id=data.gl_party_id,
            party_name=data.party_name,
            gl_debit_id=data.gl_debit_id,
            debit_desc=data.debit_desc,
            supplier_id=data.supplier_id,
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
        db.add(dn)
        db.flush()

        # Create Items
        for i, item in enumerate(data.items, start=1):
            dn_item = DebitNoteItem(
                dn_id=dn.dn_id,
                line_no=i,
                medicine_id=item.medicine_id,
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
            db.add(dn_item)
            
        # Post to GL
        # A debit note reduces what WE owe the supplier (Creditors is a liability with
        # a normal CREDIT balance, so reducing it takes a DEBIT) and reduces our
        # purchases expense and recoverable input GST (both normal-DEBIT accounts, so
        # reducing them takes a CREDIT) — see chart_of_accounts.md project memory. This
        # used to be backwards (CR the party, DR everywhere else), which pushed the
        # supplier's balance the WRONG direction — increasing what we appeared to owe
        # them — on every debit note.
        # DR: gl_party_id (net_amount)       — supplier owes less
        # CR: gl_debit_id (taxable_amount)   — purchase return
        # CR: GST-CGST-IN (cgst_amount)      — reduce input credit
        # CR: GST-SGST-IN (sgst_amount)
        # [if interstate: CR: GST-IGST-IN]

        dr_party = GLPosting(
            fy_code=data.fy_code,
            posting_date=data.voucher_date,
            gl_id=data.gl_party_id,
            voucher_type="DebitNote",
            voucher_no=data.voucher_no,
            voucher_ref_id=dn.dn_id,
            dr_amount=data.net_amount or 0,
            cr_amount=0,
            narration=data.narration
        )
        db.add(dr_party)

        if data.gl_debit_id and (data.taxable_amount or 0) > 0:
            cr_purch_ret = GLPosting(
                fy_code=data.fy_code,
                posting_date=data.voucher_date,
                gl_id=data.gl_debit_id,
                voucher_type="DebitNote",
                voucher_no=data.voucher_no,
                voucher_ref_id=dn.dn_id,
                dr_amount=0,
                cr_amount=data.taxable_amount,
                narration=data.narration
            )
            db.add(cr_purch_ret)

        if not data.is_interstate:
            if (data.cgst_amount or 0) > 0:
                cgst_gl = get_gl_by_code(db, "GST-CGST-IN")
                if cgst_gl:
                    db.add(GLPosting(fy_code=data.fy_code, posting_date=data.voucher_date, gl_id=cgst_gl, voucher_type="DebitNote", voucher_no=data.voucher_no, voucher_ref_id=dn.dn_id, dr_amount=0, cr_amount=data.cgst_amount, narration=data.narration))
            if (data.sgst_amount or 0) > 0:
                sgst_gl = get_gl_by_code(db, "GST-SGST-IN")
                if sgst_gl:
                    db.add(GLPosting(fy_code=data.fy_code, posting_date=data.voucher_date, gl_id=sgst_gl, voucher_type="DebitNote", voucher_no=data.voucher_no, voucher_ref_id=dn.dn_id, dr_amount=0, cr_amount=data.sgst_amount, narration=data.narration))
        else:
            if (data.igst_amount or 0) > 0:
                igst_gl = get_gl_by_code(db, "GST-IGST-IN")
                if igst_gl:
                    db.add(GLPosting(fy_code=data.fy_code, posting_date=data.voucher_date, gl_id=igst_gl, voucher_type="DebitNote", voucher_no=data.voucher_no, voucher_ref_id=dn.dn_id, dr_amount=0, cr_amount=data.igst_amount, narration=data.narration))

        db.commit()
        db.refresh(dn)
        return dn
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create debit note: {e}")

@router.get("/", response_model=List[DebitNoteOut])
def list_debit_notes(
    fy_code: Optional[str] = Query(None),
    gl_party_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(DebitNote)
    if fy_code:
        query = query.filter(DebitNote.fy_code == fy_code)
    if gl_party_id:
        query = query.filter(DebitNote.gl_party_id == gl_party_id)
        
    return query.order_by(DebitNote.created_at.desc()).all()

@router.get("/{dn_id}", response_model=DebitNoteOut)
def get_debit_note(dn_id: int, db: Session = Depends(get_db)):
    dn = db.query(DebitNote).filter(DebitNote.dn_id == dn_id).first()
    if not dn:
        raise HTTPException(status_code=404, detail="Debit Note not found")
    return dn

@router.delete("/{dn_id}")
def delete_debit_note(dn_id: int, db: Session = Depends(get_db)):
    dn = db.query(DebitNote).filter(DebitNote.dn_id == dn_id).first()
    if not dn:
        raise HTTPException(status_code=404, detail="Debit Note not found")
        
    try:
        dn.status = "Cancelled"
        # Reverse GL Postings
        db.query(GLPosting).filter(
            GLPosting.voucher_type == 'DebitNote',
            GLPosting.voucher_ref_id == dn_id
        ).delete()
        
        db.commit()
        return {"message": "Debit Note cancelled successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to cancel debit note: {e}")
