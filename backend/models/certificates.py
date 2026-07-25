"""models/certificates.py — Auto-generated pet certificates.

Covers the standard veterinary certificate set: Anti-Rabies Vaccination (ARV),
Health-cum-Vaccination, Travel-cum-Vaccination, Euthanasia, Surgical Risk Note,
Sterilization, Death, Microchip Implantation, Identification, and Boarding &
Lodging. One flexible table backs all ten types — `cert_type` selects the
template on the frontend/print side, and `details` (JSON string) holds
whatever fields that template needs, so adding an eleventh certificate type
later needs no schema migration.
"""
from sqlalchemy import Column, Integer, String, Date, DateTime, Text, ForeignKey, func
from database import Base


class PetCertificate(Base):
    __tablename__ = "pet_certificates"

    certificate_id = Column(Integer, primary_key=True, index=True)
    cert_no        = Column(String(30), unique=True, nullable=False)
    cert_type      = Column(String(50), nullable=False)
    pet_id         = Column(Integer, ForeignKey("pets.pet_id"), nullable=False)
    owner_id       = Column(Integer, ForeignKey("pet_owners.owner_id"), nullable=False)
    doctor_id      = Column(Integer, ForeignKey("doctors.doctor_id"), nullable=True)
    issue_date     = Column(Date, nullable=False)
    valid_until    = Column(Date, nullable=True)
    details        = Column(Text)   # JSON-encoded, template-specific fields
    notes          = Column(Text)
    created_by     = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_at     = Column(DateTime, server_default=func.now())
