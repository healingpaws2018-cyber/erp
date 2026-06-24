from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal

# ── SALES BILL ITEMS ─────────────────────────────────────────
class SalesBillItemBase(BaseModel):
    line_no: int
    line_type: str              # 'Medicine' | 'Procedure'
    medicine_id: Optional[int] = None
    batch_id: Optional[int] = None
    procedure_id: Optional[int] = None
    qty: Decimal = Decimal("1")
    rate: Decimal               # unit price excl. GST
    discount_pct: Decimal = Decimal("0")

class SalesBillItemCreate(SalesBillItemBase):
    pass

class SalesBillItemOut(SalesBillItemBase):
    item_id: int
    description: str
    hsn_code: Optional[str] = None
    unit: Optional[str] = None
    discount_amt: Decimal
    taxable_amt: Decimal
    gst_rate_id: Optional[int] = None
    gst_pct: Decimal
    total_tax: Decimal
    line_total: Decimal

    class Config:
        from_attributes = True

# ── SALES BILL HEADER ────────────────────────────────────────
class SalesBillBase(BaseModel):
    bill_date: date = date.today()
    bill_type: str = "Retail"   # 'Retail' | 'GST'
    owner_id: Optional[int] = None
    pet_id: Optional[int] = None
    doctor_id: Optional[int] = None
    agent_id: Optional[int] = None
    payment_mode: str = "Cash"
    notes: Optional[str] = None
    with_gst: bool = True       # False = tax-exempt billing, use sale price only

class SalesBillCreate(SalesBillBase):
    items: List[SalesBillItemCreate]

class MiniOwner(BaseModel):
    name: str # Matches PetOwner.name
    phone: Optional[str] = None
    class Config: from_attributes = True

class MiniPet(BaseModel):
    name: str # Matches Pet.name
    species_name: Optional[str] = None
    class Config: from_attributes = True

class MiniDoctor(BaseModel):
    name: str # Matches Doctor.name
    class Config: from_attributes = True

class SalesBillOut(SalesBillBase):
    bill_id: int
    bill_number: str
    party_gstin: Optional[str] = None
    party_state_code: Optional[str] = None
    is_interstate: bool
    subtotal: Decimal
    discount_amt: Decimal
    taxable_amt: Decimal
    cgst_amt: Decimal
    sgst_amt: Decimal
    igst_amt: Decimal
    total_tax: Decimal
    grand_total: Decimal
    round_off: Decimal
    net_payable: Decimal
    amount_paid: Decimal
    amount_due: Decimal
    status: str
    created_at: datetime
    items: List[SalesBillItemOut]
    owner: Optional[MiniOwner] = None
    pet: Optional[MiniPet] = None
    doctor: Optional[MiniDoctor] = None

    class Config:
        from_attributes = True
