"""routes/certificates.py — Auto-generated pet certificates.

Ten standard veterinary certificate templates, all backed by the single
PetCertificate table (see models/certificates.py). `details` holds
whatever fields the chosen template needs as a JSON blob, so the ten types
share one table/route pair instead of ten near-duplicate ones.

Self-healing, consistent with the rest of this codebase: the table and the
CERT doc-sequence row are created on first use (checkfirst / ON CONFLICT DO
NOTHING) rather than requiring a migration or a backend restart.
"""
import json
from datetime import date
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from database import get_db
from models.certificates import PetCertificate
from models.people import Pet, PetOwner
from models.doctors import Doctor
from utils.doc_sequence import get_next_doc_no, format_fy
from utils.gl_utils import get_current_fy

router = APIRouter(prefix="/certificates", tags=["Certificates"])

CERT_TYPES = [
    {"key": "ARV",            "label": "Anti-Rabies Vaccination (ARV) Certificate"},
    {"key": "HEALTH_VACC",    "label": "Health-cum-Vaccination Certificate"},
    {"key": "TRAVEL_VACC",    "label": "Travel-cum-Vaccination Certificate"},
    {"key": "EUTHANASIA",     "label": "Euthanasia Certificate"},
    {"key": "SURGICAL_RISK",  "label": "Surgical Risk Note"},
    {"key": "STERILIZATION",  "label": "Sterilization Certificate"},
    {"key": "DEATH",          "label": "Death Certificate"},
    {"key": "MICROCHIP",      "label": "Microchip Implantation Certificate"},
    {"key": "IDENTIFICATION", "label": "Identification Certificate"},
    {"key": "BOARDING",       "label": "Boarding & Lodging Certificate"},
]
CERT_TYPE_KEYS = {c["key"] for c in CERT_TYPES}


def _ensure_ready(db: Session):
    """Self-heal: create the table + CERT doc-sequence row if they don't exist yet."""
    PetCertificate.__table__.create(bind=db.get_bind(), checkfirst=True)
    fy = get_current_fy(db)
    fy_str = format_fy(fy.fy_code) if fy else ""
    db.execute(text("""
        INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
        VALUES ('CERT', 'CRT', 0, 4, :use_fy, :fy, :use_fy)
        ON CONFLICT (doc_type) DO NOTHING
    """), {"use_fy": bool(fy), "fy": fy_str})
    db.commit()


class CertificateIn(BaseModel):
    pet_id:      int
    cert_type:   str
    doctor_id:   Optional[int] = None
    issue_date:  Optional[str] = None
    valid_until: Optional[str] = None
    details:     Dict[str, Any] = {}
    notes:       Optional[str] = None


def _serialize(c: PetCertificate, pet=None, owner=None, doctor=None) -> dict:
    return {
        "certificate_id":     c.certificate_id,
        "cert_no":            c.cert_no,
        "cert_type":          c.cert_type,
        "cert_type_label":    next((t["label"] for t in CERT_TYPES if t["key"] == c.cert_type), c.cert_type),
        "pet_id":             c.pet_id,
        "owner_id":           c.owner_id,
        "doctor_id":          c.doctor_id,
        "doctor_name":        doctor.name if doctor else None,
        "doctor_qualification": doctor.qualification if doctor else None,
        "doctor_reg_number":  doctor.reg_number if doctor else None,
        "pet_name":           pet.name if pet else None,
        "pet_code":           pet.pet_code if pet else None,
        "owner_name":         owner.name if owner else None,
        "owner_phone":        owner.phone if owner else None,
        "issue_date":         str(c.issue_date) if c.issue_date else None,
        "valid_until":        str(c.valid_until) if c.valid_until else None,
        "details":            json.loads(c.details) if c.details else {},
        "notes":              c.notes,
        "created_at":         str(c.created_at) if c.created_at else None,
    }


@router.get("/types")
def list_cert_types():
    return CERT_TYPES


@router.get("")
def list_certificates(
    pet_id: Optional[int] = Query(None),
    cert_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    _ensure_ready(db)
    q = db.query(PetCertificate)
    if pet_id:
        q = q.filter(PetCertificate.pet_id == pet_id)
    if cert_type:
        q = q.filter(PetCertificate.cert_type == cert_type)
    certs = q.order_by(PetCertificate.certificate_id.desc()).all()

    out = []
    for c in certs:
        pet = db.query(Pet).filter(Pet.pet_id == c.pet_id).first()
        owner = db.query(PetOwner).filter(PetOwner.owner_id == c.owner_id).first()
        doctor = db.query(Doctor).filter(Doctor.doctor_id == c.doctor_id).first() if c.doctor_id else None
        out.append(_serialize(c, pet, owner, doctor))
    return out


@router.get("/{certificate_id}")
def get_certificate(certificate_id: int, db: Session = Depends(get_db)):
    _ensure_ready(db)
    c = db.query(PetCertificate).filter(PetCertificate.certificate_id == certificate_id).first()
    if not c:
        raise HTTPException(404, "Certificate not found")
    pet = db.query(Pet).filter(Pet.pet_id == c.pet_id).first()
    owner = db.query(PetOwner).filter(PetOwner.owner_id == c.owner_id).first()
    doctor = db.query(Doctor).filter(Doctor.doctor_id == c.doctor_id).first() if c.doctor_id else None
    return _serialize(c, pet, owner, doctor)


@router.post("")
def issue_certificate(data: CertificateIn, db: Session = Depends(get_db)):
    _ensure_ready(db)
    if data.cert_type not in CERT_TYPE_KEYS:
        raise HTTPException(422, f"Unknown certificate type: {data.cert_type}")

    pet = db.query(Pet).filter(Pet.pet_id == data.pet_id).first()
    if not pet:
        raise HTTPException(404, "Pet not found")

    doctor = None
    if data.doctor_id:
        doctor = db.query(Doctor).filter(Doctor.doctor_id == data.doctor_id).first()
        if not doctor:
            raise HTTPException(404, "Doctor not found")

    try:
        issue_dt = date.fromisoformat(data.issue_date) if data.issue_date else date.today()
    except ValueError:
        raise HTTPException(422, "issue_date must be YYYY-MM-DD")
    valid_dt = None
    if data.valid_until:
        try:
            valid_dt = date.fromisoformat(data.valid_until)
        except ValueError:
            raise HTTPException(422, "valid_until must be YYYY-MM-DD")

    cert_no = get_next_doc_no(db, "CERT")
    c = PetCertificate(
        cert_no=cert_no,
        cert_type=data.cert_type,
        pet_id=data.pet_id,
        owner_id=pet.owner_id,
        doctor_id=data.doctor_id,
        issue_date=issue_dt,
        valid_until=valid_dt,
        details=json.dumps(data.details or {}),
        notes=data.notes,
    )
    db.add(c)
    db.commit()
    db.refresh(c)

    owner = db.query(PetOwner).filter(PetOwner.owner_id == c.owner_id).first()
    return _serialize(c, pet, owner, doctor)


@router.delete("/{certificate_id}")
def void_certificate(certificate_id: int, db: Session = Depends(get_db)):
    _ensure_ready(db)
    c = db.query(PetCertificate).filter(PetCertificate.certificate_id == certificate_id).first()
    if not c:
        raise HTTPException(404, "Certificate not found")
    db.delete(c)
    db.commit()
    return {"message": "Certificate voided"}
