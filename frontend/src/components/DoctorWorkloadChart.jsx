import { useEffect, useState } from 'react'
import { CalendarClock, Stethoscope, Clock } from 'lucide-react'
import api from '../api'
import FormModal from './FormModal'
import { formatDisplayDate } from '../utils'

/**
 * DoctorWorkloadChart — Dashboard widget answering "how packed is this doctor" for the
 * current week, current month, or current financial year, backed by
 * GET /appointments/analytics/doctor-workload. Self-contained (own state + fetch), same
 * pattern as SpeciesVisitChart.
 *
 * Two stacked series per bar, color-coded:
 *   - Appointments (primary color)     — actually booked, non-cancelled appointments
 *   - Due / Revisits (amber)           — pending vaccination reminders + consultation
 *     follow-up dates: things expected but not yet a formal booking
 *
 * X-axis granularity follows the window: Week -> one bar per day (Mon-Sun), Month -> one
 * bar per calendar day, Year -> one bar per month of the current financial year. A doctor
 * picker (defaulting to "All Doctors") filters both series to one doctor's own load.
 */

const WINDOWS = [
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year' },
]

function niceMax(n) {
  if (n <= 5) return 5
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)))
  const residual = n / magnitude
  let niceResidual
  if (residual <= 1) niceResidual = 1
  else if (residual <= 2) niceResidual = 2
  else if (residual <= 5) niceResidual = 5
  else niceResidual = 10
  return niceResidual * magnitude
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function DoctorWorkloadChart() {
  const [window_, setWindow] = useState('week')
  const [refDate, setRefDate] = useState(todayIso())
  const [doctorId, setDoctorId] = useState('')
  const [doctors, setDoctors] = useState([])
  const [rangeLabel, setRangeLabel] = useState('')
  const [buckets, setBuckets] = useState([])
  const [loading, setLoading] = useState(true)
  // Drill-down modal opened by clicking a bar segment — { title, type, loading, items }
  const [details, setDetails] = useState(null)

  useEffect(() => {
    api.get('/doctors').then(r => setDoctors(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    api.get('/appointments/analytics/doctor-workload', {
      params: {
        window: window_,
        ...(window_ === 'year' ? {} : { ref_date: refDate }),
        ...(doctorId ? { doctor_id: doctorId } : {}),
      }
    })
      .then(r => {
        setBuckets(r.data.buckets || [])
        setRangeLabel(r.data.range_label || '')
      })
      .catch(() => { setBuckets([]); setRangeLabel('') })
      .finally(() => setLoading(false))
  }, [window_, refDate, doctorId])

  // Clicking a bar segment drills into the actual rows behind it. Week/Month buckets are
  // single days, so date_from === date_to; the Year window's buckets are whole months, so
  // date_to is computed as that month's last day.
  const openDetails = (bucket, type) => {
    const dateFrom = bucket.date
    let dateTo = bucket.date
    if (window_ === 'year') {
      const d = new Date(bucket.date)
      dateTo = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    }
    const title = `${type === 'appointments' ? 'Appointments' : 'Due / Revisits'} — ${bucket.label}`
    setDetails({ title, type, loading: true, items: [] })
    api.get('/appointments/analytics/doctor-workload/details', {
      params: {
        date_from: dateFrom,
        date_to: dateTo,
        type,
        ...(doctorId ? { doctor_id: doctorId } : {}),
      }
    })
      .then(r => setDetails(prev => (prev ? { ...prev, loading: false, items: r.data.items || [] } : prev)))
      .catch(() => setDetails(prev => (prev ? { ...prev, loading: false, items: [] } : prev)))
  }

  const max = niceMax(Math.max(1, ...buckets.map(b => b.appointments + b.due_revisits)))
  const ticks = [1, 0.75, 0.5, 0.25, 0].map(f => Math.round(max * f))
  const hasAnyData = buckets.some(b => b.appointments + b.due_revisits > 0)
  // Month view can have 28-31 bars — give each a minimum width and let the row scroll
  // horizontally rather than squeezing bars unreadably thin.
  const minBarColWidth = window_ === 'month' ? 34 : window_ === 'year' ? 64 : 56

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
            <CalendarClock size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Doctor Workload</h3>
            <p className="text-xs text-slate-400">{rangeLabel || 'How packed is each doctor'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Stethoscope size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              className="input-field !py-1.5 !text-xs !w-auto !pl-7"
              value={doctorId}
              onChange={e => setDoctorId(e.target.value)}
            >
              <option value="">All Doctors</option>
              {doctors.map(d => (
                <option key={d.doctor_id} value={d.doctor_id}>{d.name}</option>
              ))}
            </select>
          </div>

          {window_ !== 'year' && (
            <input
              type="date"
              className="input-field !py-1.5 !text-xs !w-auto"
              value={refDate}
              onChange={e => setRefDate(e.target.value)}
            />
          )}

          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            {WINDOWS.map(w => (
              <button
                key={w.key}
                onClick={() => setWindow(w.key)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  window_ === w.key
                    ? 'bg-white text-amber-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 mb-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm bg-primary-500" /> Appointments
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Due / Revisits (vaccination + follow-up)
        </span>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400 animate-pulse">
          Loading chart…
        </div>
      ) : !hasAnyData ? (
        <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400 gap-2">
          <CalendarClock size={28} className="opacity-30" />
          <p className="text-sm">No bookings or upcoming due-dates in this period.</p>
        </div>
      ) : (
        <div className="flex mt-3">
          {/* Y axis */}
          <div className="flex flex-col justify-between h-64 pr-3 text-[11px] text-slate-400 font-medium text-right shrink-0" style={{ width: '28px' }}>
            {ticks.map(t => <span key={t}>{t}</span>)}
          </div>

          {/* Bars (horizontally scrollable for month view) */}
          <div className="flex-1 overflow-x-auto">
            <div className="relative h-64 border-l border-b border-slate-200" style={{ minWidth: `${buckets.length * minBarColWidth}px` }}>
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {ticks.map(t => <div key={t} className="border-t border-slate-100 first:border-t-0" />)}
              </div>

              <div className="absolute inset-0 flex items-end justify-around px-2 gap-1">
                {buckets.map(b => {
                  const total = b.appointments + b.due_revisits
                  const totalPct = total > 0 ? Math.max((total / max) * 100, 3) : 0
                  const apptShare = total > 0 ? (b.appointments / total) * 100 : 0
                  return (
                    <div key={b.date} className="flex-1 flex flex-col items-center justify-end h-full group">
                      <div className="w-full rounded-t-md overflow-hidden flex flex-col justify-end" style={{ height: `${totalPct}%` }}>
                        {b.due_revisits > 0 && (
                          <div
                            className="w-full bg-amber-400 hover:bg-amber-500 transition-colors cursor-pointer"
                            style={{ height: `${100 - apptShare}%` }}
                            title={`${b.label}: ${b.due_revisits} due/revisit${b.due_revisits === 1 ? '' : 's'} — click for details`}
                            onClick={() => openDetails(b, 'due_revisits')}
                          />
                        )}
                        {b.appointments > 0 && (
                          <div
                            className="w-full bg-primary-500 hover:bg-primary-600 transition-colors cursor-pointer"
                            style={{ height: `${apptShare}%` }}
                            title={`${b.label}: ${b.appointments} appointment${b.appointments === 1 ? '' : 's'} — click for details`}
                            onClick={() => openDetails(b, 'appointments')}
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* X axis labels */}
            <div className="flex items-start justify-around px-2 gap-1 mt-1.5">
              {buckets.map(b => (
                <div key={b.date} className="flex-1 text-center">
                  <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Drill-down: exact dates/times behind whichever bar segment was clicked */}
      <FormModal isOpen={!!details} onClose={() => setDetails(null)} title={details?.title || ''} size="xl">
        {details?.loading ? (
          <div className="text-center py-10 text-sm text-slate-400">Loading…</div>
        ) : !details?.items?.length ? (
          <div className="text-center py-10 text-sm text-slate-400">No records found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="table-th">Date</th>
                  <th className="table-th">Time</th>
                  <th className="table-th">Pet</th>
                  <th className="table-th">Owner</th>
                  <th className="table-th">Doctor</th>
                  <th className="table-th">{details.type === 'appointments' ? 'Status' : 'Type'}</th>
                  <th className="table-th">{details.type === 'appointments' ? 'Reason' : 'Detail'}</th>
                </tr>
              </thead>
              <tbody>
                {details.items.map((it, i) => (
                  <tr key={i} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/70">
                    <td className="table-td">{formatDisplayDate(it.date)}</td>
                    <td className="table-td">
                      {it.time ? (
                        <span className="inline-flex items-center gap-1"><Clock size={12} className="text-slate-400" />{it.time}</span>
                      ) : '—'}
                    </td>
                    <td className="table-td">{it.pet_name || '—'}</td>
                    <td className="table-td">{it.owner_name || '—'}</td>
                    <td className="table-td">{it.doctor_name || '—'}</td>
                    <td className="table-td">
                      <span className="badge">{it.kind || '—'}</span>
                    </td>
                    <td className="table-td text-slate-500">{it.detail || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FormModal>
    </div>
  )
}
