"""
main.py — Pet Clinic ERP Backend Entry Point
Run: uvicorn main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import create_engine, text
from database import engine, master_engine, get_engine_for_db, Base, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, MASTER_DB_NAME
import models  # noqa: F401 — ensures all models are registered
from utils.doc_sequence import init_sequences_for_db

from routes import auth, clinic, masters, owners, pets, doctors
from routes.appointments import router as appt_router, schedule_router
from routes.consultations import router as consult_router, proc_router
from routes.prescriptions import router as rx_router
from routes.vaccines import router as vaccine_router
from routes.inventory import router as inv_router
from routes.pharmacy import router as phm_router
from routes.ledger import router as ledger_router
from routes.agents import router as agents_router
from routes.users import router as users_router
from routes.billing import router as billing_router
from routes.services import router as services_router
from routes.companies import router as companies_router
from routes.advance_payments import router as advance_payments_router
from routes.bank_arrivals import router as bank_arrivals_router
from routes.receipt_vouchers import router as receipt_vouchers_router
from routes.payment_vouchers import router as payment_vouchers_router
from routes.journal_vouchers import router as journal_vouchers_router
from routes.credit_notes import router as credit_notes_router
from routes.debit_notes import router as debit_notes_router
from routes.reports import router as reports_router
from routes.certificates import router as certificates_router

# ─── Ensure Master Database Exists Before Creating Tables ─────────────────
try:
    root_engine = create_engine(f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/postgres", isolation_level="AUTOCOMMIT")
    with root_engine.connect() as conn:
        res = conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname = '{MASTER_DB_NAME}'"))
        if not res.fetchone():
            print(f"⚠️ Master database '{MASTER_DB_NAME}' does not exist. Auto-creating...")
            conn.execute(text(f"CREATE DATABASE {MASTER_DB_NAME}"))
            print(f"✅ Created database '{MASTER_DB_NAME}' successfully.")
except Exception as e:
    print(f"⚠️ Could not check/create master database automatically: {e}")

# ─── Create all tables in both Master DB and Company DB ─────────────────
Base.metadata.create_all(bind=master_engine)
Base.metadata.create_all(bind=engine)

# ─── Auto-Seed Default Admin & Company if Empty (Cloud Hardening) ───────────
try:
    # 1. Seed Master User
    from models.master_sys import MasterUser, CompanyProfile, Tenant
    from models.users import User
    from database import MasterSessionLocal, SessionLocal, DB_NAME
    from utils.encryption import encrypt_db_uri
    
    m_db = MasterSessionLocal()
    try:
        # Tenant
        if not m_db.query(Tenant).filter_by(tenant_id=1).first():
            m_db.add(Tenant(tenant_id=1, tenant_name="Default Tenant", email="admin@petclinicerp.com", password_hash="$2b$12$3HQ7TYW3eaDm.JBWjwnafOTGDWsqXHPqpc7RkvJ9wjni9XNiHAyu6"))
            m_db.commit()
            
        # MasterUser
        if not m_db.query(MasterUser).filter_by(email="admin@petclinicerp.com").first():
            m_db.add(MasterUser(
                tenant_id=1, full_name="System Admin", email="admin@petclinicerp.com",
                password_hash="$2b$12$3HQ7TYW3eaDm.JBWjwnafOTGDWsqXHPqpc7RkvJ9wjni9XNiHAyu6", phone="1234567890", is_active=True
            ))
            m_db.commit()
            
        # CompanyProfile
        if not m_db.query(CompanyProfile).filter_by(company_code="DEF").first():
            db_uri_plain = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
            m_db.add(CompanyProfile(
                tenant_id=1, company_code="DEF", company_name="Default Pet Clinic", db_name=DB_NAME,
                db_uri=encrypt_db_uri(db_uri_plain), address_line1="Main Clinic Address", city="Metropolis",
                state="State", pincode="123456", current_fy="2026-27", status="Active"
            ))
            m_db.commit()
    finally:
        m_db.close()
        
    # 2. Seed Company User (admin / admin123) and default Financial Years
    c_db = SessionLocal()
    try:
        if not c_db.query(User).filter_by(username="admin").first():
            c_db.add(User(
                username="admin", password_hash="$2b$12$3HQ7TYW3eaDm.JBWjwnafOTGDWsqXHPqpc7RkvJ9wjni9XNiHAyu6",
                full_name="System Administrator", role="Admin", email="admin@petclinic.com", is_active=True
            ))
            c_db.commit()
        
        from models.phase4 import FinancialYear
        from datetime import date
        if not c_db.query(FinancialYear).first():
            fys = [
                FinancialYear(fy_code="2023-24", start_date=date(2023, 4, 1), end_date=date(2024, 3, 31), is_current=False),
                FinancialYear(fy_code="2024-25", start_date=date(2024, 4, 1), end_date=date(2025, 3, 31), is_current=False),
                FinancialYear(fy_code="2025-26", start_date=date(2025, 4, 1), end_date=date(2026, 3, 31), is_current=False),
                FinancialYear(fy_code="2026-27", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True),
            ]
            c_db.add_all(fys)
            c_db.commit()
        else:
            # Ensure 2026-27 is marked as current (migrate from 2025-26 if needed)
            fy_2627 = c_db.query(FinancialYear).filter_by(fy_code="2026-27").first()
            if not fy_2627:
                c_db.add(FinancialYear(fy_code="2026-27", start_date=date(2026, 4, 1), end_date=date(2027, 3, 31), is_current=True))
            # Reset all others to non-current
            c_db.query(FinancialYear).filter(FinancialYear.fy_code != "2026-27").update({"is_current": False})
            if fy_2627:
                fy_2627.is_current = True
            c_db.commit()
    finally:
        c_db.close()
except Exception as e:
    print(f"⚠️ Auto-seeding check failed: {e}")

# ─── Initialize Document Sequences for Default DB & All Company DBs ─────────
try:
    print("🔄 Initializing document sequences and PL/pgSQL functions for primary DB...")
    init_sequences_for_db(engine)
    print("✅ Primary DB sequences initialized successfully.")
    
    # Iterate over all registered company databases
    with master_engine.connect() as m_conn:
        res = m_conn.execute(text("SELECT db_name FROM company_profiles WHERE status = 'Active'"))
        for row in res.fetchall():
            c_db_name = row[0]
            try:
                print(f"🔄 Initializing sequences and checking migrations for company DB '{c_db_name}'...")
                c_engine = get_engine_for_db(c_db_name)
                Base.metadata.create_all(bind=c_engine)
                init_sequences_for_db(c_engine)
                
                # Auto-migrate fy_code column if missing in Phase 3 tables
                with c_engine.connect() as c_conn:
                    for t_name in ["purchase_bills", "pharmacy_bills", "sales_bills", "stock_ledger"]:
                        try:
                            c_conn.execute(text(f"ALTER TABLE {t_name} ADD COLUMN fy_code VARCHAR(10)"))
                            c_conn.commit()
                            print(f"➕ Added missing column 'fy_code' to {t_name} in '{c_db_name}'.")
                        except Exception:
                            c_conn.rollback()  # Column already exists
                    
                # Auto-migrate dosage_form and strength columns if missing in medicines table
                    try:
                        c_conn.execute(text("ALTER TABLE medicines ADD COLUMN IF NOT EXISTS dosage_form VARCHAR(50)"))
                        c_conn.execute(text("ALTER TABLE medicines ADD COLUMN IF NOT EXISTS strength VARCHAR(50)"))
                        c_conn.commit()
                        print(f"➕ Added missing dosage_form/strength columns to medicines in '{c_db_name}'.")
                    except Exception:
                        c_conn.rollback()  # Columns already exist

                    # Auto-migrate is_active soft-delete flag on medicine_batches.
                    # Critical: backfill existing rows to TRUE, otherwise pre-existing
                    # batches default to NULL and get filtered out of stock/billing.
                    try:
                        c_conn.execute(text("ALTER TABLE medicine_batches ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE"))
                        c_conn.execute(text("UPDATE medicine_batches SET is_active = TRUE WHERE is_active IS NULL"))
                        c_conn.commit()
                        print(f"➕ Ensured medicine_batches.is_active (backfilled NULLs) in '{c_db_name}'.")
                    except Exception:
                        c_conn.rollback()
                    
                    # Auto-migrate fin_year from 2526 → 2627 for FY 2026-27
                    try:
                        c_conn.execute(text(
                            "UPDATE doc_sequences SET fin_year = '2627' WHERE fin_year = '2526' AND use_fin_year = true"
                        ))
                        c_conn.commit()
                        print(f"🔁 Migrated fin_year 2526→2627 in doc_sequences for '{c_db_name}'.")
                    except Exception:
                        c_conn.rollback()

                    # Auto-seed system GL accounts (idempotent — ON CONFLICT DO NOTHING).
                    # Purchase Bill / Sales Bill / GST posting code hard-requires these by
                    # code (PURCH-MED, SALES-MED, GST-*-PAY/IN, CASH, BANK-001, DEB-CTRL,
                    # CRED-CTRL, ADV-SUP, ADV-CUST) via get_gl_by_code()/_gl_or_raise(), but
                    # nothing else ever created them — create_company() only calls
                    # init_sequences_for_db(). Without this, the first Purchase/Sales Bill
                    # in a company DB 500s with "GL account 'PURCH-MED' not found".
                    # See backend/run_seed_gl_master.py for the standalone one-off version.
                    try:
                        c_conn.execute(text("""
                            INSERT INTO gl_master (gl_code, gl_name, group_name, sub_group, is_active, is_system, balance_type) VALUES
                              ('CASH',          'Petty Cash',                 'Assets',      'Cash & Bank', TRUE, TRUE, 'DR'),
                              ('BANK-001',      'Main Bank Account',           'Assets',      'Cash & Bank', TRUE, TRUE, 'DR'),
                              ('DEB-CTRL',      'Debtors Control',             'Assets',      'Debtors',     TRUE, TRUE, 'DR'),
                              ('CRED-CTRL',     'Creditors Control',           'Liabilities', 'Creditors',   TRUE, TRUE, 'CR'),
                              ('GST-CGST-PAY',  'CGST Payable',                'Liabilities', 'GST Payable', TRUE, TRUE, 'CR'),
                              ('GST-SGST-PAY',  'SGST Payable',                'Liabilities', 'GST Payable', TRUE, TRUE, 'CR'),
                              ('GST-IGST-PAY',  'IGST Payable',                'Liabilities', 'GST Payable', TRUE, TRUE, 'CR'),
                              ('GST-CGST-IN',   'CGST Input Credit',           'Assets',      'GST Input',   TRUE, TRUE, 'DR'),
                              ('GST-SGST-IN',   'SGST Input Credit',           'Assets',      'GST Input',   TRUE, TRUE, 'DR'),
                              ('GST-IGST-IN',   'IGST Input Credit',           'Assets',      'GST Input',   TRUE, TRUE, 'DR'),
                              ('SALES-VET',     'Veterinary Services Income',  'Income',      'Sales',       TRUE, TRUE, 'CR'),
                              ('SALES-MED',     'Medicine Sales Income',       'Income',      'Sales',       TRUE, TRUE, 'CR'),
                              ('SALES-RET',     'Sales Returns',               'Income',      'Sales',       TRUE, TRUE, 'DR'),
                              ('PURCH-MED',     'Medicine Purchases',          'Expense',     'Purchases',   TRUE, TRUE, 'DR'),
                              ('PURCH-RET',     'Purchase Returns',            'Expense',     'Purchases',   TRUE, TRUE, 'CR'),
                              ('ADV-SUP',       'Advance to Suppliers',        'Liabilities', 'Advance',     TRUE, TRUE, 'DR'),
                              ('ADV-CUST',      'Advance from Customers',      'Liabilities', 'Advance',     TRUE, TRUE, 'CR')
                            ON CONFLICT (gl_code) DO NOTHING
                        """))
                        # Backfill in case some rows already exist from an earlier partial
                        # run (e.g. inserted without is_active/is_system set) — a plain
                        # INSERT without listing every column leaves those NULL, and
                        # Ledger.jsx filters is_active = TRUE by default.
                        c_conn.execute(text("""
                            UPDATE gl_master SET is_active = TRUE, is_system = TRUE
                            WHERE gl_code IN (
                                'CASH','BANK-001','DEB-CTRL','CRED-CTRL',
                                'GST-CGST-PAY','GST-SGST-PAY','GST-IGST-PAY',
                                'GST-CGST-IN','GST-SGST-IN','GST-IGST-IN',
                                'SALES-VET','SALES-MED','SALES-RET',
                                'PURCH-MED','PURCH-RET','ADV-SUP','ADV-CUST'
                            ) AND (is_active IS DISTINCT FROM TRUE OR is_system IS DISTINCT FROM TRUE)
                        """))
                        c_conn.commit()
                        print(f"➕ Ensured 17 system GL accounts exist in '{c_db_name}'.")
                    except Exception as e:
                        c_conn.rollback()
                        print(f"⚠️ GL master seed check failed for '{c_db_name}': {e}")
                print(f"✅ Company DB '{c_db_name}' sequences and migrations checked successfully.")
            except Exception as sub_e:
                print(f"⚠️ Could not init sequences/migrations for '{c_db_name}': {sub_e}")
except Exception as e:
    print(f"⚠️ Global sequence initialization check: {e}")

# ─── Migrate primary DB fin_year 2526 → 2627 ───────────────────────────────
try:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text(
            "UPDATE doc_sequences SET fin_year = '2627' WHERE fin_year = '2526' AND use_fin_year = true"
        ))
    print("🔁 Primary DB: Migrated fin_year 2526→2627 in doc_sequences.")
except Exception as e:
    print(f"⚠️ Primary DB fin_year migration: {e}")


# ─── Auto-Migrate Master DB Columns if missing ──────────────────────────────
try:
    with master_engine.connect() as conn:
        columns = [
            ("address_line2", "VARCHAR(200)"),
            ("address_line3", "VARCHAR(200)"),
            ("district", "VARCHAR(100)"),
            ("state_code", "VARCHAR(5)"),
            ("phone", "VARCHAR(20)"),
            ("alt_phone", "VARCHAR(20)"),
            ("email", "VARCHAR(100)"),
            ("website", "VARCHAR(200)"),
            ("reg_number", "VARCHAR(100)"),
            ("established_on", "DATE"),
        ]
        for col_name, col_type in columns:
            try:
                conn.execute(text(f"ALTER TABLE company_profiles ADD COLUMN {col_name} {col_type}"))
                conn.commit()
                print(f"➕ Added missing column '{col_name}' to company_profiles.")
            except Exception:
                conn.rollback()  # Column already exists
except Exception as e:
    print(f"⚠️ Master DB column migration check: {e}")

# ─── Auto-Migrate clinic_setup table columns if missing ─────────────────────
try:
    with engine.connect() as conn:
        clinic_columns = [
            ("city_name",  "VARCHAR(100)"),
            ("logo_path",  "VARCHAR(500)"),
        ]
        for col_name, col_type in clinic_columns:
            try:
                conn.execute(text(f"ALTER TABLE clinic_setup ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))
                conn.commit()
                print(f"➕ Added missing column '{col_name}' to clinic_setup.")
            except Exception:
                conn.rollback()
except Exception as e:
    print(f"⚠️ clinic_setup column migration check: {e}")

# ─── FastAPI App ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="🐾 Pet Clinic ERP",
    description="Full-featured ERP for Pet Clinics — Consultation, Pharmacy, Billing & more",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# ─── CORS (Explicitly list Vercel & Localhost for Mobile/Production CORS) ────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://localhost:3000", 
        "http://localhost:8000", 
        "https://pet-erp-six.vercel.app",
        "https://pet-erp-git-main-kuzhalone.vercel.app",
        "https://erp-ten-bice.vercel.app"
    ],
    # allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Register Routers ─────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/auth")
app.include_router(clinic.router)
app.include_router(masters.router)
app.include_router(owners.router)
app.include_router(pets.router)
app.include_router(doctors.router)
# Stage 1 & 2 additions
app.include_router(ledger_router)
app.include_router(agents_router)
app.include_router(users_router)
# Phase 2 — Clinical Core
app.include_router(appt_router)
app.include_router(schedule_router)
app.include_router(consult_router)
app.include_router(proc_router)
app.include_router(rx_router)
app.include_router(vaccine_router)
# Phase 3 — Pharmacy, Stock & Billing
app.include_router(inv_router)
app.include_router(phm_router)
app.include_router(billing_router)
app.include_router(services_router)
# Master System — Companies
app.include_router(companies_router)
# Phase 4 — Accounts
app.include_router(advance_payments_router)
app.include_router(bank_arrivals_router)
app.include_router(receipt_vouchers_router)
app.include_router(payment_vouchers_router)
app.include_router(journal_vouchers_router)
app.include_router(credit_notes_router)
app.include_router(debit_notes_router)
app.include_router(reports_router)
app.include_router(certificates_router)


# ─── Health Check Endpoint ───────────────────────────────────────────────────
@app.get("/", tags=["Health"])
def root():
    return {
        "status": "✅ Pet Clinic ERP is running",
        "docs": "/docs",
        "version": "1.0.0"
    }


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok"}
