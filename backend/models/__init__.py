"""models/__init__.py — Import all models so SQLAlchemy can find them"""
from .clinic import ClinicSetup
from .users import User
from .masters import City, Species, Breed, HsnCode, GstRate
from .people import PetOwner, Pet
from .doctors import Doctor, Staff
from .agents import Agent
from .certificates import PetCertificate

# Master System (Multi-Tenancy, RBAC, Company Profiles)
from .master_sys import (
    Tenant, CompanyProfile, MasterUser, Role, UserCompanyAccess, UserModuleAccess
)

# Stage 3 (New Source of Truth for Products/Services/Billing)
from .stage3 import (
    Unit, Medicine, MedicineBatch, StockLedger,
    Procedure, Vaccine, SalesBill, SalesBillItem
)

# Phase 2 (Clinical - excluding duplicates now in Stage 3)
from .phase2 import (
    DoctorSchedule, Appointment,
    Consultation, ConsultationProcedure,
    Prescription, PrescriptionItem,
    VaccinationRecord, VaccinationReminder
)

# Phase 3 (Pharmacy - excluding duplicates now in Stage 3)
from .phase3 import (
    Supplier,
    PurchaseBill, PurchaseBillItem,
    PharmacyBill, PharmacyBillItem
)

# Phase 4 (Accounting, FY, Opening Balances)
from .phase4 import (
    GLMaster, BillingMaster, BillingItem,
    Voucher, FinancialYear, OpeningBalance
)
from .accounts import (
    AdvancePayment, BankArrival, GLPosting,
    ReceiptVoucher, ReceiptVoucherDetail,
    PaymentVoucher, PaymentVoucherDetail,
    JournalVoucher, JournalLine,
    CreditNote, CreditNoteItem,
    DebitNote, DebitNoteItem
)
