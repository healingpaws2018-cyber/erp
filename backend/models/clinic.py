"""models/clinic.py — Clinic Setup table"""
from sqlalchemy import Column, Integer, SmallInteger, String, Date, DateTime, Text, ForeignKey, func
from database import Base


class ClinicSetup(Base):
    __tablename__ = "clinic_setup"

    clinic_id       = Column(Integer, primary_key=True, index=True)
    clinic_name     = Column(String(200), nullable=False)

    # Address
    address         = Column(String, nullable=True) # legacy
    address1        = Column(Text)
    address2        = Column(Text)
    address3        = Column(Text)
    city            = Column(String(100), nullable=True) # legacy
    city_id         = Column(Integer, ForeignKey("cities.city_id"), nullable=True)
    city_name       = Column(String(100), nullable=True)  # display label from city dropdown
    district        = Column(String(100))
    state           = Column(String(100), nullable=True) # legacy
    state_name      = Column(String(100))
    state_code      = Column(String(5))
    pincode         = Column(String(10), nullable=True)

    # Contact
    phone           = Column(String(20), nullable=True)
    alt_phone       = Column(String(20), nullable=True)
    email           = Column(String(100), nullable=True)
    website         = Column(String(200), nullable=True)

    # Tax & Compliance
    gstin           = Column(String(20), nullable=True)
    pan             = Column(String(12), nullable=True)
    reg_number      = Column(String(100), nullable=True)
    drug_license_no = Column(String(50))
    established_on  = Column(Date, nullable=True)

    # Financial Year
    fy_start_month  = Column(SmallInteger, default=4)  # 4 = April (Indian FY)

    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())
