"""routes/users.py — User management (admin only)"""
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from database import get_db
from models.users import User, UserModulePermission
from models.doctors import Doctor, Staff
import bcrypt

router = APIRouter(prefix="/users", tags=["Users"])

# Same 7 broad module codes already established in routes/companies.py's default_modules
# seeding and routes/auth.py's select_company fallback — kept identical for conceptual
# compatibility, though the permissions below are stored separately (see
# models/users.py's UserModulePermission docstring for why). NOTE: as of 2026-07-24
# nothing in the backend or frontend actually reads these to restrict access yet
# (routes/auth.py's enforce_module_access dependency exists but isn't wired into any
# route, and Sidebar.jsx doesn't filter on it either) — this is config storage + an admin
# UI only. Wiring up real enforcement is a separate, larger follow-up.
PERMISSION_MODULES = ["Clinic", "Masters", "Billing", "Pharmacy", "Inventory", "Reports", "Users"]


# ─── Schemas (inline) ────────────────────────────────────────
class UserCreate(BaseModel):
    username:         str
    full_name:        str
    role:             str = "staff"      # admin | doctor | receptionist | pharmacist | accountant
    email:            Optional[str] = None
    phone:            Optional[str] = None
    linked_doctor_id: Optional[int] = None
    linked_staff_id:  Optional[int] = None
    password:         str


class UserUpdate(BaseModel):
    full_name:        str
    role:             str
    email:            Optional[str] = None
    phone:            Optional[str] = None
    linked_doctor_id: Optional[int] = None
    linked_staff_id:  Optional[int] = None


class UserOut(BaseModel):
    user_id:          int
    username:         str
    full_name:        str
    role:             str
    email:            Optional[str] = None
    phone:            Optional[str] = None
    linked_doctor_id: Optional[int] = None
    linked_staff_id:  Optional[int] = None
    is_active:        bool = True
    last_login:       Optional[datetime] = None
    created_at:       Optional[datetime] = None

    class Config:
        from_attributes = True


class PasswordReset(BaseModel):
    new_password: str


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


# ─── Routes ──────────────────────────────────────────────────
@router.get("", response_model=List[UserOut])
def list_users(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db)
):
    q = db.query(User)
    if not include_inactive:
        q = q.filter(User.is_active == True)
    return q.order_by(User.full_name).all()


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


@router.post("", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")
    payload = data.model_dump(exclude={"password"})
    payload["password_hash"] = hash_password(data.password)
    u = User(**payload)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(u, k, v)
    db.commit()
    db.refresh(u)
    return u


@router.put("/{user_id}/deactivate")
def deactivate_user(user_id: int, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = False
    db.commit()
    return {"message": "User deactivated"}


@router.put("/{user_id}/reactivate")
def reactivate_user(user_id: int, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.is_active = True
    db.commit()
    return {"message": "User reactivated"}


@router.put("/{user_id}/reset-password")
def admin_reset_password(user_id: int, data: PasswordReset, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    u.password_hash = hash_password(data.new_password)
    db.commit()
    return {"message": "Password reset successfully"}


# ─── Module / CRUD Permissions ─────────────────────────────────
#
# Storage: models/users.py's UserModulePermission, a table in THIS company's own database,
# FK'd to the local `users` table. (First attempt at this reused master_sys.py's
# UserModuleAccess — the table routes/companies.py's "Manage Roles" screen uses — but that
# table's user_id column has a real Postgres FK to master_users.user_id in the master DB,
# so writing an operational User's id into it raised a ForeignKeyViolation on every save.
# See models/users.py's UserModulePermission docstring for the full explanation.)

class ModulePermissionItem(BaseModel):
    module_code: str
    can_view:    bool = False
    can_create:  bool = False
    can_edit:    bool = False
    can_delete:  bool = False
    can_export:  bool = False


class PermissionsUpdate(BaseModel):
    modules: List[ModulePermissionItem]


def _ensure_permissions_table(db: Session):
    """Self-healing create-if-missing for user_module_permissions.

    This app has no formal migration runner — several of the raw .sql files under
    migrations/ were written but never actually applied to running databases (see
    chart_of_accounts.md project notes for a prior, concrete example: seed_gl_master.sql).
    Base.metadata.create_all() only ever runs once, at company-creation time, so an
    existing company database created before this table existed would never get it
    automatically. checkfirst=True makes this a safe no-op once the table exists, so
    there's no separate script for the user to remember to run.
    """
    UserModulePermission.__table__.create(bind=db.get_bind(), checkfirst=True)


@router.get("/{user_id}/permissions")
def get_user_permissions(user_id: int, db: Session = Depends(get_db)):
    """Return this user's per-module View/Create/Edit/Delete/Export permissions.

    Always returns all PERMISSION_MODULES (defaulting to all-False for any module with no
    saved row yet) so the UI has a complete checklist to render, rather than a partial list
    the frontend would have to fill in itself.
    """
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    _ensure_permissions_table(db)

    rows = db.query(UserModulePermission).filter(UserModulePermission.user_id == user_id).all()
    by_code = {r.module_code: r for r in rows}

    modules = []
    for code in PERMISSION_MODULES:
        r = by_code.get(code)
        modules.append({
            "module_code": code,
            "can_view":   r.can_view if r else False,
            "can_create": r.can_create if r else False,
            "can_edit":   r.can_edit if r else False,
            "can_delete": r.can_delete if r else False,
            "can_export": r.can_export if r else False,
        })

    return {
        "user_id":   u.user_id,
        "full_name": u.full_name,
        "role":      u.role,
        "modules":   modules,
        # True once an admin has saved this user's permissions at least once (i.e. at least
        # one row exists in user_module_permissions for them). The frontend uses this to tell
        # "admin explicitly restricted this user" apart from "admin has never touched this
        # user's permissions yet" — both cases return the same all-False `modules` list above,
        # but only the first one should actually restrict what the user can see. Without this
        # flag, every user who has never been assigned permissions would silently lose access
        # to the whole app the moment enforcement ships, which isn't the intended behavior.
        "has_custom_permissions": bool(rows),
    }


@router.put("/{user_id}/permissions")
def update_user_permissions(user_id: int, data: PermissionsUpdate, db: Session = Depends(get_db)):
    """Upsert this user's per-module permissions (create-or-update per module_code)."""
    u = db.query(User).filter(User.user_id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    _ensure_permissions_table(db)

    for item in data.modules:
        r = db.query(UserModulePermission).filter(
            UserModulePermission.user_id == user_id,
            UserModulePermission.module_code == item.module_code,
        ).first()
        if r:
            r.can_view = item.can_view
            r.can_create = item.can_create
            r.can_edit = item.can_edit
            r.can_delete = item.can_delete
            r.can_export = item.can_export
        else:
            db.add(UserModulePermission(
                user_id=user_id,
                module_code=item.module_code,
                can_view=item.can_view,
                can_create=item.can_create,
                can_edit=item.can_edit,
                can_delete=item.can_delete,
                can_export=item.can_export,
            ))
    db.commit()
    return {"message": "Permissions updated successfully"}
