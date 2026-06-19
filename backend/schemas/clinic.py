"""schemas/clinic.py — Clinic Setup schemas"""
from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime


class ClinicSetupBase(BaseModel):
    clinic_name:    str
    address:        Optional[str] = None # legacy
    address1:       Optional[str] = None
    address2:       Optional[str] = None
    address3:       Optional[str] = None
    city:           Optional[str] = None # legacy
    city_id:        Optional[int] = None
    city_name:      Optional[str] = None
    district:       Optional[str] = None
    state:          Optional[str] = None # legacy
    state_name:     Optional[str] = None
    state_code:     Optional[str] = None
    pincode:        Optional[str] = None
    phone:          Optional[str] = None
    alt_phone:      Optional[str] = None
    email:          Optional[str] = None
    website:        Optional[str] = None
    gstin:          Optional[str] = None
    pan:            Optional[str] = None
    logo_path:      Optional[str] = None
    reg_number:     Optional[str] = None
    drug_license_no: Optional[str] = None
    established_on: Optional[date] = None
    fy_start_month: int = 4


class ClinicSetupCreate(ClinicSetupBase):
    pass


class ClinicSetupUpdate(ClinicSetupBase):
    pass


class ClinicSetupOut(ClinicSetupBase):
    clinic_id:  int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
