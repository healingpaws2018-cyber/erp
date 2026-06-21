"""schemas/pharmacy.py — Schemas for Medicines, Suppliers, and Stock (Stage 3 Updated)"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal


# ── SUPPLIERS ────────────────────────────────────────────────
class SupplierBase(BaseModel):
    supplier_code:   Optional[str] = None
    supplier_name:   str
    contact_person:  Optional[str] = None
    phone:           Optional[str] = None
    alt_phone:       Optional[str] = None
    email:           Optional[str] = None
    address:         Optional[str] = None # legacy
    address1:        Optional[str] = None
    address2:        Optional[str] = None
    address3:        Optional[str] = None
    city_id:         Optional[int] = None
    district:        Optional[str] = None
    state_name:      Optional[str] = None
    state_code:      Optional[str] = None
    pincode:         Optional[str] = None
    gstin:           Optional[str] = None
    pan:             Optional[str] = None
    drug_license_no: Optional[str] = None
    payment_terms:   Optional[int] = None        # credit days
    opening_balance: Optional[Decimal] = Decimal("0")
    balance_type:    Optional[str] = "CR"        # CR=we owe supplier
    gl_account_id:   Optional[int] = None
    is_active:       bool = True

class SupplierCreate(SupplierBase):
    pass

class SupplierOut(SupplierBase):
    supplier_id: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── UNITS ────────────────────────────────────────────────────
class UnitCreate(BaseModel):
    unit_name: str
    is_active: bool = True

class UnitOut(UnitCreate):
    unit_id: int
    class Config:
        from_attributes = True


# ── MEDICINES & BATCHES ──────────────────────────────────────
class MedicineBase(BaseModel):
    medicine_code: Optional[str] = None
    medicine_name: str
    medicine_name2: Optional[str] = None
    hsn_id: Optional[int] = None
    gst_rate_id: Optional[int] = None
    unit_id: Optional[int] = None
    reorder_level: Decimal = Decimal("0")
    dosage_form: Optional[str] = None
    strength: Optional[str] = None
    is_active: bool = True

class MedicineCreate(MedicineBase):
    pass

class MedicineOut(MedicineBase):
    medicine_id: int
    dosage_form: Optional[str] = None
    strength: Optional[str] = None
    current_stock: Decimal
    gst_pct: Optional[Decimal] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class BatchCreate(BaseModel):
    medicine_id: int
    batch_no: str
    mfg_date: Optional[date] = None
    expiry_date: date
    purchase_price: Decimal = Decimal("0")
    sale_price: Decimal = Decimal("0")
    mrp: Decimal = Decimal("0")
    opening_qty: Decimal = Decimal("0")
    source: str = "Opening"

class BatchOut(BatchCreate):
    batch_id: int
    current_qty: Decimal
    class Config:
        from_attributes = True


# ── STOCK LEDGER ─────────────────────────────────────────────
class StockLedgerOut(BaseModel):
    ledger_id: int
    medicine_id: int
    batch_id: int
    txn_date: date
    txn_type: str
    qty_in: Decimal
    qty_out: Decimal
    ref_type: Optional[str] = None
    ref_number: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ── PURCHASE BILLS (RESTORED) ────────────────────────────────
class PurchaseItemCreate(BaseModel):
    medicine_id: int
    batch_no: str
    mfg_date: Optional[date] = None
    expiry_date: date
    quantity: Decimal
    free_quantity: Decimal = Decimal("0")
    purchase_price: Decimal
    sale_price: Decimal
    gst_pct: Decimal = Decimal("0")

class PurchaseBillCreate(BaseModel):
    supplier_id: int
    supplier_invoice_no: Optional[str] = None
    bill_date: date
    items: List[PurchaseItemCreate]
    discount_amount: Decimal = Decimal("0")
    notes: Optional[str] = None

class PurchaseItemOut(BaseModel):
    item_id: int
    medicine_id: int
    batch_no: str
    mfg_date: Optional[date]
    expiry_date: date
    quantity: Decimal
    free_quantity: Decimal
    purchase_price: Decimal
    sale_price: Optional[Decimal]
    gst_pct: Decimal
    line_total: Decimal
    class Config:
        from_attributes = True

class PurchaseBillOut(BaseModel):
    bill_id: int
    bill_no: str
    bill_date: date
    supplier_id: int
    supplier_invoice_no: Optional[str]
    net_amount: Decimal
    status: str
    notes: Optional[str]
    items: List[PurchaseItemOut] = []
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── PHARMACY BILLS (RESTORED) ────────────────────────────────
class PharmacyItemCreate(BaseModel):
    medicine_id: int
    batch_id: int
    quantity: Decimal
    sale_price: Decimal
    discount_pct: Decimal = Decimal("0")
    rx_item_id: Optional[int] = None

class PharmacyBillCreate(BaseModel):
    owner_id: Optional[int] = None
    pet_id: Optional[int] = None
    prescription_id: Optional[int] = None
    items: List[PharmacyItemCreate]
    payment_mode: str = "Cash"
    discount_amount: Decimal = Decimal("0")

class PharmacyBillOut(BaseModel):
    pharmacy_bill_id: int
    pharma_bill_no: str
    bill_date: date
    net_amount: Decimal
    payment_status: Optional[str] = "Paid"
    status: str

    class Config:
        from_attributes = True
