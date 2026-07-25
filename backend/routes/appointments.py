"""routes/appointments.py — Appointment booking, check-in, and doctor schedule"""
from calendar import monthrange
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, func
from typing import List, Optional
from datetime import date, datetime, timedelta

from database import get_db
from models.phase2 import Appointment, DoctorSchedule, Consultation, VaccinationRecord, VaccinationReminder
from models.doctors import Doctor
from models.people import Pet, PetOwner
from models.masters import Species
from schemas.appointments import (
    AppointmentCreate, AppointmentUpdate, AppointmentOut,
    DoctorScheduleCreate, DoctorScheduleOut
)
from utils.doc_sequence import get_next_doc_no
from utils.gl_utils import get_current_fy

router = APIRouter(prefix="/appointments", tags=["Appointments"])
schedule_router = APIRouter(prefix="/doctor-schedule", tags=["Doctor Schedule"])


# ── DOCTOR SCHEDULE ─────────────────────────────────────────

@schedule_router.get("/{doctor_id}", response_model=List[DoctorScheduleOut])
def get_schedule(doctor_id: int, db: Session = Depends(get_db)):
    return db.query(DoctorSchedule).filter(
        DoctorSchedule.doctor_id == doctor_id,
        DoctorSchedule.is_active == True
    ).all()


@schedule_router.post("", response_model=DoctorScheduleOut)
def upsert_schedule(data: DoctorScheduleCreate, db: Session = Depends(get_db)):
    existing = db.query(DoctorSchedule).filter(
        DoctorSchedule.doctor_id == data.doctor_id,
        DoctorSchedule.day_of_week == data.day_of_week
    ).first()
    if existing:
        for k, v in data.model_dump().items():
            setattr(existing, k, v)
        db.commit(); db.refresh(existing); return existing
    s = DoctorSchedule(**data.model_dump())
    db.add(s); db.commit(); db.refresh(s)
    return s


@schedule_router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, db: Session = Depends(get_db)):
    s = db.query(DoctorSchedule).filter(DoctorSchedule.schedule_id == schedule_id).first()
    if not s:
        raise HTTPException(404, "Schedule not found")
    s.is_active = False
    db.commit()
    return {"message": "Schedule deactivated"}


# ── APPOINTMENTS ─────────────────────────────────────────────

@router.get("", response_model=List[AppointmentOut])
def list_appointments(
    appt_date: Optional[date] = Query(None),
    doctor_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    pet_id: Optional[int] = Query(None),
    skip: int = 0, limit: int = 100,
    db: Session = Depends(get_db)
):
    q = db.query(Appointment)
    if appt_date:
        q = q.filter(Appointment.appt_date == appt_date)
    if doctor_id:
        q = q.filter(Appointment.doctor_id == doctor_id)
    if status:
        q = q.filter(Appointment.status == status)
    if pet_id:
        q = q.filter(Appointment.pet_id == pet_id)
    return q.order_by(Appointment.appt_date, Appointment.appt_time).offset(skip).limit(limit).all()


@router.get("/{appt_id}", response_model=AppointmentOut)
def get_appointment(appt_id: int, db: Session = Depends(get_db)):
    a = db.query(Appointment).filter(Appointment.appt_id == appt_id).first()
    if not a:
        raise HTTPException(404, "Appointment not found")
    return a


@router.post("", response_model=AppointmentOut)
def create_appointment(data: AppointmentCreate, db: Session = Depends(get_db)):
    appt_no = get_next_doc_no(db, "APT")
    appt = Appointment(appt_no=appt_no, **data.model_dump())
    db.add(appt); db.commit(); db.refresh(appt)
    return appt


@router.put("/{appt_id}", response_model=AppointmentOut)
def update_appointment(appt_id: int, data: AppointmentUpdate, db: Session = Depends(get_db)):
    a = db.query(Appointment).filter(Appointment.appt_id == appt_id).first()
    if not a:
        raise HTTPException(404, "Appointment not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(a, k, v)
    db.commit(); db.refresh(a)
    return a


@router.put("/{appt_id}/checkin", response_model=AppointmentOut)
def checkin(appt_id: int, db: Session = Depends(get_db)):
    """Check-in: marks appointment as Arrived. Consultation is created separately by doctor."""
    a = db.query(Appointment).filter(Appointment.appt_id == appt_id).first()
    if not a:
        raise HTTPException(404, "Appointment not found")
    
    # If already arrived, this could be a mistake, but we allow 're-checkin' or just ignore
    # Let's add a separate undo checkin route if needed, or just allow Scheduled -> Arrived.
    if a.status not in ("Scheduled", "Cancelled", "No-Show"):
         # If already In-Consultation or Completed, don't allow reverting via check-in
         raise HTTPException(400, f"Cannot check-in appointment with status '{a.status}'")
    
    a.status = "Arrived"
    a.arrived_at = datetime.utcnow()
    db.commit(); db.refresh(a)
    return a


@router.put("/{appt_id}/undo-checkin", response_model=AppointmentOut)
def undo_checkin(appt_id: int, db: Session = Depends(get_db)):
    """Reverts status from Arrived back to Scheduled."""
    a = db.query(Appointment).filter(Appointment.appt_id == appt_id).first()
    if not a:
        raise HTTPException(404, "Appointment not found")
    if a.status != "Arrived":
        raise HTTPException(400, "Can only undo check-in for 'Arrived' appointments")
    
    a.status = "Scheduled"
    a.arrived_at = None
    db.commit(); db.refresh(a)
    return a


@router.put("/{appt_id}/cancel")
def cancel_appointment(appt_id: int, db: Session = Depends(get_db)):
    a = db.query(Appointment).filter(Appointment.appt_id == appt_id).first()
    if not a:
        raise HTTPException(404, "Appointment not found")
    if a.status in ("Completed", "In-Consultation"):
        raise HTTPException(400, f"Cannot cancel an appointment that is '{a.status}'")
    a.status = "Cancelled"
    db.commit()
    return {"message": "Appointment cancelled"}


@router.put("/{appt_id}/no-show")
def no_show(appt_id: int, db: Session = Depends(get_db)):
    a = db.query(Appointment).filter(Appointment.appt_id == appt_id).first()
    if not a:
        raise HTTPException(404, "Appointment not found")
    if a.status in ("Completed", "In-Consultation"):
        raise HTTPException(400, f"Cannot mark as no-show an appointment that is '{a.status}'")
    a.status = "No-Show"
    db.commit()
    return {"message": "Marked as no-show"}


@router.get("/slots/{doctor_id}")
def available_slots(
    doctor_id: int,
    appt_date: date = Query(...),
    db: Session = Depends(get_db)
):
    """Return available time slots for a doctor on a given date."""
    # Get doctor's schedule for this day (0=Mon … 6=Sun)
    dow = appt_date.weekday()
    sched = db.query(DoctorSchedule).filter(
        DoctorSchedule.doctor_id == doctor_id,
        DoctorSchedule.day_of_week == dow,
        DoctorSchedule.is_active == True
    ).first()
    if not sched:
        return {"slots": [], "message": "Doctor not available on this day"}

    # Get booked slots
    booked = db.query(Appointment.appt_time).filter(
        Appointment.doctor_id == doctor_id,
        Appointment.appt_date == appt_date,
        Appointment.status.notin_(["Cancelled", "No-Show"])
    ).all()
    booked_times = {str(b[0])[:5] for b in booked}

    # Generate all slots
    from datetime import datetime, timedelta
    slot_start = datetime.combine(appt_date, sched.start_time)
    slot_end   = datetime.combine(appt_date, sched.end_time)
    duration   = timedelta(minutes=sched.slot_duration)

    slots = []
    while slot_start + duration <= slot_end:
        t = slot_start.strftime("%H:%M")
        slots.append({"time": t, "available": t not in booked_times})
        slot_start += duration

    return {"slots": slots, "date": str(appt_date), "doctor_id": doctor_id}


# ── ANALYTICS ──────────────────────────────────────────────────
#
# Backs the Dashboard's species-visit chart (Dashboard.jsx → SpeciesVisitChart.jsx). The
# x-axis is meant to be dynamic — only species that actually have visits in the selected
# period should appear (e.g. only "Dog" if no cats came in) — so this groups and returns
# only species with at least one matching appointment, rather than padding in every species
# from the master table at zero.
#
# "Visited" is interpreted as any appointment that represents an actual/expected clinic
# visit — every status except Cancelled and No-Show — not just ones that were literally
# booked. This is a judgment call (the user said "based on the appointment scheduling" but
# also "how many dogs visited"); flag if scheduled-regardless-of-outcome was actually meant.

@router.get("/analytics/species-summary")
def species_visit_summary(
    period: str = Query("daily", pattern="^(daily|weekly|monthly|fy)$"),
    ref_date: Optional[date] = Query(None, description="Anchor date for daily/weekly/monthly. Ignored for period=fy. Defaults to today."),
    db: Session = Depends(get_db)
):
    anchor = ref_date or date.today()

    if period == "daily":
        start = end = anchor
        range_label = anchor.strftime("%d %b %Y")
    elif period == "weekly":
        start = anchor - timedelta(days=anchor.weekday())  # Monday
        end = start + timedelta(days=6)                     # Sunday
        range_label = f"{start.strftime('%d %b')} – {end.strftime('%d %b %Y')}"
    elif period == "monthly":
        start = anchor.replace(day=1)
        end = anchor.replace(day=monthrange(anchor.year, anchor.month)[1])
        range_label = anchor.strftime("%B %Y")
    else:  # fy
        # No list-all-financial-years endpoint exists yet in this app (only the row flagged
        # is_current is resolvable) — this option always shows the current FY, it isn't a
        # picker across past years. See utils/gl_utils.get_current_fy's own docstring.
        fy = get_current_fy(db)
        if not fy:
            return {"period": period, "range_label": "No financial year configured", "range": None, "data": []}
        start, end = fy.start_date, fy.end_date
        range_label = f"FY {fy.fy_code}"

    rows = (
        db.query(
            Species.species_id,
            Species.species_name,
            func.count(Appointment.appt_id).label("cnt"),
        )
        .join(Pet, Pet.species_id == Species.species_id)
        .join(Appointment, Appointment.pet_id == Pet.pet_id)
        .filter(
            Appointment.appt_date >= start,
            Appointment.appt_date <= end,
            Appointment.status.notin_(["Cancelled", "No-Show"]),
        )
        .group_by(Species.species_id, Species.species_name)
        .order_by(func.count(Appointment.appt_id).desc())
        .all()
    )

    return {
        "period": period,
        "range_label": range_label,
        "range": {"start": str(start), "end": str(end)},
        "data": [
            {"species_id": r.species_id, "species_name": r.species_name, "count": r.cnt}
            for r in rows
        ],
    }


# ── DOCTOR WORKLOAD ──────────────────────────────────────────────
#
# Backs Dashboard.jsx's DoctorWorkloadChart — "how packed is a doctor" viewed as a
# per-day bar (for the week/month windows) or per-month bar (year window), split into two
# stacked series so a doctor can tell actual booked load apart from what's just coming up:
#   - "appointments"  — real booked Appointment rows (status not Cancelled/No-Show)
#   - "due_revisits"  — things NOT yet a formal appointment but already expected: pending/
#     notified vaccination reminders, plus consultation follow-up dates (a doctor telling an
#     owner "bring them back in 2 weeks" sets Consultation.followup_date — that's what
#     "scheduled revisit" refers to; there's no separate revisit-booking table in this app).
# `doctor_id` optional — omit for all doctors combined, pass one to filter to a single
# doctor's own load (the frontend's doctor picker drives this).

@router.get("/analytics/doctor-workload")
def doctor_workload(
    window: str = Query("week", pattern="^(week|month|year)$"),
    ref_date: Optional[date] = Query(None, description="Anchor date for week/month windows. Ignored for window=year (uses current FY). Defaults to today."),
    doctor_id: Optional[int] = Query(None, description="Filter to one doctor's workload. Omit for all doctors combined."),
    db: Session = Depends(get_db)
):
    anchor = ref_date or date.today()

    if window == "week":
        start = anchor - timedelta(days=anchor.weekday())  # Monday
        end = start + timedelta(days=6)                     # Sunday
        buckets = [start + timedelta(days=i) for i in range(7)]
        bucket_label = lambda d: d.strftime("%a %d")
        bucket_of = lambda d: d
        range_label = f"{start.strftime('%d %b')} – {end.strftime('%d %b %Y')}"
    elif window == "month":
        start = anchor.replace(day=1)
        last_day = monthrange(anchor.year, anchor.month)[1]
        end = anchor.replace(day=last_day)
        buckets = [start + timedelta(days=i) for i in range(last_day)]
        bucket_label = lambda d: d.strftime("%d")
        bucket_of = lambda d: d
        range_label = anchor.strftime("%B %Y")
    else:  # year -> current FY, bucketed by month (see species-summary's note on why this
        # can't be an arbitrary past year — no list-all-financial-years endpoint exists yet)
        fy = get_current_fy(db)
        if not fy:
            return {"window": window, "range_label": "No financial year configured", "doctor_id": doctor_id, "buckets": []}
        start, end = fy.start_date, fy.end_date
        range_label = f"FY {fy.fy_code}"
        buckets = []
        cur = start.replace(day=1)
        while cur <= end:
            buckets.append(cur)
            cur = (cur.replace(day=28) + timedelta(days=4)).replace(day=1)  # jump into next month, then snap to day 1
        bucket_label = lambda d: d.strftime("%b %Y")
        bucket_of = lambda d: d.replace(day=1)

    # ── Appointments (booked, non-cancelled) ──
    appt_q = db.query(Appointment.appt_date, func.count(Appointment.appt_id)).filter(
        Appointment.appt_date >= start,
        Appointment.appt_date <= end,
        Appointment.status.notin_(["Cancelled", "No-Show"]),
    )
    if doctor_id:
        appt_q = appt_q.filter(Appointment.doctor_id == doctor_id)
    appt_counts = {}
    for d, cnt in appt_q.group_by(Appointment.appt_date).all():
        key = bucket_of(d)
        appt_counts[key] = appt_counts.get(key, 0) + cnt

    # ── Due / Revisits: pending vaccination reminders (doctor via the linked record)... ──
    vac_q = db.query(VaccinationReminder.due_date, VaccinationRecord.doctor_id).join(
        VaccinationRecord, VaccinationRecord.vacc_record_id == VaccinationReminder.vacc_record_id
    ).filter(
        VaccinationReminder.due_date >= start,
        VaccinationReminder.due_date <= end,
        VaccinationReminder.reminder_status.in_(["Pending", "Notified"]),
    )
    if doctor_id:
        vac_q = vac_q.filter(VaccinationRecord.doctor_id == doctor_id)

    # ...plus consultation follow-up dates (scheduled revisits)
    fu_q = db.query(Consultation.followup_date, Consultation.doctor_id).filter(
        Consultation.followup_date.isnot(None),
        Consultation.followup_date >= start,
        Consultation.followup_date <= end,
    )
    if doctor_id:
        fu_q = fu_q.filter(Consultation.doctor_id == doctor_id)

    due_counts = {}
    for d, _doc in vac_q.all():
        key = bucket_of(d)
        due_counts[key] = due_counts.get(key, 0) + 1
    for d, _doc in fu_q.all():
        key = bucket_of(d)
        due_counts[key] = due_counts.get(key, 0) + 1

    return {
        "window": window,
        "range_label": range_label,
        "doctor_id": doctor_id,
        "buckets": [
            {
                "label": bucket_label(b),
                "date": str(b),
                "appointments": appt_counts.get(b, 0),
                "due_revisits": due_counts.get(b, 0),
            }
            for b in buckets
        ],
    }


# ── DOCTOR WORKLOAD — DRILL-DOWN DETAILS ─────────────────────────
#
# Backs clicking a bar segment in DoctorWorkloadChart: the chart above only returns per-
# bucket counts, this returns the actual rows behind one segment (one day for week/month
# buckets, a whole month for year buckets — the frontend passes whatever [date_from, date_to]
# the clicked bucket covers) so a doctor can see exact dates/times, not just a number.

@router.get("/analytics/doctor-workload/details")
def doctor_workload_details(
    date_from: date = Query(...),
    date_to: date = Query(...),
    item_type: str = Query(..., alias="type", pattern="^(appointments|due_revisits)$"),
    doctor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    if item_type == "appointments":
        q = (
            db.query(Appointment, Pet.name.label("pet_name"), PetOwner.name.label("owner_name"), Doctor.name.label("doctor_name"))
            .join(Pet, Pet.pet_id == Appointment.pet_id)
            .join(PetOwner, PetOwner.owner_id == Appointment.owner_id)
            .join(Doctor, Doctor.doctor_id == Appointment.doctor_id)
            .filter(
                Appointment.appt_date >= date_from,
                Appointment.appt_date <= date_to,
                Appointment.status.notin_(["Cancelled", "No-Show"]),
            )
        )
        if doctor_id:
            q = q.filter(Appointment.doctor_id == doctor_id)
        rows = q.order_by(Appointment.appt_date, Appointment.appt_time).all()
        return {
            "type": item_type,
            "items": [
                {
                    "date": str(a.appt_date),
                    "time": a.appt_time.strftime("%H:%M") if a.appt_time else None,
                    "pet_name": pet_name,
                    "owner_name": owner_name,
                    "doctor_name": doctor_name,
                    "kind": a.status,
                    "detail": a.reason,
                }
                for a, pet_name, owner_name, doctor_name in rows
            ],
        }

    # due_revisits — same two sources the bucket counts above are built from: pending/
    # notified vaccination reminders, plus consultation follow-up dates. Neither has a
    # time-of-day component in this app's schema (both are Date columns), so `time` is
    # always None for these — the frontend shows "—" rather than a fabricated time.
    from models.stage3 import Vaccine

    vac_q = (
        db.query(
            VaccinationReminder.due_date,
            Pet.name.label("pet_name"),
            PetOwner.name.label("owner_name"),
            Doctor.name.label("doctor_name"),
            Vaccine.vaccine_name,
        )
        .join(VaccinationRecord, VaccinationRecord.vacc_record_id == VaccinationReminder.vacc_record_id)
        .join(Vaccine, Vaccine.vaccine_id == VaccinationRecord.vaccine_id)
        .join(Pet, Pet.pet_id == VaccinationReminder.pet_id)
        .join(PetOwner, PetOwner.owner_id == VaccinationReminder.owner_id)
        .outerjoin(Doctor, Doctor.doctor_id == VaccinationRecord.doctor_id)
        .filter(
            VaccinationReminder.due_date >= date_from,
            VaccinationReminder.due_date <= date_to,
            VaccinationReminder.reminder_status.in_(["Pending", "Notified"]),
        )
    )
    if doctor_id:
        vac_q = vac_q.filter(VaccinationRecord.doctor_id == doctor_id)

    fu_q = (
        db.query(
            Consultation.followup_date,
            Pet.name.label("pet_name"),
            PetOwner.name.label("owner_name"),
            Doctor.name.label("doctor_name"),
            Consultation.followup_notes,
            Consultation.consult_no,
        )
        .join(Pet, Pet.pet_id == Consultation.pet_id)
        .join(PetOwner, PetOwner.owner_id == Consultation.owner_id)
        .join(Doctor, Doctor.doctor_id == Consultation.doctor_id)
        .filter(
            Consultation.followup_date.isnot(None),
            Consultation.followup_date >= date_from,
            Consultation.followup_date <= date_to,
        )
    )
    if doctor_id:
        fu_q = fu_q.filter(Consultation.doctor_id == doctor_id)

    items = []
    for due_date, pet_name, owner_name, doctor_name, vaccine_name in vac_q.all():
        items.append({
            "date": str(due_date),
            "time": None,
            "pet_name": pet_name,
            "owner_name": owner_name,
            "doctor_name": doctor_name,
            "kind": "Vaccination Due",
            "detail": vaccine_name,
        })
    for followup_date, pet_name, owner_name, doctor_name, followup_notes, consult_no in fu_q.all():
        items.append({
            "date": str(followup_date),
            "time": None,
            "pet_name": pet_name,
            "owner_name": owner_name,
            "doctor_name": doctor_name,
            "kind": "Scheduled Revisit",
            "detail": followup_notes or f"Follow-up for {consult_no}",
        })
    items.sort(key=lambda r: r["date"])

    return {"type": item_type, "items": items}
