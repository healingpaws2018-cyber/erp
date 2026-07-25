"""routes/vaccines.py — Vaccine master, vaccination records and reminders"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, literal
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, timedelta

from database import get_db
from models.stage3 import Vaccine, Medicine
from models.phase2 import VaccinationRecord, VaccinationReminder
from models.people import Pet, PetOwner
from models.doctors import Doctor
from schemas.vaccines import (
    VaccineCreate, VaccineOut,
    VaccinationRecordCreate, VaccinationRecordOut,
    ReminderOut
)
from utils.doc_sequence import get_next_doc_no

router = APIRouter(tags=["Vaccines & Vaccination"])


# ── VACCINE MASTER ────────────────────────────────────────────

def _attach_medicine_tax_fields(db: Session, vaccines):
    """Vaccine has no hsn_id/gst_rate_id columns of its own — those live on the
    linked Medicine. Pull them across as plain instance attributes (not persisted)
    so VaccineOut can show/edit the billing item's current tax setup."""
    medicine_ids = [v.medicine_id for v in vaccines if v.medicine_id]
    meds = {}
    if medicine_ids:
        rows = db.query(Medicine.medicine_id, Medicine.hsn_id, Medicine.gst_rate_id)\
                  .filter(Medicine.medicine_id.in_(medicine_ids)).all()
        meds = {r.medicine_id: r for r in rows}
    for v in vaccines:
        m = meds.get(v.medicine_id)
        v.hsn_id = m.hsn_id if m else None
        v.gst_rate_id = m.gst_rate_id if m else None


def _link_medicine(db: Session, vaccine_name: str, hsn_id, gst_rate_id, dosage, existing_medicine_id=None):
    """Ensure this vaccine has a billable Medicine behind it.

    - If `existing_medicine_id` points at a real Medicine, reuse it and sync its
      HSN/GST from the vaccine form (so editing tax fields later stays in sync).
    - Otherwise auto-create a new Medicine from the vaccine's own name/HSN/GST,
      so a freshly-added vaccine is immediately billable in Sales & Purchase bills.
    """
    if existing_medicine_id:
        med = db.query(Medicine).filter(Medicine.medicine_id == existing_medicine_id).first()
        if med:
            if hsn_id is not None:
                med.hsn_id = hsn_id
            if gst_rate_id is not None:
                med.gst_rate_id = gst_rate_id
            return med.medicine_id

    med = Medicine(
        medicine_code=get_next_doc_no(db, "MEDICINE"),
        medicine_name=vaccine_name,
        hsn_id=hsn_id,
        gst_rate_id=gst_rate_id,
        dosage_form="Vaccine",
        strength=dosage,
        reorder_level=0,
        is_active=True,
    )
    db.add(med)
    db.flush()  # get medicine_id
    return med.medicine_id


@router.get("/vaccines", response_model=List[VaccineOut])
def list_vaccines(species_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    q = db.query(Vaccine).filter(Vaccine.is_active == True)
    if species_id:
        q = q.filter((Vaccine.species_id == species_id) | (Vaccine.species_id == None))
    vaccines = q.order_by(Vaccine.vaccine_name).all()
    _attach_medicine_tax_fields(db, vaccines)
    return vaccines


@router.post("/vaccines", response_model=VaccineOut)
def create_vaccine(data: VaccineCreate, db: Session = Depends(get_db)):
    code = get_next_doc_no(db, "VAC")
    payload = data.model_dump()
    hsn_id = payload.pop("hsn_id", None)
    gst_rate_id = payload.pop("gst_rate_id", None)
    manual_medicine_id = payload.pop("medicine_id", None)

    medicine_id = _link_medicine(
        db, data.vaccine_name, hsn_id, gst_rate_id, data.dosage,
        existing_medicine_id=manual_medicine_id
    )

    v = Vaccine(vaccine_code=code, medicine_id=medicine_id, **payload)
    db.add(v); db.commit(); db.refresh(v)
    _attach_medicine_tax_fields(db, [v])
    return v


@router.put("/vaccines/{vaccine_id}", response_model=VaccineOut)
def update_vaccine(vaccine_id: int, data: VaccineCreate, db: Session = Depends(get_db)):
    v = db.query(Vaccine).filter(Vaccine.vaccine_id == vaccine_id).first()
    if not v:
        raise HTTPException(404, "Vaccine not found")

    payload = data.model_dump()
    hsn_id = payload.pop("hsn_id", None)
    gst_rate_id = payload.pop("gst_rate_id", None)
    manual_medicine_id = payload.pop("medicine_id", None)

    medicine_id = _link_medicine(
        db, data.vaccine_name, hsn_id, gst_rate_id, data.dosage,
        existing_medicine_id=manual_medicine_id or v.medicine_id
    )
    payload["medicine_id"] = medicine_id

    for k, val in payload.items():
        setattr(v, k, val)
    db.commit(); db.refresh(v)
    _attach_medicine_tax_fields(db, [v])
    return v


# ── VACCINATION RECORDS ───────────────────────────────────────

@router.get("/vaccination-records", response_model=List[VaccinationRecordOut])
def list_vaccination_records(pet_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    """Retrieve vaccination records, optionally filtered by pet."""
    q = db.query(
        VaccinationRecord.vacc_record_id,
        func.coalesce(VaccinationRecord.vacc_record_no, 'N/A').label("vacc_record_no"),
        VaccinationRecord.pet_id,
        Pet.name.label("pet_name"),
        VaccinationRecord.owner_id,
        VaccinationRecord.vaccine_id,
        Vaccine.vaccine_name,
        Vaccine.medicine_id,
        VaccinationRecord.doctor_id,
        Doctor.name.label("doctor_name"),
        VaccinationRecord.given_date,
        VaccinationRecord.next_due_date,
        VaccinationRecord.batch_no,
        VaccinationRecord.expiry_date,
        VaccinationRecord.dose_ml,
        VaccinationRecord.site,
        VaccinationRecord.notes,
        VaccinationRecord.vaccination_code
    ).join(Pet, Pet.pet_id == VaccinationRecord.pet_id)\
     .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)\
     .outerjoin(Doctor, Doctor.doctor_id == VaccinationRecord.doctor_id)
    
    if pet_id:
        q = q.filter(VaccinationRecord.pet_id == pet_id)
        
    try:
        results = q.order_by(VaccinationRecord.given_date.desc()).all()
        return results
    except Exception as e:
        # Fallback if column vaccination_code is missing
        db.rollback()
        q_safe = db.query(
            VaccinationRecord.vacc_record_id,
            func.coalesce(VaccinationRecord.vacc_record_no, 'N/A').label("vacc_record_no"),
            VaccinationRecord.pet_id,
            Pet.name.label("pet_name"),
            VaccinationRecord.owner_id,
            VaccinationRecord.vaccine_id,
            Vaccine.vaccine_name,
            Vaccine.medicine_id,
            VaccinationRecord.doctor_id,
            Doctor.name.label("doctor_name"),
            VaccinationRecord.given_date,
            VaccinationRecord.next_due_date,
            VaccinationRecord.batch_no,
            VaccinationRecord.expiry_date,
            VaccinationRecord.dose_ml,
            VaccinationRecord.site,
            VaccinationRecord.notes,
            literal('Pending Migration').label("vaccination_code")
        ).join(Pet, Pet.pet_id == VaccinationRecord.pet_id)\
         .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)\
         .outerjoin(Doctor, Doctor.doctor_id == VaccinationRecord.doctor_id)
        return q_safe.order_by(VaccinationRecord.given_date.desc()).all()


@router.get("/vaccination-records/{record_id}", response_model=VaccinationRecordOut)
def get_vaccination_record(record_id: int, db: Session = Depends(get_db)):
    q = db.query(
        VaccinationRecord.vacc_record_id,
        func.coalesce(VaccinationRecord.vacc_record_no, 'N/A').label("vacc_record_no"),
        VaccinationRecord.pet_id,
        Pet.name.label("pet_name"),
        VaccinationRecord.owner_id,
        VaccinationRecord.vaccine_id,
        Vaccine.vaccine_name,
        Vaccine.medicine_id,
        VaccinationRecord.doctor_id,
        Doctor.name.label("doctor_name"),
        VaccinationRecord.given_date,
        VaccinationRecord.next_due_date,
        VaccinationRecord.batch_no,
        VaccinationRecord.expiry_date,
        VaccinationRecord.dose_ml,
        VaccinationRecord.site,
        VaccinationRecord.notes,
        VaccinationRecord.vaccination_code
    ).join(Pet, Pet.pet_id == VaccinationRecord.pet_id)\
     .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)\
     .outerjoin(Doctor, Doctor.doctor_id == VaccinationRecord.doctor_id)

    try:
        res = q.filter(VaccinationRecord.vacc_record_id == record_id).first()
        if not res:
            raise HTTPException(404, "Record not found")
        return res
    except Exception:
        db.rollback()
        res_safe = db.query(
            VaccinationRecord.vacc_record_id,
            func.coalesce(VaccinationRecord.vacc_record_no, 'N/A').label("vacc_record_no"),
            VaccinationRecord.pet_id,
            Pet.name.label("pet_name"),
            VaccinationRecord.owner_id,
            VaccinationRecord.vaccine_id,
            Vaccine.vaccine_name,
            Vaccine.medicine_id,
            VaccinationRecord.doctor_id,
            Doctor.name.label("doctor_name"),
            VaccinationRecord.given_date,
            VaccinationRecord.next_due_date,
            VaccinationRecord.batch_no,
            VaccinationRecord.expiry_date,
            VaccinationRecord.dose_ml,
            VaccinationRecord.site,
            VaccinationRecord.notes,
            literal('Pending Migration').label("vaccination_code")
        ).join(Pet, Pet.pet_id == VaccinationRecord.pet_id)\
         .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)\
         .outerjoin(Doctor, Doctor.doctor_id == VaccinationRecord.doctor_id)\
         .filter(VaccinationRecord.vacc_record_id == record_id).first()
        if not res_safe:
            raise HTTPException(404, "Record not found")
        return res_safe


@router.post("/vaccination-records", response_model=VaccinationRecordOut)
def record_vaccination(data: VaccinationRecordCreate, db: Session = Depends(get_db)):
    # Generate unique sequence numbers
    vrc_no = get_next_doc_no(db, "VRC")
    vc_code = get_next_doc_no(db, "VC")

    # Auto-calculate next due date if not provided
    next_due = data.next_due_date
    if not next_due:
        vaccine = db.query(Vaccine).filter(Vaccine.vaccine_id == data.vaccine_id).first()
        if vaccine and vaccine.interval_days:
            next_due = data.given_date + timedelta(days=vaccine.interval_days)

    rec = VaccinationRecord(
        vacc_record_no=vrc_no, 
        vaccination_code=vc_code, 
        next_due_date=next_due, 
        **data.model_dump(exclude={"vaccination_code", "next_due_date"})
    )
    db.add(rec); db.flush()

    # Auto-create reminder if next_due exists
    if next_due:
        reminder = VaccinationReminder(
            vacc_record_id=rec.vacc_record_id,
            pet_id=data.pet_id,
            owner_id=data.owner_id,
            due_date=next_due,
            reminder_status="Pending"
        )
        db.add(reminder)

    db.commit(); db.refresh(rec)
    return get_vaccination_record(rec.vacc_record_id, db)


@router.put("/vaccination-records/{record_id}", response_model=VaccinationRecordOut)
def update_vaccination_record(record_id: int, data: VaccinationRecordCreate, db: Session = Depends(get_db)):
    rec = db.query(VaccinationRecord).filter(VaccinationRecord.vacc_record_id == record_id).first()
    if not rec:
        raise HTTPException(404, "Record not found")
    
    for k, v in data.model_dump().items():
        setattr(rec, k, v)
        
    db.commit()
    return get_vaccination_record(record_id, db)


@router.delete("/vaccination-records/{record_id}")
def delete_vaccination_record(record_id: int, db: Session = Depends(get_db)):
    rec = db.query(VaccinationRecord).filter(VaccinationRecord.vacc_record_id == record_id).first()
    if not rec:
        raise HTTPException(404, "Record not found")
    
    # Also delete associated reminders
    db.query(VaccinationReminder).filter(VaccinationReminder.vacc_record_id == record_id).delete()
    db.delete(rec)
    db.commit()
    return {"message": "Record deleted"}


# ── VACCINATION REMINDERS ──────────────────────────────────────

@router.get("/vaccination-reminders/due", response_model=List[ReminderOut])
def due_reminders(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    """Pets due for vaccination in the next N days (default 30)."""
    cutoff = date.today() + timedelta(days=days)
    results = db.query(
        VaccinationReminder.reminder_id,
        VaccinationReminder.vacc_record_id,
        VaccinationReminder.pet_id,
        Pet.name.label("pet_name"),
        VaccinationReminder.owner_id,
        PetOwner.name.label("owner_name"),
        PetOwner.phone,
        PetOwner.email,
        Vaccine.vaccine_name,
        VaccinationReminder.due_date,
        VaccinationReminder.reminder_status,
        VaccinationReminder.notified_at,
        VaccinationReminder.notified_via
    ).join(Pet, Pet.pet_id == VaccinationReminder.pet_id)\
     .join(PetOwner, PetOwner.owner_id == VaccinationReminder.owner_id)\
     .join(VaccinationRecord, VaccinationRecord.vacc_record_id == VaccinationReminder.vacc_record_id)\
     .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)\
     .filter(
        VaccinationReminder.due_date <= cutoff,
        VaccinationReminder.due_date >= date.today(),
        VaccinationReminder.reminder_status.in_(["Pending", "Notified"])
    ).order_by(VaccinationReminder.due_date).all()
    return results


@router.get("/vaccination-reminders/overdue", response_model=List[ReminderOut])
def overdue_reminders(db: Session = Depends(get_db)):
    """Pets that are overdue for vaccination."""
    results = db.query(
        VaccinationReminder.reminder_id,
        VaccinationReminder.vacc_record_id,
        VaccinationReminder.pet_id,
        Pet.name.label("pet_name"),
        VaccinationReminder.owner_id,
        PetOwner.name.label("owner_name"),
        PetOwner.phone,
        PetOwner.email,
        Vaccine.vaccine_name,
        VaccinationReminder.due_date,
        VaccinationReminder.reminder_status,
        VaccinationReminder.notified_at,
        VaccinationReminder.notified_via
    ).join(Pet, Pet.pet_id == VaccinationReminder.pet_id)\
     .join(PetOwner, PetOwner.owner_id == VaccinationReminder.owner_id)\
     .join(VaccinationRecord, VaccinationRecord.vacc_record_id == VaccinationReminder.vacc_record_id)\
     .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)\
     .filter(
        VaccinationReminder.due_date < date.today(),
        VaccinationReminder.reminder_status.in_(["Pending", "Notified"])
    ).order_by(VaccinationReminder.due_date).all()
    return results


@router.put("/vaccination-reminders/{reminder_id}/notified")
def mark_notified(reminder_id: int, db: Session = Depends(get_db)):
    from datetime import datetime
    r = db.query(VaccinationReminder).filter(VaccinationReminder.reminder_id == reminder_id).first()
    if not r:
        raise HTTPException(404, "Reminder not found")
    r.reminder_status = "Notified"
    r.notified_at = datetime.utcnow()
    r.notified_via = "In-App"
    db.commit()
    return {"message": "Marked as notified"}


@router.put("/vaccination-reminders/{reminder_id}/done")
def mark_done(reminder_id: int, db: Session = Depends(get_db)):
    from datetime import datetime
    r = db.query(VaccinationReminder).filter(VaccinationReminder.reminder_id == reminder_id).first()
    if not r:
        raise HTTPException(404, "Reminder not found")
    r.reminder_status = "Done"
    db.commit()
    return {"message": "Marked as done"}
