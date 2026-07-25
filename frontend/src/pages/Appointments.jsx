import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { Plus, CalendarDays, CheckCircle, XCircle, Clock, UserCheck, RotateCcw, Edit } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import FormModal from '../components/FormModal'

const STATUS_COLORS = {
  Scheduled:        'bg-blue-100 text-blue-700',
  Arrived:          'bg-yellow-100 text-yellow-700',
  'In-Consultation': 'bg-purple-100 text-purple-700',
  Completed:        'bg-green-100 text-green-700',
  Cancelled:        'bg-red-100 text-red-600',
  'No-Show':        'bg-slate-100 text-slate-500',
}

const EMPTY = { appt_date: '', appt_time: '', pet_id: '', owner_id: '', doctor_id: '', reason: '', notes: '' }

export default function Appointments() {
  const navigate = useNavigate()
  const [data, setData]       = useState([])
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10))
  const [modal, setModal]     = useState(false)
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [pets, setPets]       = useState([])
  const [owners, setOwners]   = useState([])
  const [doctors, setDoctors] = useState([])
  const [slots, setSlots]     = useState([])

  const load = () =>
    api.get('/appointments', { params: { appt_date: date } })
      .then(r => setData(r.data)).catch(() => {})

  useEffect(() => { load() }, [date])

  useEffect(() => {
    api.get('/owners').then(r => setOwners(r.data)).catch(() => {})
    api.get('/pets').then(r => setPets(r.data)).catch(() => {})
    api.get('/doctors').then(r => setDoctors(r.data)).catch(() => {})
  }, [])

  // Load slots when doctor + date selected
  useEffect(() => {
    if (form.doctor_id && form.appt_date) {
      api.get(`/appointments/slots/${form.doctor_id}`, { params: { appt_date: form.appt_date } })
        .then(r => setSlots(r.data.slots || [])).catch(() => setSlots([]))
    }
  }, [form.doctor_id, form.appt_date])

  // Auto-fill owner when pet selected
  const handlePetChange = (e) => {
    const pid = parseInt(e.target.value)
    const pet = pets.find(p => p.pet_id === pid)
    setForm(f => ({ ...f, pet_id: e.target.value, owner_id: pet?.owner_id?.toString() || f.owner_id }))
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.pet_id || !form.doctor_id || !form.appt_date || !form.appt_time)
      return toast.error('Pet, Doctor, Date and Time are required')
    setSaving(true)
    try {
      if (form.appt_id) {
        await api.put(`/appointments/${form.appt_id}`, { 
          ...form, 
          pet_id: +form.pet_id, 
          owner_id: +form.owner_id, 
          doctor_id: +form.doctor_id 
        })
        toast.success('Appointment updated!')
      } else {
        await api.post('/appointments', { 
          ...form, 
          pet_id: +form.pet_id, 
          owner_id: +form.owner_id, 
          doctor_id: +form.doctor_id 
        })
        toast.success('Appointment booked!')
      }
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setSaving(false) }
  }

  const handleCheckin = async (appt_id) => {
    try { await api.put(`/appointments/${appt_id}/checkin`); toast.success('Checked in!'); load() }
    catch (err) { toast.error(err.response?.data?.detail || 'Error') }
  }

  const handleUndoCheckin = async (appt_id) => {
    try {
      await api.put(`/appointments/${appt_id}/undo-checkin`);
      toast.success('Check-in reversed!');
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
  }

  // Manual escape hatch: normally the appointment auto-completes when its linked
  // Consultation is closed, but if the consultation was started from
  // Consultations → New Consultation (instead of this row's "Open Consultation"
  // button) it's never linked back, so it can get stuck on Arrived/In-Consultation
  // forever with no other way to clear it.
  const handleComplete = async (appt_id) => {
    try {
      await api.put(`/appointments/${appt_id}/complete`)
      toast.success('Marked Completed!')
      load()
    } catch (err) {
      const detail = err.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Error')
    }
  }

  const handleEdit = (appt) => {
    setForm({
      ...appt,
      pet_id: appt.pet_id.toString(),
      owner_id: appt.owner_id.toString(),
      doctor_id: appt.doctor_id.toString(),
      appt_time: appt.appt_time.slice(0, 5)
    })
    setModal(true)
  }

  const handleCancel = async (appt_id) => {
    if (!confirm('Cancel this appointment?')) return
    try { await api.put(`/appointments/${appt_id}/cancel`); toast.success('Cancelled'); load() }
    catch { toast.error('Error') }
  }

  const ownerMap = Object.fromEntries(owners.map(o => [o.owner_id, o.name]))
  const petMap   = Object.fromEntries(pets.map(p => [p.pet_id, p.name]))
  const docMap   = Object.fromEntries(doctors.map(d => [d.doctor_id, d.name]))
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const stats = {
    total:     data.length,
    arrived:   data.filter(a => a.status === 'Arrived').length,
    completed: data.filter(a => a.status === 'Completed').length,
    pending:   data.filter(a => a.status === 'Scheduled').length,
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Appointments</h2>
          <p className="text-xs text-slate-400">{data.length} appointments on selected date</p>
        </div>
        <div className="flex items-center gap-3">
          <input type="date" className="input-field w-44"
            value={date} onChange={e => setDate(e.target.value)} />
          <button onClick={() => { setForm({ ...EMPTY, appt_date: date }); setModal(true) }}
            className="btn-primary flex items-center gap-2">
            <Plus size={16} /> Book Appointment
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total', value: stats.total,     color: 'text-slate-700', bg: 'bg-slate-50' },
          { label: 'Scheduled', value: stats.pending,  color: 'text-blue-600',  bg: 'bg-blue-50' },
          { label: 'Arrived',  value: stats.arrived,   color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { label: 'Completed', value: stats.completed, color: 'text-green-600', bg: 'bg-green-50' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 ${s.bg} border border-white`}>
            <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <Table
        columns={[
          { key: 'appt_no',   label: 'Appt No', width: 110 },
          { key: 'appt_time', label: 'Time', width: 80, render: v => String(v).slice(0,5) },
          { key: 'pet_id',    label: 'Pet',    render: v => petMap[v] || v },
          { key: 'owner_id',  label: 'Owner',  render: v => ownerMap[v] || v },
          { key: 'doctor_id', label: 'Doctor', render: v => docMap[v] ? `Dr. ${docMap[v]}` : v },
          { key: 'reason',    label: 'Reason' },
          { key: 'status',    label: 'Status', render: v => (
            <span className={`badge ${STATUS_COLORS[v] || 'bg-slate-100 text-slate-500'}`}>{v}</span>
          )},
        ]}
        data={data}
        emptyText="No appointments for this date. Click 'Book Appointment' to add one."
        actions={row => (
          <div className="flex items-center gap-1">
            {row.status === 'Scheduled' && (
              <button onClick={() => handleCheckin(row.appt_id)}
                className="p-1.5 text-slate-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors" title="Check-In">
                <UserCheck size={14} />
              </button>
            )}
            {row.status === 'Arrived' && (
              <button onClick={() => handleUndoCheckin(row.appt_id)}
                className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors" title="Undo Check-In">
                <RotateCcw size={14} />
              </button>
            )}
            {row.status === 'Arrived' && (
              <button onClick={() => navigate(`/consultations/new?appt_id=${row.appt_id}&pet_id=${row.pet_id}&owner_id=${row.owner_id}&doctor_id=${row.doctor_id}`)}
                className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Open Consultation">
                <CalendarDays size={14} />
              </button>
            )}
            {row.status === 'In-Consultation' && row.consult_id && (
              <button onClick={() => navigate(`/consultations/${row.consult_id}`)}
                className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors" title="View Consultation">
                <CalendarDays size={14} />
              </button>
            )}
            {['Arrived', 'In-Consultation'].includes(row.status) && (
              <button onClick={() => handleComplete(row.appt_id)}
                className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                title="Mark Completed (use if the consultation was started independently and never auto-completed this)">
                <CheckCircle size={14} />
              </button>
            )}
            {['Scheduled', 'Arrived'].includes(row.status) && (
              <button onClick={() => handleEdit(row)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit / Reschedule">
                <Edit size={14} />
              </button>
            )}
            {['Scheduled', 'Arrived'].includes(row.status) && (
              <button onClick={() => handleCancel(row.appt_id)}
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Cancel">
                <XCircle size={14} />
              </button>
            )}
          </div>
        )}
      />

      {/* Book Appointment Modal */}
      <FormModal isOpen={modal} onClose={() => setModal(false)} title="Book Appointment" size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Date *</label>
              <input className="input-field" type="date" value={form.appt_date} onChange={set('appt_date')} />
            </div>
            <div>
              <label className="label">Doctor *</label>
              <select className="input-field" value={form.doctor_id} onChange={set('doctor_id')}>
                <option value="">Select Doctor</option>
                {doctors.map(d => <option key={d.doctor_id} value={d.doctor_id}>Dr. {d.name}</option>)}
              </select>
            </div>
          </div>

          {/* Slots */}
          {slots.length > 0 && (
            <div>
              <label className="label">Available Slots</label>
              <div className="flex flex-wrap gap-2">
                {slots.map(s => (
                  <button key={s.time} type="button"
                    onClick={() => s.available && setForm(f => ({ ...f, appt_time: s.time }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      !s.available ? 'bg-red-50 text-red-400 border-red-100 cursor-not-allowed line-through' :
                      form.appt_time === s.time ? 'bg-primary-600 text-white border-primary-600' :
                      'bg-white text-slate-600 border-slate-200 hover:border-primary-400'
                    }`}>
                    {s.time}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="label">Time *</label>
            <input className="input-field" type="time" value={form.appt_time} onChange={set('appt_time')} />
          </div>

          <div>
            <label className="label">Pet *</label>
            <select className="input-field" value={form.pet_id} onChange={handlePetChange}>
              <option value="">Select Pet</option>
              {pets.map(p => <option key={p.pet_id} value={p.pet_id}>{p.name} ({ownerMap[p.owner_id] || ''})</option>)}
            </select>
          </div>

          <div>
            <label className="label">Reason for Visit</label>
            <input className="input-field" value={form.reason} onChange={set('reason')} placeholder="e.g. Vaccination, Checkup, Injury..." />
          </div>

          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : form.appt_id ? 'Update Appointment' : 'Book Appointment'}
            </button>
          </div>
        </form>
      </FormModal>
    </div>
  )
}
