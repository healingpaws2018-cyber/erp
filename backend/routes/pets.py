"""routes/pets.py — Pet CRUD with auto-code generation"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from database import get_db
from models.people import Pet
from schemas.pets import PetCreate, PetUpdate, PetOut
from utils.doc_sequence import get_next_doc_no

router = APIRouter(prefix="/pets", tags=["Pets"])



@router.get("", response_model=List[PetOut])
def list_pets(
    search: Optional[str] = Query(None),
    owner_id: Optional[int] = Query(None),
    species_id: Optional[int] = Query(None),
    include_inactive: bool = Query(False),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    q = db.query(Pet)
    if not include_inactive:
        q = q.filter(Pet.is_active == True)
    if search:
        q = q.filter(
            (Pet.name.ilike(f"%{search}%")) |
            (Pet.pet_code.ilike(f"%{search}%"))
        )
    if owner_id:
        q = q.filter(Pet.owner_id == owner_id)
    if species_id:
        q = q.filter(Pet.species_id == species_id)
    return q.order_by(Pet.name).offset(skip).limit(limit).all()


@router.get("/{pet_id}", response_model=PetOut)
def get_pet(pet_id: int, db: Session = Depends(get_db)):
    pet = db.query(Pet).filter(Pet.pet_id == pet_id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")
    return pet


@router.post("", response_model=PetOut)
def create_pet(data: PetCreate, db: Session = Depends(get_db)):
    payload = data.model_dump()
    if not payload.get("pet_code"):
        payload["pet_code"] = get_next_doc_no(db, "PET")
    pet = Pet(**payload)
    db.add(pet)
    db.commit()
    db.refresh(pet)
    return pet


@router.put("/{pet_id}", response_model=PetOut)
def update_pet(pet_id: int, data: PetUpdate, db: Session = Depends(get_db)):
    pet = db.query(Pet).filter(Pet.pet_id == pet_id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(pet, k, v)
    db.commit()
    db.refresh(pet)
    return pet


@router.delete("/{pet_id}")
def delete_pet(pet_id: int, db: Session = Depends(get_db)):
    pet = db.query(Pet).filter(Pet.pet_id == pet_id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")
    pet.is_active = False
    db.commit()
    return {"message": "Pet deactivated"}


@router.put("/{pet_id}/reactivate", response_model=PetOut)
def reactivate_pet(pet_id: int, db: Session = Depends(get_db)):
    pet = db.query(Pet).filter(Pet.pet_id == pet_id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")
    pet.is_active = True
    db.commit()
    db.refresh(pet)
    return pet


@router.get("/{pet_id}/book")
def get_pet_book(pet_id: int, db: Session = Depends(get_db)):
    pet = db.query(Pet).filter(Pet.pet_id == pet_id).first()
    if not pet:
        raise HTTPException(status_code=404, detail="Pet not found")

    # Fetch Owner, Species, Breed
    from models.people import PetOwner, PetClinicalSummary, PetAllergy, PetVitalsLog, PetLabRecord, PetTimelineEvent
    from models.phase2 import Consultation, VaccinationRecord, Prescription, PrescriptionItem
    from models.masters import Species, Breed

    owner = db.query(PetOwner).filter(PetOwner.owner_id == pet.owner_id).first()
    species = db.query(Species).filter(Species.species_id == pet.species_id).first()
    breed = db.query(Breed).filter(Breed.breed_id == pet.breed_id).first() if pet.breed_id else None

    # Fetch Summary
    summary = db.query(PetClinicalSummary).filter(PetClinicalSummary.pet_id == pet_id).first()
    if not summary:
        summary = PetClinicalSummary(
            pet_id=pet_id,
            blood_group=pet.blood_group or "Unknown",
            microchip_no=pet.microchip_no,
            is_spayed_neutered=pet.is_neutered,
            warning_flags="NONE"
        )
        db.add(summary)
        db.commit()
        db.refresh(summary)

    # Fetch Allergies
    allergies = db.query(PetAllergy).filter(PetAllergy.pet_id == pet_id).all()

    # Fetch Vitals
    vitals = db.query(PetVitalsLog).filter(PetVitalsLog.pet_id == pet_id).order_by(PetVitalsLog.recorded_at.desc()).all()

    # Fetch Labs
    labs = db.query(PetLabRecord).filter(PetLabRecord.pet_id == pet_id).order_by(PetLabRecord.sample_collected_date.desc()).all()

    # Build the medical timeline LIVE from the source records on every request, so
    # newly added consultations / vaccinations / prescriptions always appear. (The
    # old approach seeded a PetTimelineEvent snapshot once and never refreshed it,
    # which is why vaccinations recorded later never showed up.)
    from models.stage3 import Vaccine

    timeline_out = []

    # Consultations
    for c in db.query(Consultation).filter(Consultation.pet_id == pet_id).all():
        details = []
        if c.chief_complaint:
            details.append({"label": "Chief Complaint", "value": c.chief_complaint})
        if c.diagnosis:
            details.append({"label": "Diagnosis", "value": c.diagnosis})
        if c.clinical_notes:
            details.append({"label": "Clinical Notes", "value": c.clinical_notes})
        if c.advice:
            details.append({"label": "Advice / Treatment", "value": c.advice})
        timeline_out.append({
            "event_id": f"c{c.consult_id}",
            "event_date": str(c.consult_date),
            "event_type": "CONSULTATION",
            "ref_id": c.consult_id,
            "title": f"Consultation ({c.visit_type})",
            "summary_snippet": c.chief_complaint or c.clinical_notes or "Routine checkup",
            "doctor_id": c.doctor_id,
            "details": details,
            "medicines": [],
        })

    # Vaccinations — resolve the vaccine NAME (not its id) and surface details.
    for v in db.query(VaccinationRecord).filter(VaccinationRecord.pet_id == pet_id).all():
        vac = db.query(Vaccine).filter(Vaccine.vaccine_id == v.vaccine_id).first()
        vac_name = vac.vaccine_name if vac else f"Vaccine #{v.vaccine_id}"
        details = []
        if v.given_date:
            details.append({"label": "Given On", "value": str(v.given_date)})
        if v.next_due_date:
            details.append({"label": "Next Due", "value": str(v.next_due_date)})
        if v.dose_ml:
            details.append({"label": "Dose", "value": f"{v.dose_ml} ml"})
        if v.batch_no:
            details.append({"label": "Batch No", "value": v.batch_no})
        if v.manufacturer:
            details.append({"label": "Manufacturer", "value": v.manufacturer})
        if v.site:
            details.append({"label": "Site", "value": v.site})
        if v.notes:
            details.append({"label": "Notes", "value": v.notes})
        timeline_out.append({
            "event_id": f"v{v.vacc_record_id}",
            "event_date": str(v.given_date),
            "event_type": "VACCINE",
            "ref_id": v.vacc_record_id,
            "title": f"Vaccination — {vac_name}",
            "summary_snippet": (f"Next due: {v.next_due_date}" if v.next_due_date else "Vaccine administered"),
            "doctor_id": v.doctor_id,
            "details": details,
            "medicines": [],
        })

    # Prescriptions — pull the actual prescribed medicine items.
    for rx in db.query(Prescription).filter(Prescription.pet_id == pet_id).all():
        meds = []
        for it in db.query(PrescriptionItem).filter(PrescriptionItem.prescription_id == rx.prescription_id).all():
            meds.append({
                "medicine_name": it.medicine_name,
                "strength": it.strength,
                "dosage_form": it.dosage_form,
                "dose": it.dose,
                "frequency": it.frequency,
                "route": it.route,
                "duration_days": it.duration_days,
                "instructions": it.instructions,
                "quantity": float(it.quantity) if it.quantity is not None else None,
            })
        details = []
        if rx.notes:
            details.append({"label": "Notes", "value": rx.notes})
        timeline_out.append({
            "event_id": f"rx{rx.prescription_id}",
            "event_date": str(rx.rx_date),
            "event_type": "PRESCRIPTION",
            "ref_id": rx.prescription_id,
            "title": f"Prescription ({rx.rx_no})",
            "summary_snippet": rx.notes or "Medicines prescribed",
            "doctor_id": rx.doctor_id,
            "details": details,
            "medicines": meds,
        })

    # Newest first
    timeline_out.sort(key=lambda e: e["event_date"], reverse=True)

    # Merge vitals: dedicated PetVitalsLog entries PLUS vitals captured during a
    # consultation (temp/weight/HR/RR live on the consultation row, so they would
    # otherwise never appear in the Vitals tab).
    vitals_out = []
    logged_consult_ids = {v.consult_id for v in vitals if v.consult_id}
    for v in vitals:
        vitals_out.append({
            "vital_id": v.vital_id,
            "recorded_at": str(v.recorded_at),
            "weight_kg": float(v.weight_kg) if v.weight_kg else None,
            "temp_celsius": float(v.temp_celsius) if v.temp_celsius else None,
            "heart_rate": v.heart_rate,
            "resp_rate": v.resp_rate,
            "body_condition_score": v.body_condition_score,
            "source": "Vitals Log",
        })
    consults_all = db.query(Consultation).filter(Consultation.pet_id == pet_id).order_by(Consultation.consult_date.desc()).all()
    for c in consults_all:
        if c.consult_id in logged_consult_ids:
            continue
        if not any([c.temp_celsius, c.weight_kg, c.heart_rate, c.resp_rate]):
            continue
        vitals_out.append({
            "vital_id": f"c{c.consult_id}",
            "recorded_at": str(c.consult_date),
            "weight_kg": float(c.weight_kg) if c.weight_kg else None,
            "temp_celsius": float(c.temp_celsius) if c.temp_celsius else None,
            "heart_rate": c.heart_rate,
            "resp_rate": c.resp_rate,
            "body_condition_score": None,
            "source": f"Consultation ({c.consult_no})",
        })
    vitals_out.sort(key=lambda r: r["recorded_at"], reverse=True)

    # "Current weight" = most recent MEASURED weight (from vitals log or a
    # consultation), falling back to the static value on the pet record. Persist
    # it so the pet record stays the canonical current weight everywhere.
    latest_weight = next((r["weight_kg"] for r in vitals_out if r["weight_kg"]), None)
    if latest_weight is not None and float(pet.weight_kg or 0) != latest_weight:
        pet.weight_kg = latest_weight
        db.commit()
    current_weight = latest_weight if latest_weight is not None else (float(pet.weight_kg) if pet.weight_kg else None)

    # Age: derive from DOB when available; otherwise use the stored age columns.
    # No random fallback — if nothing is recorded, return None so the UI shows "—".
    if pet.dob:
        today = date.today()
        age_years = today.year - pet.dob.year
        age_months = today.month - pet.dob.month
        if today.day < pet.dob.day:
            age_months -= 1
        if age_months < 0:
            age_years -= 1
            age_months += 12
        age_years = max(age_years, 0)
    else:
        age_years = pet.age_years
        age_months = pet.age_months

    return {
        "pet": {
            "pet_id": pet.pet_id,
            "pet_code": pet.pet_code,
            "name": pet.name,
            "species_name": species.species_name if species else None,
            "breed_name": breed.breed_name if breed else None,
            "gender": pet.gender,
            "dob": str(pet.dob) if pet.dob else None,
            "age_years": age_years,
            "age_months": age_months,
            "color": pet.color,
            "weight_kg": current_weight,
            "owner_name": owner.name if owner else None,
            "owner_phone": owner.phone if owner else None
        },
        "summary": {
            "summary_id": summary.summary_id,
            "blood_group": summary.blood_group,
            "microchip_no": summary.microchip_no,
            "is_spayed_neutered": summary.is_spayed_neutered,
            "spay_neuter_date": str(summary.spay_neuter_date) if summary.spay_neuter_date else None,
            "lifestyle_note": summary.lifestyle_note,
            "dietary_note": summary.dietary_note,
            "warning_flags": summary.warning_flags or "NONE"
        },
        "allergies": [
            {
                "allergy_id": a.allergy_id,
                "allergen": a.allergen,
                "reaction_type": a.reaction_type,
                "severity": a.severity,
                "discovered_date": str(a.discovered_date) if a.discovered_date else None,
                "notes": a.notes
            }
            for a in allergies
        ],
        "vitals": vitals_out,
        "labs": [
            {
                "lab_record_id": l.lab_record_id,
                "test_name": l.test_name,
                "test_category": l.test_category,
                "sample_collected_date": str(l.sample_collected_date),
                "results_summary": l.results_summary,
                "attachment_url": l.attachment_url,
                "performed_by": l.performed_by
            }
            for l in labs
        ],
        "timeline": timeline_out
    }


# ── Pet Health Book: persist allergies & vitals ─────────────────────
from pydantic import BaseModel


class AllergyIn(BaseModel):
    allergen: str
    reaction_type: Optional[str] = None
    severity: Optional[str] = "Moderate"
    notes: Optional[str] = None
    discovered_date: Optional[str] = None


class VitalIn(BaseModel):
    weight_kg: Optional[float] = None
    temp_celsius: Optional[float] = None
    heart_rate: Optional[int] = None
    resp_rate: Optional[int] = None
    body_condition_score: Optional[int] = None


@router.post("/{pet_id}/allergies")
def add_pet_allergy(pet_id: int, payload: AllergyIn, db: Session = Depends(get_db)):
    """Persist a known allergy / adverse reaction for a pet."""
    from models.people import PetAllergy
    if not db.query(Pet).filter(Pet.pet_id == pet_id).first():
        raise HTTPException(404, "Pet not found")
    if not payload.allergen or not payload.allergen.strip():
        raise HTTPException(422, "Allergen name is required")

    disc = None
    if payload.discovered_date:
        try:
            disc = date.fromisoformat(payload.discovered_date)
        except ValueError:
            disc = None
    if disc is None:
        disc = date.today()

    a = PetAllergy(
        pet_id=pet_id,
        allergen=payload.allergen.strip(),
        reaction_type=payload.reaction_type,
        severity=payload.severity,
        notes=payload.notes,
        discovered_date=disc,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return {
        "allergy_id": a.allergy_id,
        "allergen": a.allergen,
        "reaction_type": a.reaction_type,
        "severity": a.severity,
        "discovered_date": str(a.discovered_date) if a.discovered_date else None,
        "notes": a.notes,
    }


@router.post("/{pet_id}/vitals")
def add_pet_vital(pet_id: int, payload: VitalIn, db: Session = Depends(get_db)):
    """Persist a vitals / weight reading for a pet."""
    from models.people import PetVitalsLog
    pet = db.query(Pet).filter(Pet.pet_id == pet_id).first()
    if not pet:
        raise HTTPException(404, "Pet not found")

    v = PetVitalsLog(
        pet_id=pet_id,
        weight_kg=payload.weight_kg,
        temp_celsius=payload.temp_celsius,
        heart_rate=payload.heart_rate,
        resp_rate=payload.resp_rate,
        body_condition_score=payload.body_condition_score,
    )
    db.add(v)

    # Keep the pet's canonical current weight in sync with the latest reading.
    if payload.weight_kg:
        pet.weight_kg = payload.weight_kg

    db.commit()
    db.refresh(v)
    return {
        "vital_id": v.vital_id,
        "recorded_at": str(v.recorded_at),
        "weight_kg": float(v.weight_kg) if v.weight_kg else None,
        "temp_celsius": float(v.temp_celsius) if v.temp_celsius else None,
        "heart_rate": v.heart_rate,
        "resp_rate": v.resp_rate,
        "body_condition_score": v.body_condition_score,
        "source": "Vitals Log",
    }

