"""routes/ledger.py — General Ledger (Chart of Accounts) CRUD"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import datetime
from database import get_db
from models.phase4 import GLMaster, OpeningBalance
from utils.gl_utils import get_current_fy

router = APIRouter(prefix="/ledger", tags=["Ledger"])


# ─── Schemas (inline for simplicity) ─────────────────────────
class GLBase(BaseModel):
    gl_code:         str
    gl_name:         str
    group_name:      str
    sub_group:       Optional[str] = None
    opening_balance: Optional[Decimal] = Decimal("0")
    balance_type:    str = "DR"
    phone:           Optional[str] = None
    alt_phone:       Optional[str] = None
    email:           Optional[str] = None
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


class GLCreate(GLBase):
    pass


class GLOut(GLBase):
    gl_id:      int
    is_system:  bool = False
    is_active:  bool = True
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ─── Routes ──────────────────────────────────────────────────
@router.get("/gl", response_model=List[GLOut])
def list_gl(
    group_name: Optional[str] = Query(None),
    sub_group: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db)
):
    q = db.query(GLMaster)
    if not include_inactive:
        q = q.filter(GLMaster.is_active == True)
    if group_name:
        q = q.filter(GLMaster.group_name == group_name)
    if sub_group:
        q = q.filter(GLMaster.sub_group == sub_group)
    return q.order_by(GLMaster.group_name, GLMaster.gl_name).all()

# Alias for legacy frontend calls
@router.get("/gl-master", response_model=List[GLOut])
def list_gl_master(
    group_name: Optional[str] = Query(None),
    sub_group: Optional[str] = Query(None),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db)
):
    return list_gl(group_name, sub_group, include_inactive, db)


@router.get("/gl/groups")
def list_groups(db: Session = Depends(get_db)):
    """Return distinct group_name values for filter dropdown."""
    rows = db.query(GLMaster.group_name).distinct().order_by(GLMaster.group_name).all()
    return [r[0] for r in rows]


@router.get("/gl/{gl_id}", response_model=GLOut)
def get_gl(gl_id: int, db: Session = Depends(get_db)):
    gl = db.query(GLMaster).filter(GLMaster.gl_id == gl_id).first()
    if not gl:
        raise HTTPException(status_code=404, detail="GL account not found")
    return gl


def _sync_opening_balance(db: Session, gl: GLMaster, opening_balance: Optional[Decimal], balance_type: str):
    """
    Mirror the Chart of Accounts 'Opening Balance' field into the opening_balances table for the
    CURRENT financial year. This matters because no ledger report ever reads
    `gl_master.opening_balance`/`balance_type` — General Ledger, Trial Balance, Cash Book and Bank
    Book all read the separate, FY-scoped `opening_balances` table instead (see
    routes/reports.py). Before this fix, typing an opening balance into the Chart of Accounts
    screen saved to `gl_master` and had NO visible effect on any report. This is the same
    `fy_code` lookup used by GL posting (utils/gl_utils.get_current_fy) and by the EOY rollover,
    which is also the only other thing that ever wrote to `opening_balances` before now.
    """
    opening_balance = opening_balance or Decimal("0")
    fy = get_current_fy(db)
    if not fy:
        if opening_balance != 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot set an opening balance: no Financial Year is marked current. Set up a Financial Year first, then edit this account's opening balance."
            )
        return

    ob = db.query(OpeningBalance).filter(
        OpeningBalance.fy_code == fy.fy_code,
        OpeningBalance.gl_id == gl.gl_id
    ).first()
    if ob:
        ob.amount = opening_balance
        ob.balance_type = balance_type
    else:
        db.add(OpeningBalance(
            fy_code=fy.fy_code,
            gl_id=gl.gl_id,
            amount=opening_balance,
            balance_type=balance_type
        ))


@router.post("/gl", response_model=GLOut)
def create_gl(data: GLCreate, db: Session = Depends(get_db)):
    existing = db.query(GLMaster).filter(GLMaster.gl_code == data.gl_code).first()
    if existing:
        raise HTTPException(status_code=400, detail="GL code already exists")
    try:
        gl = GLMaster(**data.model_dump())
        db.add(gl)
        db.flush()

        _sync_opening_balance(db, gl, data.opening_balance, data.balance_type)

        db.commit()
        db.refresh(gl)
        return gl
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to create GL account: {e}")


@router.put("/gl/{gl_id}", response_model=GLOut)
def update_gl(gl_id: int, data: GLCreate, db: Session = Depends(get_db)):
    gl = db.query(GLMaster).filter(GLMaster.gl_id == gl_id).first()
    if not gl:
        raise HTTPException(status_code=404, detail="GL account not found")
    try:
        if gl.is_system:
            # System accounts: only allow editing opening_balance (not code/name/group)
            gl.opening_balance = data.opening_balance
            gl.balance_type = data.balance_type
        else:
            for k, v in data.model_dump(exclude_unset=True).items():
                setattr(gl, k, v)

        _sync_opening_balance(db, gl, gl.opening_balance, gl.balance_type)

        db.commit()
        db.refresh(gl)
        return gl
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Failed to update GL account: {e}")


@router.delete("/gl/{gl_id}")
def deactivate_gl(gl_id: int, db: Session = Depends(get_db)):
    gl = db.query(GLMaster).filter(GLMaster.gl_id == gl_id).first()
    if not gl:
        raise HTTPException(status_code=404, detail="GL account not found")
    if gl.is_system:
        raise HTTPException(status_code=400, detail="System accounts cannot be deleted")
    gl.is_active = False
    db.commit()
    return {"message": "GL account deactivated"}
