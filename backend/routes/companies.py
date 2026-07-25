"""
routes/companies.py — Company Management, Auto DB Creation & RBAC Module Permissions endpoints
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker
from database import get_master_db, get_engine_for_db, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, Base
from models.master_sys import Tenant, CompanyProfile, Role, MasterUser, UserModuleAccess
from models.clinic import ClinicSetup
from models.phase4 import FinancialYear
from schemas.companies import CompanyCreate, CompanyOut, UserModuleAccessOut, UserModuleAccessUpdate
from utils.encryption import encrypt_db_uri
from utils.doc_sequence import init_sequences_for_db

router = APIRouter(prefix="/companies", tags=["Companies"])

@router.get("/", response_model=list[CompanyOut])
def get_companies(tenant_id: int = 1, db: Session = Depends(get_master_db)):
    """List all companies for a tenant."""
    # Ensure default tenant exists
    tenant = db.query(Tenant).filter(Tenant.tenant_id == tenant_id).first()
    if not tenant:
        tenant = Tenant(tenant_id=tenant_id, tenant_name="Default Tenant", email="admin@petclinicerp.com", password_hash="hashed_pw")
        db.add(tenant)
        db.commit()
    
    companies = db.query(CompanyProfile).filter(CompanyProfile.tenant_id == tenant_id).all()
    return companies

@router.post("/", response_model=CompanyOut)
def create_company(data: CompanyCreate, db: Session = Depends(get_master_db)):
    """Create a new company DB, run migrations/schema creation, and seed default data."""
    # Verify tenant exists
    tenant = db.query(Tenant).filter(Tenant.tenant_id == data.tenant_id).first()
    if not tenant:
        tenant = Tenant(tenant_id=data.tenant_id, tenant_name="Default Tenant", email="admin@petclinicerp.com", password_hash="hashed_pw")
        db.add(tenant)
        db.commit()

    # Check max 3 companies
    count = db.query(CompanyProfile).filter(CompanyProfile.tenant_id == data.tenant_id).count()
    if count >= 3:
        raise HTTPException(status_code=400, detail="Maximum 3 companies allowed per tenant.")

    # Check unique company code
    existing = db.query(CompanyProfile).filter(CompanyProfile.tenant_id == data.tenant_id, CompanyProfile.company_code == data.company_code.upper()).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Company code '{data.company_code.upper()}' already exists for this tenant.")

    db_name = f"tenant{data.tenant_id}_{data.company_code.lower()}_clinic"
    import os
    from database import DB_NAME
    if os.getenv("DATABASE_URL"):
        db_name = DB_NAME
    else:
        try:
            root_engine = create_engine(f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/postgres", isolation_level="AUTOCOMMIT")
            with root_engine.connect() as conn:
                res = conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname = '{db_name}'"))
                if not res.fetchone():
                    conn.execute(text(f"CREATE DATABASE {db_name}"))
        except Exception as e:
            print(f"⚠️ Could not create separate database '{db_name}': {e}. Falling back to default DB.")
            db_name = DB_NAME

    db_uri_plain = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{db_name}"
    
    # 2. Instantiate full company DB schema using Base.metadata.create_all
    company_engine = create_engine(db_uri_plain)
    Base.metadata.create_all(bind=company_engine)

    # Initialize document sequences and PL/pgSQL functions for the new company database
    init_sequences_for_db(company_engine)

    # 3. Encrypt db_uri and save CompanyProfile in Master DB
    encrypted_uri = encrypt_db_uri(db_uri_plain)
    company = CompanyProfile(
        tenant_id=data.tenant_id,
        company_code=data.company_code.upper(),
        company_name=data.company_name,
        db_name=db_name,
        db_uri=encrypted_uri,
        address_line1=data.address_line1,
        address_line2=data.address_line2,
        address_line3=data.address_line3,
        city=data.city,
        district=data.district,
        state=data.state,
        state_code=data.state_code,
        pincode=data.pincode,
        phone=data.phone,
        alt_phone=data.alt_phone,
        email=data.email,
        website=data.website,
        gst_number=data.gst_number,
        pan_number=data.pan_number,
        reg_number=data.reg_number,
        drug_license_no=data.drug_license_no,
        established_on=data.established_on,
        logo_url=data.logo_url,
        current_fy=data.current_fy,
        fy_start_month=data.fy_start_month,
        status="Active"
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    # Seed default roles in Master DB
    default_roles = ["Admin", "Doctor", "Receptionist", "Pharmacist"]
    for r_name in default_roles:
        role = Role(company_id=company.company_id, role_name=r_name, is_system=True)
        db.add(role)
    db.commit()

    # 4. Seed company_settings (ClinicSetup) and FinancialYear in Company DB
    CompanySession = sessionmaker(bind=company_engine)
    c_db = CompanySession()
    try:
        setup = c_db.query(ClinicSetup).first()
        if not setup:
            setup = ClinicSetup(
                clinic_name=data.company_name,
                address1=data.address_line1,
                address2=data.address_line2,
                address3=data.address_line3,
                city=data.city,
                district=data.district,
                state_name=data.state,
                state_code=data.state_code,
                pincode=data.pincode,
                phone=data.phone,
                alt_phone=data.alt_phone,
                email=data.email,
                website=data.website,
                gstin=data.gst_number,
                pan=data.pan_number,
                reg_number=data.reg_number,
                drug_license_no=data.drug_license_no,
                established_on=data.established_on,
                fy_start_month=data.fy_start_month
            )
            c_db.add(setup)
        
        fy = c_db.query(FinancialYear).filter(FinancialYear.fy_code == data.current_fy).first()
        if not fy:
            fy = FinancialYear(
                fy_code=data.current_fy,
                start_date=f"2026-04-01",
                end_date=f"2027-03-31",
                is_current=True,
                is_locked=False
            )
            c_db.add(fy)
        c_db.commit()
    finally:
        c_db.close()

    return company


@router.get("/{company_id}/modules", response_model=list[UserModuleAccessOut])
def get_company_module_access(company_id: int, db: Session = Depends(get_master_db)):
    """List all users and their module permissions for a specific company."""
    company = db.query(CompanyProfile).filter(CompanyProfile.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Fetch MasterUser list for the tenant
    users = db.query(MasterUser).filter(MasterUser.tenant_id == company.tenant_id).all()
    
    # If no master users exist yet, create a default master user
    if not users:
        u = MasterUser(
            tenant_id=company.tenant_id,
            full_name="System Admin",
            email="admin@petclinicerp.com",
            password_hash="$2b$12$7k/347...hashed_pw",  # Placeholder hash
            phone="1234567890",
            is_active=True
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        users = [u]

    out = []
    default_modules = ["Clinic", "Masters", "Billing", "Pharmacy", "Inventory", "Reports", "Users"]

    for u in users:
        access_list = db.query(UserModuleAccess).filter(
            UserModuleAccess.user_id == u.user_id,
            UserModuleAccess.company_id == company_id
        ).all()

        if not access_list:
            # Seed default access
            for m_code in default_modules:
                m_access = UserModuleAccess(
                    user_id=u.user_id,
                    company_id=company_id,
                    module_code=m_code,
                    can_view=True,
                    can_create=True,
                    can_edit=True,
                    can_delete=False,
                    can_export=False
                )
                db.add(m_access)
            db.commit()
            access_list = db.query(UserModuleAccess).filter(
                UserModuleAccess.user_id == u.user_id,
                UserModuleAccess.company_id == company_id
            ).all()

        modules_out = [
            {
                "module_code": a.module_code,
                "can_view": a.can_view,
                "can_create": a.can_create,
                "can_edit": a.can_edit,
                "can_delete": a.can_delete,
                "can_export": a.can_export
            }
            for a in access_list
        ]
        out.append({
            "user_id": u.user_id,
            "full_name": u.full_name,
            "email": u.email,
            "role": "Admin",
            "modules": modules_out
        })
    return out


@router.post("/{company_id}/modules")
def update_company_module_access(company_id: int, data: UserModuleAccessUpdate, db: Session = Depends(get_master_db)):
    """Update module permissions for a user in a specific company."""
    company = db.query(CompanyProfile).filter(CompanyProfile.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    for item in data.modules:
        m_access = db.query(UserModuleAccess).filter(
            UserModuleAccess.user_id == data.user_id,
            UserModuleAccess.company_id == company_id,
            UserModuleAccess.module_code == item.module_code
        ).first()

        if m_access:
            m_access.can_view = item.can_view
            m_access.can_create = item.can_create
            m_access.can_edit = item.can_edit
            m_access.can_delete = item.can_delete
            m_access.can_export = item.can_export
        else:
            m_access = UserModuleAccess(
                user_id=data.user_id,
                company_id=company_id,
                module_code=item.module_code,
                can_view=item.can_view,
                can_create=item.can_create,
                can_edit=item.can_edit,
                can_delete=item.can_delete,
                can_export=item.can_export
            )
            db.add(m_access)
    db.commit()
    return {"message": "Module permissions updated successfully"}


from models.phase4 import FinancialYear, GLMaster, OpeningBalance
from models.accounts import GLPosting
from sqlalchemy.sql import func

@router.post("/{company_id}/rollover")
def rollover_financial_year(company_id: int, db: Session = Depends(get_master_db)):
    """Perform End-Of-Year (EOY) Rollover for a specific company."""
    company = db.query(CompanyProfile).filter(CompanyProfile.company_id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    c_engine = get_engine_for_db(company.db_name)
    CompanySession = sessionmaker(bind=c_engine)
    c_db = CompanySession()

    try:
        # 1. Get current active FY
        current_fy = c_db.query(FinancialYear).filter(FinancialYear.is_current == True).first()
        if not current_fy:
            raise HTTPException(status_code=400, detail="No active financial year found to rollover.")

        if current_fy.is_locked:
            raise HTTPException(status_code=400, detail=f"Financial year {current_fy.fy_code} is already locked.")

        # Calculate next FY code (e.g. '2026-27' -> '2027-28')
        parts = current_fy.fy_code.split("-")
        if len(parts) == 2:
            start_yr = int(parts[0])
            end_yr = int(parts[1])
            next_fy_code = f"{start_yr + 1}-{end_yr + 1}"
            next_start_date = f"{start_yr + 1}-04-01"
            next_end_date = f"{start_yr + 2}-03-31"
        else:
            next_fy_code = "2027-28"
            next_start_date = "2027-04-01"
            next_end_date = "2028-03-31"

        # Check if next FY already exists
        next_fy = c_db.query(FinancialYear).filter(FinancialYear.fy_code == next_fy_code).first()
        if not next_fy:
            next_fy = FinancialYear(
                fy_code=next_fy_code,
                start_date=next_start_date,
                end_date=next_end_date,
                is_current=True,
                is_locked=False
            )
            c_db.add(next_fy)
        else:
            next_fy.is_current = True

        # Lock current FY
        current_fy.is_current = False
        current_fy.is_locked = True
        current_fy.locked_at = func.now()

        # 2. Calculate closing balances for all GL accounts
        gl_accounts = c_db.query(GLMaster).all()
        for gl in gl_accounts:
            # Get opening balance for current FY
            ob = c_db.query(OpeningBalance).filter(OpeningBalance.fy_code == current_fy.fy_code, OpeningBalance.gl_id == gl.gl_id).first()
            balance = ob.amount if ob else 0
            if ob and ob.balance_type == "CR":
                balance = -balance

            # Add debits and subtract credits actually posted to the ledger in the current FY.
            # This used to sum models.phase4.Voucher — a simple single debit_gl/credit_gl/amount
            # table that is never instantiated anywhere in the app (grepped across routes/*.py to
            # confirm). Every real posting (Sales/Purchase Bill, Payment/Receipt Voucher, Credit/
            # Debit Note, Advance Payment, Bank Arrival, Journal Voucher) writes to gl_postings via
            # GLPosting instead, so summing Voucher always produced a closing balance of 0 (rolled
            # forward as if nothing happened all year) regardless of actual activity.
            debits = c_db.query(func.sum(GLPosting.dr_amount)).filter(GLPosting.fy_code == current_fy.fy_code, GLPosting.gl_id == gl.gl_id).scalar() or 0
            credits = c_db.query(func.sum(GLPosting.cr_amount)).filter(GLPosting.fy_code == current_fy.fy_code, GLPosting.gl_id == gl.gl_id).scalar() or 0

            closing_balance = balance + debits - credits
            new_bal_type = "DR" if closing_balance >= 0 else "CR"
            abs_amount = abs(closing_balance)

            # Create opening balance for next FY
            new_ob = c_db.query(OpeningBalance).filter(OpeningBalance.fy_code == next_fy_code, OpeningBalance.gl_id == gl.gl_id).first()
            if new_ob:
                new_ob.amount = abs_amount
                new_ob.balance_type = new_bal_type
            else:
                new_ob = OpeningBalance(
                    fy_code=next_fy_code,
                    gl_id=gl.gl_id,
                    amount=abs_amount,
                    balance_type=new_bal_type
                )
                c_db.add(new_ob)

        # 3. Update CompanyProfile in Master DB
        company.current_fy = next_fy_code
        db.commit()

        c_db.commit()
        return {"message": f"Successfully rolled over financial year to {next_fy_code}", "new_fy": next_fy_code}
    except Exception as e:
        c_db.rollback()
        raise HTTPException(status_code=500, detail=f"Rollover failed: {str(e)}")
    finally:
        c_db.close()

