"""models/users.py — Users (login) table"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint, func
from database import Base


class User(Base):
    __tablename__ = "users"

    user_id             = Column(Integer, primary_key=True, index=True)
    username            = Column(String(50), unique=True, nullable=False, index=True)
    password_hash       = Column(String, nullable=False)
    full_name           = Column(String(150), nullable=False)
    role                = Column(String(30), nullable=False, default="staff")
    email               = Column(String(100), nullable=True)
    phone               = Column(String(20), nullable=True)
    linked_doctor_id    = Column(Integer, ForeignKey("doctors.doctor_id", ondelete="SET NULL"), nullable=True)
    linked_staff_id     = Column(Integer, ForeignKey("staff.staff_id", ondelete="SET NULL"), nullable=True)
    is_active           = Column(Boolean, default=True)
    last_login          = Column(DateTime, nullable=True)
    created_at          = Column(DateTime, server_default=func.now())


class UserModulePermission(Base):
    """Per-module View/Create/Edit/Delete/Export permissions for one operational User.

    NOTE (2026-07-24): this is a SECOND, separate permissions table from
    models/master_sys.py's UserModuleAccess. That one lives in the master DB and its
    user_id column has a real Postgres FOREIGN KEY to master_users.user_id — using it for
    operational Users (this file's `User`, whose IDs come from the company DB's own
    sequence) raised a ForeignKeyViolation on every save, since those IDs don't exist in
    master_users. This table sidesteps that entirely by living in the SAME company
    database as `users` and pointing its FK at the local `users` table instead — no
    cross-database reference, so it can never violate a constraint like that.
    """
    __tablename__ = "user_module_permissions"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    module_code = Column(String(50), nullable=False)
    can_view    = Column(Boolean, default=False)
    can_create  = Column(Boolean, default=False)
    can_edit    = Column(Boolean, default=False)
    can_delete  = Column(Boolean, default=False)
    can_export  = Column(Boolean, default=False)

    __table_args__ = (UniqueConstraint('user_id', 'module_code', name='uq_user_module_permission'),)
