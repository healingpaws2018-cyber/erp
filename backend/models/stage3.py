from sqlalchemy import Column, Integer, String, Numeric, Boolean, Date, \
    DateTime, SmallInteger, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Unit(Base):
    __tablename__ = "units"
    unit_id    = Column(Integer, primary_key=True)
    unit_name  = Column(String(50), unique=True, nullable=False)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())


class Medicine(Base):
    __tablename__ = "medicines"
    medicine_id    = Column(Integer, primary_key=True)
    medicine_code  = Column(String(30), unique=True, nullable=False)
    medicine_name  = Column(String(200), nullable=False)
    medicine_name2 = Column(String(200))                          # generic/alternate name
    hsn_id         = Column(Integer, ForeignKey("hsn_codes.hsn_id"))
    gst_rate_id    = Column(Integer, ForeignKey("gst_rates.gst_rate_id"))
    unit_id        = Column(Integer, ForeignKey("units.unit_id"))
    reorder_level  = Column(Numeric(10,2), default=0)
    current_stock  = Column(Numeric(10,2), default=0)            # auto-updated
    dosage_form    = Column(String(50), nullable=True)  # e.g., Tablet, Syrup
    strength       = Column(String(50), nullable=True)  # e.g., 500mg
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, default=func.now())
    updated_at     = Column(DateTime, default=func.now(), onupdate=func.now())

    hsn        = relationship("HsnCode")
    gst_rate   = relationship("GstRate")
    unit       = relationship("Unit")
    batches    = relationship("MedicineBatch", back_populates="medicine")


class MedicineBatch(Base):
    __tablename__ = "medicine_batches"
    batch_id       = Column(Integer, primary_key=True)
    medicine_id    = Column(Integer, ForeignKey("medicines.medicine_id"), nullable=False)
    batch_no       = Column(String(50), nullable=False)
    mfg_date       = Column(Date)
    expiry_date    = Column(Date, nullable=False)
    purchase_price = Column(Numeric(10,2), default=0)
    sale_price     = Column(Numeric(10,2), default=0)
    mrp            = Column(Numeric(10,2), default=0)
    opening_qty    = Column(Numeric(10,2), default=0)
    current_qty    = Column(Numeric(10,2), default=0)
    source         = Column(String(20), default='Purchase')
    is_active      = Column(Boolean, default=True)               # soft-delete flag
    created_at     = Column(DateTime, default=func.now())

    medicine = relationship("Medicine", back_populates="batches")


class StockLedger(Base):
    __tablename__ = "stock_ledger"
    ledger_id   = Column(Integer, primary_key=True)
    fy_code     = Column(String(10), ForeignKey("financial_years.fy_code"), nullable=True, index=True)
    medicine_id = Column(Integer, ForeignKey("medicines.medicine_id"), nullable=False)
    batch_id    = Column(Integer, ForeignKey("medicine_batches.batch_id"), nullable=False)
    txn_date    = Column(Date, nullable=False, default=func.current_date())
    txn_type    = Column(String(20), nullable=False)
    qty         = Column(Numeric(10,2), nullable=False)
    qty_in      = Column(Numeric(10,2), default=0)
    qty_out     = Column(Numeric(10,2), default=0)
    ref_type    = Column(String(30))
    ref_id      = Column(Integer)
    ref_number  = Column(String(50))
    notes       = Column(Text)
    created_by  = Column(Integer, ForeignKey("users.user_id"))
    created_at  = Column(DateTime, default=func.now())


class Procedure(Base):
    __tablename__ = "procedures"
    procedure_id   = Column(Integer, primary_key=True)
    procedure_code = Column(String(30), unique=True, nullable=False)
    procedure_name = Column(String(200), nullable=False)
    category       = Column(String(50))
    fee            = Column(Numeric(10,2), default=0)
    hsn_id         = Column(Integer, ForeignKey("hsn_codes.hsn_id"))
    gst_rate_id    = Column(Integer, ForeignKey("gst_rates.gst_rate_id"))
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, default=func.now())
    updated_at     = Column(DateTime, default=func.now(), onupdate=func.now())

    hsn      = relationship("HsnCode")
    gst_rate = relationship("GstRate")


class Vaccine(Base):
    __tablename__ = "vaccines"
    vaccine_id    = Column(Integer, primary_key=True)
    vaccine_code  = Column(String(30), unique=True, nullable=False)
    vaccine_name  = Column(String(200), nullable=False)
    species_id    = Column(Integer, ForeignKey("species.species_id"), nullable=False)
    company       = Column(String(100))
    disease       = Column(String(200))
    dosage        = Column(String(100))
    route         = Column(String(50))
    dose_number   = Column(SmallInteger, default=1)
    interval_days = Column(Integer, default=0)
    medicine_id   = Column(Integer, ForeignKey("medicines.medicine_id"))
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, default=func.now())

    species  = relationship("Species")
    medicine = relationship("Medicine")


class SalesBill(Base):
    __tablename__ = "sales_bills"
    bill_id          = Column(Integer, primary_key=True)
    fy_code          = Column(String(10), ForeignKey("financial_years.fy_code"), nullable=True, index=True)
    bill_number      = Column(String(30), unique=True, nullable=False)
    bill_date        = Column(Date, nullable=False, default=func.current_date())
    bill_type        = Column(String(20), default='Retail')
    owner_id         = Column(Integer, ForeignKey("pet_owners.owner_id"))
    pet_id           = Column(Integer, ForeignKey("pets.pet_id"))
    doctor_id        = Column(Integer, ForeignKey("doctors.doctor_id"))
    agent_id         = Column(Integer, ForeignKey("agents.agent_id"))
    party_gstin      = Column(String(20))
    party_state_code = Column(String(5))
    is_interstate    = Column(Boolean, default=False)
    subtotal         = Column(Numeric(12,2), default=0)
    discount_amt     = Column(Numeric(12,2), default=0)
    taxable_amt      = Column(Numeric(12,2), default=0)
    cgst_amt         = Column(Numeric(12,2), default=0)
    sgst_amt         = Column(Numeric(12,2), default=0)
    igst_amt         = Column(Numeric(12,2), default=0)
    total_tax        = Column(Numeric(12,2), default=0)
    grand_total      = Column(Numeric(12,2), default=0)
    round_off        = Column(Numeric(5,2), default=0)
    net_payable      = Column(Numeric(12,2), default=0)
    payment_mode     = Column(String(20), default='Cash')
    amount_paid      = Column(Numeric(12,2), default=0)
    amount_due       = Column(Numeric(12,2), default=0)
    status           = Column(String(20), default='Draft')
    notes            = Column(Text)
    created_by       = Column(Integer, ForeignKey("users.user_id"))
    created_at       = Column(DateTime, default=func.now())
    updated_at       = Column(DateTime, default=func.now(), onupdate=func.now())

    owner    = relationship("PetOwner")
    pet      = relationship("Pet")
    doctor   = relationship("Doctor")
    agent    = relationship("Agent")
    items    = relationship("SalesBillItem", back_populates="bill", cascade="all, delete-orphan")


class SalesBillItem(Base):
    __tablename__ = "sales_bill_items"
    item_id      = Column(Integer, primary_key=True)
    bill_id      = Column(Integer, ForeignKey("sales_bills.bill_id"), nullable=False)
    line_no      = Column(SmallInteger, nullable=False)
    line_type    = Column(String(20), nullable=False)   # 'Medicine' | 'Procedure'
    medicine_id  = Column(Integer, ForeignKey("medicines.medicine_id"))
    batch_id     = Column(Integer, ForeignKey("medicine_batches.batch_id"))
    procedure_id = Column(Integer, ForeignKey("procedures.procedure_id"))
    description  = Column(String(300), nullable=False)
    hsn_code     = Column(String(10))
    unit         = Column(String(30))
    qty          = Column(Numeric(10,2), default=1)
    rate         = Column(Numeric(10,2), nullable=False)
    discount_pct = Column(Numeric(5,2), default=0)
    discount_amt = Column(Numeric(10,2), default=0)
    taxable_amt  = Column(Numeric(10,2), default=0)
    gst_rate_id  = Column(Integer, ForeignKey("gst_rates.gst_rate_id"))
    gst_pct      = Column(Numeric(5,2), default=0)
    cgst_pct     = Column(Numeric(5,2), default=0)
    sgst_pct     = Column(Numeric(5,2), default=0)
    igst_pct     = Column(Numeric(5,2), default=0)
    cgst_amt     = Column(Numeric(10,2), default=0)
    sgst_amt     = Column(Numeric(10,2), default=0)
    igst_amt     = Column(Numeric(10,2), default=0)
    total_tax    = Column(Numeric(10,2), default=0)
    line_total   = Column(Numeric(10,2), default=0)

    bill      = relationship("SalesBill", back_populates="items")
    medicine  = relationship("Medicine")
    batch     = relationship("MedicineBatch")
    procedure = relationship("Procedure")
