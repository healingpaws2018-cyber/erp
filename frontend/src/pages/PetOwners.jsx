import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { Plus, Pencil, Trash2, Phone, Mail, RotateCcw, PawPrint, Eye } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import FormModal from '../components/FormModal'
import AddressBlock from '../components/AddressBlock'

const EMPTY = {
  name: '', address1: '', address2: '', address3: '', city_id: '', city_name: 'Hyderabad',
  district: '', state_name: 'Telangana', state_code: '36', pincode: '',
  phone: '', alt_phone: '', email: '', gstin: '', pan: '', notes: '',
  opening_balance: 0, balance_type: 'DR', agent_id: '', discount_pct: 0
}

export default function PetOwners() {
  const navigate = useNavigate()
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [cities, setCities] = useState([])
  const [includeInactive, setIncludeInactive] = useState(false)
  const [viewPets, setViewPets] = useState(null)
  const [agents, setAgents] = useState([])

  const load = () => api.get('/owners', { params: { search, include_inactive: includeInactive } }).then(r => setData(r.data)).catch(() => {})
  useEffect(() => { load() }, [search, includeInactive])
  useEffect(() => { 
    api.get('/masters/cities').then(r => setCities(r.data)).catch(() => {})
    api.get('/agents').then(r => setAgents(r.data)).catch(() => {})
  }, [])

  const openAdd = () => { setEditing(null); setForm(EMPTY); setModal(true) }
  const openEdit = (row) => {
    setEditing(row)
    setForm({ 
      ...EMPTY, 
      ...row,
      agent_id: row.agent_id || '' 
    })
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.name || !form.phone) return toast.error('Name and phone are required')
    setSaving(true)
    const selectedCity = cities.find(c => c.city_name === form.city_name)
    const payload = { 
      ...form, 
      city_id: selectedCity ? selectedCity.city_id : null,
      agent_id: form.agent_id ? parseInt(form.agent_id) : null,
      opening_balance: parseFloat(form.opening_balance) || 0,
      discount_pct: parseFloat(form.discount_pct) || 0
    }
    try {
      if (editing) await api.put(`/owners/${editing.owner_id}`, payload)
      else await api.post('/owners', payload)
      toast.success(editing ? 'Owner updated!' : 'Owner added!')
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setSaving(false) }
  }

  const handleDelete = async (row) => {
    if (!confirm(`Deactivate owner "${row.name}"?`)) return
    try { await api.delete(`/owners/${row.owner_id}`); toast.success('Deactivated'); load() }
    catch { toast.error('Error deactivating') }
  }

  const handleReactivate = async (row) => {
    if (!confirm(`Reactivate owner "${row.name}"?`)) return
    try { await api.put(`/owners/${row.owner_id}/reactivate`); toast.success('Reactivated'); load() }
    catch { toast.error('Error reactivating') }
  }

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="font-bold text-slate-800">Pet Owners</h2>
            <p className="text-xs text-slate-400">{data.length} records found</p>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-3.5 h-3.5 accent-primary-600" />
            Show Inactive
          </label>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Add Owner
        </button>
      </div>

      <Table
        columns={[
          { key: 'owner_code', label: 'Code', width: 100 },
          { key: 'name', label: 'Name' },
          { key: 'phone', label: 'Phone', render: (v) => (
            <span className="flex items-center gap-1.5 text-slate-600">
              <Phone size={13} className="text-slate-400" />{v}
            </span>
          )},
          { key: 'agent_name', label: 'Referred By', render: v => v || <span className="text-slate-300">—</span> },
          { key: 'city_name', label: 'City' },
          { key: 'pets', label: 'Pets', render: (v, row) => (
            <div className="flex items-center gap-2">
              {v && v.length > 0 ? (
                <div className="flex flex-wrap gap-1 max-w-[150px]">
                  {v.slice(0, 2).map(p => (
                    <span key={p.pet_id} className="text-[10px] bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded border border-primary-100 font-bold">
                      {p.pet_code}
                    </span>
                  ))}
                  {v.length > 2 && <span className="text-[10px] text-slate-400">+{v.length - 2} more</span>}
                </div>
              ) : <span className="text-slate-300 text-xs">No pets</span>}
              {row.pet_count > 0 && (
                <button onClick={() => setViewPets(row)} className="p-1 text-primary-600 hover:bg-primary-100 rounded" title="View Detail">
                  <Eye size={12} />
                </button>
              )}
            </div>
          )},
          { key: 'is_active', label: 'Status', render: (v) => v ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span> : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Inactive</span> },
        ]}
        data={data}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or phone..."
        actions={(row) => (
          <>
            {row.is_active ? (
              <>
                <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Edit"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(row)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Deactivate"><Trash2 size={14} /></button>
              </>
            ) : (
              <button onClick={() => handleReactivate(row)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Reactivate"><RotateCcw size={14} /></button>
            )}
          </>
        )}
        emptyText="No pet owners found. Click 'Add Owner' to register one."
      />

      <FormModal isOpen={modal} onClose={() => setModal(false)} title={editing ? 'Edit Pet Owner' : 'Add Pet Owner'} size="lg">
        <form onSubmit={handleSave}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
            <div className="md:col-span-2"><label className="label">Full Name *</label><input className="input-field" value={form.name} onChange={set('name')} placeholder="Owner's full name" autoFocus /></div>
            <div><label className="label">Phone *</label><input className="input-field" value={form.phone} onChange={set('phone')} placeholder="9876543210" /></div>
            <div><label className="label">Alternate Phone</label><input className="input-field" value={form.alt_phone} onChange={set('alt_phone')} placeholder="Optional" /></div>
            <div><label className="label">Email</label><input className="input-field" type="email" value={form.email} onChange={set('email')} placeholder="email@example.com" /></div>
            <div><label className="label">Referred By (Agent)</label>
              <select className="input-field" value={form.agent_id} onChange={set('agent_id')}>
                <option value="">No Agent / Indirect</option>
                {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.name} ({a.agent_code})</option>)}
              </select>
            </div>
          </div>

          <AddressBlock form={form} set={set} cities={cities} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 mt-4 border-t border-slate-100">
            <div className="md:col-span-2"><label className="label">Notes</label><input className="input-field" value={form.notes} onChange={set('notes')} placeholder="Any special notes" /></div>
            
            {/* Financial Info Section */}
            <div className="md:col-span-2 pt-2 mt-2 border-t border-slate-100">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Financial Information</h4>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Opening Balance (₹)</label>
                  <input className="input-field" type="number" step="0.01" value={form.opening_balance} onChange={set('opening_balance')} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">Balance Type</label>
                  <select className="input-field" value={form.balance_type} onChange={set('balance_type')}>
                    <option value="DR">Debit (Owes Clinic)</option>
                    <option value="CR">Credit (Advance Paid)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Sales Discount (%)</label>
                  <input className="input-field" type="number" step="0.1" value={form.discount_pct} onChange={set('discount_pct')} placeholder="0.0" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-4 mt-4 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update Owner' : 'Add Owner'}</button>
          </div>
        </form>
      </FormModal>
      <FormModal isOpen={!!viewPets} onClose={() => setViewPets(null)} title={`Pets for ${viewPets?.name}`} size="md">
        <div className="space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Linked Records</h4>
            <button 
              onClick={() => navigate('/pets', { state: { preselectOwnerId: viewPets.owner_id } })}
              className="text-primary-600 hover:text-primary-700 text-xs font-bold flex items-center gap-1 bg-primary-50 px-2 py-1 rounded"
            >
              <Plus size={12} /> Register New Pet
            </button>
          </div>
          <div className="grid gap-3 max-h-[400px] overflow-y-auto pr-1">
            {viewPets?.pets?.map((pet) => (
              <div key={pet.pet_id} className="group p-4 bg-white rounded-xl border border-slate-100 hover:border-primary-200 hover:shadow-sm transition-all flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-50 rounded-lg group-hover:bg-primary-50 transition-colors">
                    <PawPrint size={18} className="text-slate-400 group-hover:text-primary-500" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-primary-600 mb-0.5">{pet.pet_code}</div>
                    <div className="text-sm font-bold text-slate-800">{pet.name}</div>
                  </div>
                </div>
                <button 
                  onClick={() => navigate('/pets', { state: { editPetId: pet.pet_id } })}
                  className="p-2 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors border border-transparent hover:border-primary-100"
                  title="Edit in Pet Masters"
                >
                  <Pencil size={14} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => setViewPets(null)} className="btn-secondary w-full mt-2">Close</button>
        </div>
      </FormModal>
    </div>
  )
}
