import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Plus, Pencil, Trash2, RotateCcw, Users } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import FormModal from '../components/FormModal'
import AddressBlock from '../components/AddressBlock'

const EMPTY = {
  supplier_code: '', supplier_name: '', contact_person: '',
  phone: '', alt_phone: '', email: '',
  address1: '', address2: '', address3: '', 
  city_id: '', city_name: 'Hyderabad', district: '', state_name: 'Telangana', state_code: '36', pincode: '',
  gstin: '', pan: '', drug_license_no: '',
  payment_terms: '', opening_balance: 0, balance_type: 'CR'
}

export default function Suppliers() {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [cities, setCities] = useState([])
  const [includeInactive, setIncludeInactive] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const load = () => api.get('/inventory/suppliers', { params: { search, include_inactive: includeInactive } }).then(r => setData(r.data)).catch(() => {})
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
    if (!form.supplier_name) return toast.error('Supplier name is required')
    setSaving(true)
    const selectedCity = cities.find(c => c.city_name === form.city_name)
    const payload = {
      ...form,
      city_id: selectedCity ? selectedCity.city_id : (form.city_id || null),
      payment_terms: form.payment_terms ? parseInt(form.payment_terms) : null,
      opening_balance: parseFloat(form.opening_balance) || 0
    }
    try {
      if (editing) await api.put(`/inventory/suppliers/${editing.supplier_id}`, payload)
      else await api.post('/inventory/suppliers', payload)
      toast.success('Supplier saved!')
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error saving') }
    finally { setSaving(false) }
  }

  const handleDeactivate = async (row) => {
    if (!confirm(`Deactivate supplier "${row.supplier_name}"?`)) return
    try { await api.delete(`/inventory/suppliers/${row.supplier_id}`); toast.success('Deactivated'); load() }
    catch (err) { toast.error(err.response?.data?.detail || 'Error') }
  }

  const handleReactivate = async (row) => {
    if (!confirm(`Reactivate supplier "${row.supplier_name}"?`)) return
    try { await api.put(`/inventory/suppliers/${row.supplier_id}/reactivate`); toast.success('Reactivated!'); load() }
    catch (err) { toast.error(err.response?.data?.detail || 'Error') }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const cityMap = Object.fromEntries(cities.map(c => [c.city_id, c.city_name]))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary-100 rounded-lg"><Users size={18} className="text-primary-600" /></div>
            <div>
              <h2 className="font-bold text-slate-800">Supplier / Vendor Master</h2>
              <p className="text-xs text-slate-400">{data.length} suppliers</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-3.5 h-3.5 accent-primary-600" />
            Show Inactive
          </label>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={18} />Add Supplier</button>
      </div>

      <div className="card">
        <Table
          columns={[
            { key: 'supplier_code',  label: 'Code', width: 90 },
            { key: 'supplier_name',  label: 'Supplier Name' },
            { key: 'contact_person', label: 'Contact Person' },
            { key: 'phone',          label: 'Phone', width: 120 },
            { key: 'city_id',        label: 'City', render: v => cityMap[v] || '—' },
            { key: 'gstin',          label: 'GSTIN', width: 150 },
            { key: 'payment_terms',  label: 'Credit Days', render: v => v ? `${v}d` : '—' },
            { key: 'is_active',      label: 'Status', render: v => v
              ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span>
              : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Inactive</span> },
          ]}
          data={data}
          searchValue={search}
          onSearchChange={setSearch}
          actions={row => (
            <>
              {row.is_active !== false ? (
                <>
                  <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"><Pencil size={15} /></button>
                  <button onClick={() => handleDeactivate(row)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={15} /></button>
                </>
              ) : (
                <button onClick={() => handleReactivate(row)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Reactivate"><RotateCcw size={15} /></button>
              )}
            </>
          )}
        />
      </div>

      <FormModal isOpen={modal} onClose={() => setModal(false)} title={editing ? 'Edit Supplier' : 'Add New Supplier'} size="lg">
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
            {editing && <div><label className="label">Supplier Code</label><input className="input-field bg-slate-50 text-slate-400" value={form.supplier_code} readOnly /></div>}
            <div className={editing ? '' : 'md:col-span-2'}><label className="label">Supplier Name *</label><input className="input-field" value={form.supplier_name} onChange={set('supplier_name')} placeholder="e.g. Acme Pharma" autoFocus /></div>
            <div><label className="label">Contact Person</label><input className="input-field" value={form.contact_person} onChange={set('contact_person')} /></div>
            <div><label className="label">Phone</label><input className="input-field" value={form.phone} onChange={set('phone')} /></div>
            <div><label className="label">Alt Phone</label><input className="input-field" value={form.alt_phone} onChange={set('alt_phone')} /></div>
            <div className="md:col-span-2"><label className="label">Email</label><input className="input-field" type="email" value={form.email} onChange={set('email')} /></div>
          </div>

          <AddressBlock form={form} set={set} cities={cities} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 mt-4 border-t border-slate-100">
            <div><label className="label">Drug License No.</label><input className="input-field" value={form.drug_license_no || ''} onChange={set('drug_license_no')} placeholder="DL/TS/..." /></div>
            <div><label className="label">Credit Days (Payment Terms)</label><input className="input-field" type="number" value={form.payment_terms} onChange={set('payment_terms')} placeholder="30" /></div>

            <div className="md:col-span-2 border-t pt-3 mt-1">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Financial (Opening Balance)</h4>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Opening Balance (₹)</label><input className="input-field" type="number" step="0.01" value={form.opening_balance} onChange={set('opening_balance')} /></div>
                <div>
                  <label className="label">Balance Type</label>
                  <select className="input-field" value={form.balance_type} onChange={set('balance_type')}>
                    <option value="CR">CR — We owe supplier (Payable)</option>
                    <option value="DR">DR — Supplier owes us (Advance)</option>
                  </select>
                </div>
            </div>
          </div>
          </div>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Supplier'}</button>
          </div>
        </form>
      </FormModal>
    </div>
  )
}
