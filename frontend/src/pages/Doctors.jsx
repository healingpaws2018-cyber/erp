import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Plus, Pencil, Trash2, RotateCcw, Clock } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import FormModal from '../components/FormModal'
import AddressBlock from '../components/AddressBlock'
import WorkScheduleModal from '../components/WorkScheduleModal'

const EMPTY_DOC = {
  name: '', qualification: '', specialization: '', reg_number: '',
  phone: '', alt_phone: '', email: '', 
  address1: '', address2: '', address3: '', 
  city_id: '', city_name: 'Hyderabad', district: '', state_name: 'Telangana', state_code: '36', pincode: '',
  pan: '', consultation_fee: '',
  follow_up_fee: '', emergency_fee: '', available_days: '', notes: '',
  doj: '', salary: '', salary_type: 'Fixed', opening_balance: 0, balance_type: 'CR'
}

const EMPTY_STAFF = {
  name: '', role: '', phone: '', alt_phone: '', email: '',
  address1: '', address2: '', address3: '', 
  city_id: '', city_name: 'Hyderabad', district: '', state_name: 'Telangana', state_code: '36', pincode: '',
  pan: '', doj: '', salary: '', notes: '',
  opening_balance: 0, balance_type: 'CR'
}

const STAFF_ROLES = ['Receptionist', 'Nurse', 'Pharmacist', 'Lab Tech', 'Admin', 'Cleaner']

// ─── DOCTORS TAB ─────────────────────────────────────────────
function DoctorsTab({ cities }) {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_DOC)
  const [saving, setSaving] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [scheduleModal, setScheduleModal] = useState({ open: false, doctorId: null, doctorName: '' })

  const load = () => api.get('/doctors', { params: { search, include_inactive: includeInactive } }).then(r => setData(r.data)).catch(() => {})
  useEffect(() => { load() }, [search, includeInactive])

  const openAdd = () => { setEditing(null); setForm(EMPTY_DOC); setModal(true) }
  const openEdit = (row) => {
    setEditing(row)
    setForm({
      ...EMPTY_DOC,
      ...row,
      city_name: cities.find(c => c.city_id === row.city_id)?.city_name || ''
    })
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name) return toast.error('Doctor name is required')
    setSaving(true)
    const selectedCity = cities.find(c => c.city_name === form.city_name)
    const payload = {
      ...form,
      city_id: selectedCity ? selectedCity.city_id : (form.city_id || null),
      consultation_fee: form.consultation_fee ? parseFloat(form.consultation_fee) : 0,
      follow_up_fee:    form.follow_up_fee    ? parseFloat(form.follow_up_fee)    : 0,
      emergency_fee:    form.emergency_fee    ? parseFloat(form.emergency_fee)    : 0,
      salary:           form.salary           ? parseFloat(form.salary)           : 0,
      opening_balance:  form.opening_balance  ? parseFloat(form.opening_balance)  : 0,
      doj:              form.doj || null,
    }
    try {
      if (editing) await api.put(`/doctors/${editing.doctor_id}`, payload)
      else await api.post('/doctors', payload)
      toast.success(editing ? 'Doctor updated!' : 'Doctor added!')
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (row) => {
    if (!confirm(`Deactivate Dr. ${row.name}?`)) return
    try { await api.delete(`/doctors/${row.doctor_id}`); toast.success('Deactivated'); load() } catch { toast.error('Error') }
  }

  const handleReactivate = async (row) => {
    if (!confirm(`Reactivate Dr. ${row.name}?`)) return
    try { await api.put(`/doctors/${row.doctor_id}/reactivate`); toast.success('Reactivated'); load() } catch { toast.error('Error') }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold text-slate-700">Doctors / Vets <span className="text-slate-400 font-normal text-sm">({data.length})</span></h3>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-3.5 h-3.5 accent-primary-600" />
            Show Inactive
          </label>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm"><Plus size={15} />Add Doctor</button>
      </div>
      <Table
        columns={[
          { key: 'doctor_code', label: 'Code', width: 90 },
          { key: 'name', label: 'Name' },
          { key: 'qualification', label: 'Qualification' },
          { key: 'specialization', label: 'Specialization' },
          { key: 'phone', label: 'Phone' },
          { key: 'consultation_fee', label: 'Consult Fee', render: v => v ? `₹${Number(v).toLocaleString()}` : '—' },
          { key: 'is_active', label: 'Status', render: (v) => v ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span> : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Inactive</span> },
        ]}
        data={data}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search doctors..."
        actions={(row) => (
          <>
            {row.is_active ? (
              <>
                <button onClick={() => setScheduleModal({ open: true, doctorId: row.doctor_id, doctorName: row.name })} 
                  className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" 
                  title="Work Schedule">
                  <Clock size={14} />
                </button>
                <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(row)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
              </>
            ) : (
              <button onClick={() => handleReactivate(row)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"><RotateCcw size={14} /></button>
            )}
          </>
        )}
        emptyText="No doctors registered."
      />
      <FormModal isOpen={modal} onClose={() => setModal(false)} title={editing ? 'Edit Doctor' : 'Add Doctor'} size="lg">
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
            <div className="md:col-span-2"><label className="label">Full Name *</label><input className="input-field" value={form.name} onChange={set('name')} placeholder="Dr. First Last" autoFocus /></div>
            <div><label className="label">Qualification</label><input className="input-field" value={form.qualification} onChange={set('qualification')} placeholder="BVSc & AH, MVSc" /></div>
            <div><label className="label">Specialization</label><input className="input-field" value={form.specialization} onChange={set('specialization')} placeholder="Small Animals, Surgery..." /></div>
            <div><label className="label">Vet Council Reg. No.</label><input className="input-field" value={form.reg_number} onChange={set('reg_number')} placeholder="VCI/TS/..." /></div>
            <div><label className="label">Phone</label><input className="input-field" value={form.phone} onChange={set('phone')} placeholder="9876543210" /></div>
            <div><label className="label">Alternate Phone</label><input className="input-field" value={form.alt_phone} onChange={set('alt_phone')} /></div>
            <div className="md:col-span-2"><label className="label">Email</label><input className="input-field" type="email" value={form.email} onChange={set('email')} /></div>
          </div>

          <AddressBlock form={form} set={set} cities={cities} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 mt-4 border-t border-slate-100">
            <div><label className="label">Consultation Fee (₹)</label><input className="input-field" type="number" step="0.01" value={form.consultation_fee} onChange={set('consultation_fee')} placeholder="500" /></div>
            <div><label className="label">Follow-up Fee (₹)</label><input className="input-field" type="number" step="0.01" value={form.follow_up_fee} onChange={set('follow_up_fee')} placeholder="300" /></div>
            <div><label className="label">Emergency Fee (₹)</label><input className="input-field" type="number" step="0.01" value={form.emergency_fee} onChange={set('emergency_fee')} placeholder="800" /></div>
            <div><label className="label">Available Days</label><input className="input-field" value={form.available_days} onChange={set('available_days')} placeholder="Mon,Tue,Wed,Thu,Fri" /></div>
            
            <div className="md:col-span-2 border-t pt-2 mt-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">HR & Financial Information</h4>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">Joining Date</label><input className="input-field" type="date" value={form.doj} onChange={set('doj')} /></div>
                <div><label className="label">Salary (₹)</label><input className="input-field" type="number" value={form.salary} onChange={set('salary')} /></div>
                <div>
                  <label className="label">Salary Type</label>
                  <select className="input-field" value={form.salary_type} onChange={set('salary_type')}>
                    <option value="Fixed">Fixed</option>
                    <option value="Per Consultation">Per Consultation</option>
                    <option value="Revenue Share">Revenue Share</option>
                  </select>
                </div>
                <div><label className="label">Opening Balance (₹)</label><input className="input-field" type="number" value={form.opening_balance} onChange={set('opening_balance')} /></div>
                <div>
                  <label className="label">Balance Type</label>
                  <select className="input-field" value={form.balance_type} onChange={set('balance_type')}>
                    <option value="CR">Clinic Owes Doctor (Payable)</option>
                    <option value="DR">Doctor Owes Clinic (Advance)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="md:col-span-2"><label className="label">Notes</label><input className="input-field" value={form.notes} onChange={set('notes')} /></div>
          </div>
          </div>
          <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update' : 'Add Doctor'}</button>
          </div>
        </form>
      </FormModal>
      <WorkScheduleModal 
        isOpen={scheduleModal.open} 
        onClose={() => setScheduleModal({ ...scheduleModal, open: false })}
        doctorId={scheduleModal.doctorId}
        doctorName={scheduleModal.doctorName}
      />
    </>
  )
}

// ─── STAFF TAB ───────────────────────────────────────────────
function StaffTab({ cities }) {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_STAFF)
  const [saving, setSaving] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)

  const load = () => api.get('/staff', { params: { search, include_inactive: includeInactive } }).then(r => setData(r.data)).catch(() => {})
  useEffect(() => { load() }, [search, includeInactive])

  const openAdd = () => { setEditing(null); setForm(EMPTY_STAFF); setModal(true) }
  const openEdit = (row) => {
    setEditing(row)
    setForm({
      ...EMPTY_STAFF,
      ...row,
      city_name: cities.find(c => c.city_id === row.city_id)?.city_name || ''
    })
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name) return toast.error('Name is required')
    setSaving(true)
    const selectedCity = cities.find(c => c.city_name === form.city_name)
    const payload = { 
      ...form, 
      city_id: selectedCity ? selectedCity.city_id : (form.city_id || null),
      salary: form.salary ? parseFloat(form.salary) : 0,
      opening_balance: form.opening_balance ? parseFloat(form.opening_balance) : 0,
      doj: form.doj || null
    }
    try {
      if (editing) await api.put(`/staff/${editing.staff_id}`, payload)
      else await api.post('/staff', payload)
      toast.success('Saved!'); setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setSaving(false) }
  }
  const handleDelete = async (row) => {
    if (!confirm(`Deactivate staff "${row.name}"?`)) return
    try { await api.delete(`/staff/${row.staff_id}`); toast.success('Deactivated'); load() } catch { toast.error('Error') }
  }

  const handleReactivate = async (row) => {
    if (!confirm(`Reactivate staff "${row.name}"?`)) return
    try { await api.put(`/staff/${row.staff_id}/reactivate`); toast.success('Reactivated'); load() } catch { toast.error('Error') }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <h3 className="font-semibold text-slate-700">Staff Members <span className="text-slate-400 font-normal text-sm">({data.length})</span></h3>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-3.5 h-3.5 accent-primary-600" />
            Show Inactive
          </label>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm"><Plus size={15} />Add Staff</button>
      </div>
      <Table
        columns={[
          { key: 'staff_code', label: 'Code', width: 90 },
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role', render: v => v ? <span className="badge bg-slate-100 text-slate-600">{v}</span> : '—' },
          { key: 'phone', label: 'Phone' },
          { key: 'doj', label: 'Joined On' },
          { key: 'is_active', label: 'Status', render: (v) => v ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span> : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Inactive</span> },
        ]}
        data={data}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search staff..."
        actions={(row) => (
          <>
            {row.is_active ? (
              <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"><Pencil size={14} /></button>
            ) : (
                <button onClick={() => handleReactivate(row)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Reactivate"><RotateCcw size={14} /></button>
            )}
            <button onClick={() => handleDelete(row)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
          </>
        )}
        emptyText="No staff added."
      />
      <FormModal isOpen={modal} onClose={() => setModal(false)} title={editing ? 'Edit Staff' : 'Add Staff'} size="lg">
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
            <div className="md:col-span-2"><label className="label">Full Name *</label><input className="input-field" value={form.name} onChange={set('name')} placeholder="Staff name" autoFocus /></div>
            <div>
              <label className="label">Role</label>
              <select className="input-field" value={form.role} onChange={set('role')}>
                <option value="">Select Role</option>
                {STAFF_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div><label className="label">Phone</label><input className="input-field" value={form.phone} onChange={set('phone')} placeholder="9876543210" /></div>
            <div><label className="label">Alternate Phone</label><input className="input-field" value={form.alt_phone} onChange={set('alt_phone')} /></div>
            <div className="md:col-span-2"><label className="label">Email</label><input className="input-field" value={form.email} onChange={set('email')} /></div>
          </div>

          <AddressBlock form={form} set={set} cities={cities} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 mt-4 border-t border-slate-100">
            <div><label className="label">Date of Joining</label><input className="input-field" type="date" value={form.doj} onChange={set('doj')} /></div>
            <div><label className="label">Salary (₹)</label><input className="input-field" type="number" value={form.salary} onChange={set('salary')} /></div>
            <div className="md:col-span-2 border-t pt-2 mt-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Financial Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Opening Balance (₹)</label><input className="input-field" type="number" value={form.opening_balance} onChange={set('opening_balance')} /></div>
                <div>
                  <label className="label">Balance Type</label>
                  <select className="input-field" value={form.balance_type} onChange={set('balance_type')}>
                    <option value="CR">Clinic Owes Staff (Payable)</option>
                    <option value="DR">Staff Owes Clinic (Advance)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="md:col-span-2"><label className="label">Notes</label><input className="input-field" value={form.notes} onChange={set('notes')} /></div>
          </div>
          </div>
          <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update' : 'Add Staff'}</button>
          </div>
        </form>
      </FormModal>
    </>
  )
}

// ─── DOCTORS PAGE ─────────────────────────────────────────────
export default function Doctors() {
  const [tab, setTab] = useState('Doctors')
  const [cities, setCities] = useState([])

  useEffect(() => {
    api.get('/masters/cities').then(r => setCities(r.data)).catch(() => {})
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {['Doctors', 'Staff'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${tab === t ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="card">
        {tab === 'Doctors' && <DoctorsTab cities={cities} />}
        {tab === 'Staff'   && <StaffTab cities={cities} />}
      </div>
    </div>
  )
}
