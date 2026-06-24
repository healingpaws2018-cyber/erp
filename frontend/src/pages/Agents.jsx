import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Plus, Pencil, Trash2, RotateCcw, Handshake } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import FormModal from '../components/FormModal'
import AddressBlock from '../components/AddressBlock'

const COMMISSION_TYPES = ['Flat', 'Percent of Bill', 'Per Visit']

const EMPTY = {
  name: '', clinic_name: '', phone: '', alt_phone: '', email: '',
  address1: '', address2: '', address3: '', 
  city_id: '', city_name: 'Hyderabad', district: '', state_name: 'Telangana', state_code: '36', pincode: '',
  gstin: '', pan: '',
  commission_type: 'Flat', commission_rate: 0,
  opening_balance: 0, balance_type: 'CR', notes: ''
}

export default function Agents() {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [cities, setCities] = useState([])
  const [includeInactive, setIncludeInactive] = useState(false)

  const load = () => api.get('/agents', { params: { search, include_inactive: includeInactive } }).then(r => setData(r.data)).catch(() => {})
  useEffect(() => { load() }, [search, includeInactive])
  useEffect(() => { api.get('/masters/cities').then(r => setCities(r.data)).catch(() => {}) }, [])

  const openAdd = () => { setEditing(null); setForm(EMPTY); setModal(true) }
  const openEdit = (row) => {
    setEditing(row)
    setForm({
      ...EMPTY,
      ...row,
      city_name: cities.find(c => c.city_id === row.city_id)?.city_name || ''
    })
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name) return toast.error('Agent name is required')
    setSaving(true)
    const selectedCity = cities.find(c => c.city_name === form.city_name)
    const payload = {
      ...form,
      city_id: selectedCity ? selectedCity.city_id : (form.city_id || null),
      commission_rate: form.commission_rate ? parseFloat(form.commission_rate) : 0,
      opening_balance: form.opening_balance ? parseFloat(form.opening_balance) : 0,
    }
    try {
      if (editing) await api.put(`/agents/${editing.agent_id}`, payload)
      else await api.post('/agents', payload)
      toast.success(editing ? 'Agent updated!' : 'Agent added!')
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (row) => {
    if (!confirm(`Deactivate agent "${row.name}"?`)) return
    try { await api.delete(`/agents/${row.agent_id}`); toast.success('Deactivated'); load() } catch { toast.error('Error') }
  }

  const handleReactivate = async (row) => {
    if (!confirm(`Reactivate agent "${row.name}"?`)) return
    try { await api.put(`/agents/${row.agent_id}/reactivate`); toast.success('Reactivated'); load() } catch { toast.error('Error') }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const commissionLabel = form.commission_type === 'Percent of Bill' ? 'Commission %' : 'Commission (₹)'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary-100 rounded-lg"><Handshake size={18} className="text-primary-600" /></div>
            <div>
              <h2 className="font-bold text-slate-800">Referral Agents</h2>
              <p className="text-xs text-slate-400">{data.length} agents</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-3.5 h-3.5 accent-primary-600" />
            Show Inactive
          </label>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={16} />Add Agent</button>
      </div>

      <div className="card">
        <Table
          columns={[
            { key: 'agent_code',      label: 'Code', width: 90 },
            { key: 'name',            label: 'Agent Name' },
            { key: 'clinic_name',     label: 'Clinic / Hospital' },
            { key: 'phone',           label: 'Phone' },
            { key: 'commission_type', label: 'Commission Type' },
            { key: 'commission_rate', label: 'Rate', render: (v, row) => row.commission_type === 'Percent of Bill' ? `${v}%` : `₹${v}` },
            { key: 'city_name',       label: 'City' },
            { key: 'is_active',       label: 'Status', render: v => v
              ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span>
              : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Inactive</span> },
          ]}
          data={data}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by name, code, phone..."
          actions={(row) => (
            <>
              {row.is_active ? (
                <>
                  <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"><Pencil size={14} /></button>
                  <button onClick={() => handleDelete(row)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                </>
              ) : (
                <button onClick={() => handleReactivate(row)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Reactivate"><RotateCcw size={14} /></button>
              )}
            </>
          )}
          emptyText="No agents registered."
        />
      </div>

      <FormModal isOpen={modal} onClose={() => setModal(false)} title={editing ? 'Edit Referral Agent' : 'Add Referral Agent'} size="lg">
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
            <div className="md:col-span-2"><label className="label">Agent Name *</label><input className="input-field" value={form.name} onChange={set('name')} placeholder="Dr. Ravi Kumar" autoFocus /></div>
            <div className="md:col-span-2"><label className="label">Clinic / Hospital Name</label><input className="input-field" value={form.clinic_name} onChange={set('clinic_name')} placeholder="Animal Care Clinic" /></div>
            <div><label className="label">Phone</label><input className="input-field" value={form.phone} onChange={set('phone')} placeholder="9876543210" /></div>
            <div><label className="label">Alt Phone</label><input className="input-field" value={form.alt_phone} onChange={set('alt_phone')} /></div>
            <div className="md:col-span-2"><label className="label">Email</label><input className="input-field" type="email" value={form.email} onChange={set('email')} /></div>
          </div>

          <AddressBlock form={form} set={set} cities={cities} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 mt-4 border-t border-slate-100">
            <div className="md:col-span-2">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Commission Configuration</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Commission Type</label>
                  <select className="input-field" value={form.commission_type} onChange={set('commission_type')}>
                    {COMMISSION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{commissionLabel}</label>
                  <input className="input-field" type="number" step="0.01" value={form.commission_rate} onChange={set('commission_rate')} placeholder="0" />
                </div>
              </div>
            </div>

            <div className="md:col-span-2 border-t pt-3 mt-1">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Financial (Opening Balance)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Opening Balance (₹)</label><input className="input-field" type="number" value={form.opening_balance} onChange={set('opening_balance')} /></div>
                <div>
                  <label className="label">Balance Type</label>
                  <select className="input-field" value={form.balance_type} onChange={set('balance_type')}>
                    <option value="CR">CR — We owe agent (Payable)</option>
                    <option value="DR">DR — Agent owes us (Advance)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="md:col-span-2"><label className="label">Notes</label><input className="input-field" value={form.notes} onChange={set('notes')} /></div>
          </div>
          </div>
          <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update Agent' : 'Add Agent'}</button>
          </div>
        </form>
      </FormModal>
    </div>
  )
}
