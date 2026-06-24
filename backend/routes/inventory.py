"""routes/inventory.py — Medicine Master, Suppliers, and Stock tracking (Stage 3)"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
from models.stage3 import Medicine, MedicineBatch, StockLedger, Unit
from models.phase3 import Supplier
from schemas.pharmacy import (
    SupplierCreate, SupplierOut,
    MedicineCreate, MedicineOut,
    BatchCreate, BatchUpdate, BatchOut,
    UnitCreate, UnitOut, StockLedgerOut
)
from utils.doc_sequence import get_next_doc_no
from utils.gl_utils import create_gl_account
from utils.stock import post_stock_ledger
from models.users import User

router = APIRouter(prefix="/inventory", tags=["Inventory"])


def _valid_created_by(db: Session):
    """Return a real users.user_id in THIS tenant DB, else None.

    Hardcoding 1 triggers a FK violation when the tenant's users table has no
    user_id=1 (the created_by column is nullable, so None is safe)."""
    row = db.query(User.user_id).order_by(User.user_id).first()
    return row[0] if row else None

# ── UNITS ───────────────────────────────────────────────────
@router.get("/units", response_model=List[UnitOut])
def list_units(db: Session = Depends(get_db)):
    return db.query(Unit).filter(Unit.is_active == True).order_by(Unit.unit_name).all()

@router.post("/units", response_model=UnitOut)
def create_unit(data: UnitCreate, db: Session = Depends(get_db)):
    existing = db.query(Unit).filter(Unit.unit_name.ilike(data.unit_name)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Unit already exists")
    u = Unit(**data.model_dump())
    db.add(u)
    db.commit()
    db.refresh(u)
    return u

# ── SUPPLIERS ────────────────────────────────────────────────
@router.get("/suppliers", response_model=List[SupplierOut])
def list_suppliers(search: Optional[str] = Query(None), include_inactive: bool = Query(False), db: Session = Depends(get_db)):
    q = db.query(Supplier)
    if not include_inactive:
        q = q.filter(Supplier.is_active == True)
    if search:
        q = q.filter(Supplier.supplier_name.ilike(f"%{search}%"))
    return q.order_by(Supplier.supplier_name).all()

@router.post("/suppliers", response_model=SupplierOut)
def create_supplier(data: SupplierCreate, db: Session = Depends(get_db)):
    payload = data.model_dump()
    if not payload.get("supplier_code"):
        payload["supplier_code"] = get_next_doc_no(db, "SUP")
    
    # Auto-create GL Account
    gl_id = create_gl_account("supplier", data.supplier_name, db, **payload)
    payload["gl_account_id"] = gl_id

    s = Supplier(**payload)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s

@router.put("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: int, data: SupplierCreate, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s

@router.delete("/suppliers/{supplier_id}")
def deactivate_supplier(supplier_id: int, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    s.is_active = False
    db.commit()
    return {"message": "Supplier deactivated"}

@router.put("/suppliers/{supplier_id}/reactivate", response_model=SupplierOut)
def reactivate_supplier(supplier_id: int, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.supplier_id == supplier_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    s.is_active = True
    db.commit()
    db.refresh(s)
    return s


# ── MEDICINES ────────────────────────────────────────────────
@router.get("/medicines", response_model=List[MedicineOut])
def list_medicines(search: Optional[str] = Query(None), include_inactive: bool = Query(False), db: Session = Depends(get_db)):
    from sqlalchemy.orm import joinedload
    q = db.query(Medicine).options(joinedload(Medicine.gst_rate))
    if not include_inactive:
        q = q.filter(Medicine.is_active == True)
    if search:
        q = q.filter(Medicine.medicine_name.ilike(f"%{search}%") | Medicine.medicine_name2.ilike(f"%{search}%"))
    
    results = q.order_by(Medicine.medicine_name).all()
    for m in results:
        m.gst_pct = m.gst_rate.gst_percent if m.gst_rate else 12
    return results

@router.post("/medicines", response_model=MedicineOut)
def create_medicine(data: MedicineCreate, db: Session = Depends(get_db)):
    payload = data.model_dump()
    if not payload.get("medicine_code"):
        payload["medicine_code"] = get_next_doc_no(db, "MEDICINE")
    m = Medicine(**payload)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m

@router.put("/medicines/{medicine_id}", response_model=MedicineOut)
def update_medicine(medicine_id: int, data: MedicineCreate, db: Session = Depends(get_db)):
    from sqlalchemy.orm import joinedload
    m = db.query(Medicine).options(joinedload(Medicine.gst_rate)).filter(Medicine.medicine_id == medicine_id).first()
    if not m: raise HTTPException(404, "Medicine not found")
    # Exclude medicine_code from updates to avoid overwriting the auto-generated code
    update_fields = {k: v for k, v in data.model_dump().items() if k != 'medicine_code'}
    for k, v in update_fields.items():
        setattr(m, k, v)
    db.commit(); db.refresh(m)
    # Set gst_pct virtual field (same as list endpoint) to satisfy MedicineOut schema
    m.gst_pct = m.gst_rate.gst_percent if m.gst_rate else None
    return m

# ── BATCHES & STOCK ──────────────────────────────────────────
@router.get("/batches/{medicine_id}", response_model=List[BatchOut])
def get_medicine_batches(medicine_id: int, db: Session = Depends(get_db)):
    """Get all active batches for a medicine.

    Treat NULL is_active as active (only an explicit False = soft-deleted), so
    batches created before the is_active column existed are not hidden."""
    return db.query(MedicineBatch).filter(
        MedicineBatch.medicine_id == medicine_id,
        MedicineBatch.is_active.isnot(False)
    ).order_by(MedicineBatch.expiry_date.asc()).all()

@router.post("/batches", response_model=BatchOut)
def create_opening_batch(data: BatchCreate, db: Session = Depends(get_db)):
    """Add manual opening stock batch"""
    payload = data.model_dump()
    qty = payload.pop("opening_qty", 0)
    
    b = MedicineBatch(**payload, opening_qty=qty)
    db.add(b)
    db.flush() # get b.batch_id
    
    if qty > 0:
        post_stock_ledger(
            db, b.medicine_id, b.batch_id, 
            txn_type="OPENING", qty=qty,
            ref_type="Opening", ref_id=None, ref_number="OPENING",
            created_by=_valid_created_by(db)
        )
    
    db.commit(); db.refresh(b)
    return b

@router.put("/batches/{batch_id}", response_model=BatchOut)
def update_batch(batch_id: int, data: BatchUpdate, db: Session = Depends(get_db)):
    """Edit a batch — adjusts stock ledger if opening_qty changes"""
    b = db.query(MedicineBatch).filter(MedicineBatch.batch_id == batch_id).first()
    if not b:
        raise HTTPException(404, "Batch not found")

    # If opening_qty is being changed, post a ADJUSTMENT ledger entry for the delta
    if data.opening_qty is not None:
        old_qty = float(b.opening_qty)
        new_qty = float(data.opening_qty)
        delta   = new_qty - old_qty
        if delta != 0:
            txn_type = "ADJUSTMENT+" if delta > 0 else "ADJUSTMENT-"
            post_stock_ledger(
                db, b.medicine_id, b.batch_id,
                txn_type=txn_type, qty=abs(delta),
                ref_type="BatchEdit", ref_id=batch_id, ref_number=f"BATCHEDIT-{batch_id}",
                created_by=_valid_created_by(db)
            )
        b.opening_qty = new_qty

    # Update other editable fields
    for field in ("batch_no", "mfg_date", "expiry_date", "purchase_price", "sale_price", "mrp"):
        val = getattr(data, field)
        if val is not None:
            setattr(b, field, val)

    db.commit()
    db.refresh(b)
    return b


@router.delete("/batches/{batch_id}")
def delete_batch(batch_id: int, db: Session = Depends(get_db)):
    """Soft-delete a batch — reverses its stock from the ledger and marks it inactive.
    Hard delete is intentionally avoided because stock_ledger, sales_bill_items,
    purchase_bill_items, and pharmacy_bill_items all have FK references to batch_id."""
    from models.phase3 import PurchaseBillItem, PharmacyBillItem

    b = db.query(MedicineBatch).filter(MedicineBatch.batch_id == batch_id).first()
    if not b:
        raise HTTPException(404, "Batch not found")

    # Block deletion if this batch has been used in any purchase or pharmacy bill
    used_in_purchase = db.query(PurchaseBillItem).filter(
        PurchaseBillItem.batch_id == batch_id
    ).first()
    used_in_pharmacy = db.query(PharmacyBillItem).filter(
        PharmacyBillItem.batch_id == batch_id
    ).first()

    if used_in_purchase or used_in_pharmacy:
        raise HTTPException(
            status_code=400,
            detail=f"Batch '{b.batch_no}' cannot be deleted because it has been used in bills. "
                   "You can edit the batch details instead."
        )

    current_qty = float(b.current_qty)
    if current_qty > 0:
        # Reverse whatever stock is in this batch
        post_stock_ledger(
            db, b.medicine_id, b.batch_id,
            txn_type="ADJUSTMENT-", qty=current_qty,
            ref_type="BatchDelete", ref_id=batch_id, ref_number=f"BATCHDEL-{batch_id}",
            created_by=_valid_created_by(db)
        )

    # Soft-delete: mark inactive instead of hard delete to preserve FK integrity
    b.is_active = False
    db.commit()
    return {"message": "Batch deleted"}


@router.get("/stock-ledger", response_model=List[StockLedgerOut])
def get_stock_ledger(medicine_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(StockLedger)
    if medicine_id:
        q = q.filter(StockLedger.medicine_id == medicine_id)
    rows = q.order_by(StockLedger.created_at.desc()).limit(100).all()

    # Resolve item & batch names for display (avoid N+1 with a couple of lookups).
    med_ids = {r.medicine_id for r in rows}
    batch_ids = {r.batch_id for r in rows}
    med_names = dict(
        db.query(Medicine.medicine_id, Medicine.medicine_name)
        .filter(Medicine.medicine_id.in_(med_ids)).all()
    ) if med_ids else {}
    batch_nos = dict(
        db.query(MedicineBatch.batch_id, MedicineBatch.batch_no)
        .filter(MedicineBatch.batch_id.in_(batch_ids)).all()
    ) if batch_ids else {}

    out = []
    for r in rows:
        out.append({
            "ledger_id": r.ledger_id,
            "medicine_id": r.medicine_id,
            "medicine_name": med_names.get(r.medicine_id),
            "batch_id": r.batch_id,
            "batch_no": batch_nos.get(r.batch_id),
            "txn_date": r.txn_date,
            "txn_type": r.txn_type,
            "qty_in": r.qty_in,
            "qty_out": r.qty_out,
            "ref_type": r.ref_type,
            "ref_number": r.ref_number,
            "notes": r.notes,
            "created_at": r.created_at,
        })
    return out


@router.post("/recalculate-stock")
def recalculate_all_stock(db: Session = Depends(get_db)):
    """One-time fix: set medicine.current_stock = sum of all its batch current_qty.
    Run this once after upgrading to the unified post_stock_ledger flow."""
    from sqlalchemy import func as sqlfunc
    medicines = db.query(Medicine).all()
    corrections = []
    for m in medicines:
        total = db.query(sqlfunc.coalesce(sqlfunc.sum(MedicineBatch.current_qty), 0))\
                   .filter(MedicineBatch.medicine_id == m.medicine_id)\
                   .scalar() or 0
        old = float(m.current_stock)
        m.current_stock = total
        if abs(float(total) - old) > 0.001:
            corrections.append({
                "medicine_id": m.medicine_id,
                "name": m.medicine_name,
                "old_stock": old,
                "corrected_to": float(total)
            })
    db.commit()
    return {"message": f"Recalculated {len(medicines)} medicines", "corrections": corrections}
