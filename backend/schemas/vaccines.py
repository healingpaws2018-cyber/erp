"""schemas/vaccines.py"""
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class VaccineCreate(BaseModel):
    vaccine_name: str
    species_id: int
    company: Optional[str] = None
    disease: Optional[str] = None
    dosage: Optional[str] = None
    route: Optional[str] = None
    interval_days: Optional[int] = 0
    medicine_id: Optional[int] = None   # optional: link to an ALREADY-EXISTING Medicine
                                         # instead of auto-creating one (see hsn_id/gst_rate_id)
    hsn_id: Optional[int] = None        # not stored on Vaccine itself — used to auto-create
    gst_rate_id: Optional[int] = None   # (or keep in sync) the linked Medicine's tax fields


class VaccineOut(BaseModel):
    vaccine_id: int
    vaccine_code: str
    vaccine_name: str
    species_id: int
    company: Optional[str]
    disease: Optional[str]
    dosage: Optional[str]
    route: Optional[str]
    interval_days: int
    is_active: bool
    medicine_id: Optional[int] = None
    hsn_id: Optional[int] = None        # pulled from the linked Medicine, if any
    gst_rate_id: Optional[int] = None   # pulled from the linked Medicine, if any

    class Config:
        from_attributes = True


class VaccinationRecordCreate(BaseModel):
    pet_id: int
    owner_id: int
    vaccine_id: int
    doctor_id: Optional[int] = None
    given_date: date
    next_due_date: Optional[date] = None
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None
    dose_ml: Optional[Decimal] = None
    site: Optional[str] = None
    notes: Optional[str] = None
    vaccination_code: Optional[str] = None


class VaccinationRecordOut(BaseModel):
    vacc_record_id: int
    vacc_record_no: Optional[str] = None
    pet_id: int
    owner_id: int
    vaccine_id: int
    doctor_id: Optional[int]
    given_date: date
    next_due_date: Optional[date]
    batch_no: Optional[str]
    expiry_date: Optional[date]
    dose_ml: Optional[Decimal]
    site: Optional[str]
    notes: Optional[str]
    vaccination_code: Optional[str] = None
    pet_name: Optional[str] = None
    vaccine_name: Optional[str] = None
    doctor_name: Optional[str] = None
    medicine_id: Optional[int] = None   # the vaccine's linked Medicine, if any — lets the
                                         # Sales Bill screen pre-fill a billable line for this record

    class Config:
        from_attributes = True


class ReminderOut(BaseModel):
    reminder_id: int
    vacc_record_id: int
    pet_id: int
    pet_name: Optional[str] = None
    owner_id: int
    owner_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    vaccine_name: Optional[str] = None
    due_date: date
    reminder_status: str
    notified_at: Optional[datetime] = None
    notified_via: Optional[str] = None

    class Config:
        from_attributes = True
