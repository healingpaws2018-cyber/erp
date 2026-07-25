import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Plus, Pencil, Trash2, RotateCcw, UserCog, KeyRound, ShieldCheck } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import FormModal from '../components/FormModal'

const ROLES = ['admin', 'doctor', 'receptionist', 'pharmacist', 'accountant', 'staff']

// Same 7 module codes the backend already uses (routes/users.py PERMISSION_MODULES,
// shared with routes/companies.py's Manage Roles screen) — friendly labels for display only.
const PERMISSION_MODULES = [
  { code: 'Clinic',   label: 'Clinic & Appointments' },
  { code: 'Masters',  label: 'Masters Data' },
  { code: 'Billing',  label: 'Billing & Sales' },
  { code: 'Pharmacy', label: 'Pharmacy' },
  { code: 'Inventory', label: 'Inventory' },
  { code: 'Reports',  label: 'Reports & Accounts' },
  { code: 'Users',    label: 'User Management' },
]
const PERM_FIELDS = [
  { key: 'can_view',   label: 'View' },
  { key: 'can_create', label: 'Create' },
  { key: 'can_edit',   label: 'Edit' },
  { key: 'can_delete', label: 'Delete' },
]

const EMPTY = {
  username: '', full_name: '', role: 'staff',
  email: '', phone: '', password: '',
  linked_doctor_id: '', linked_staff_id: ''
}

export default function Users() {
  const [data, setData] = useState([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [pwdModal, setPwdModal] = useState(null)   // user object for password reset
  const [newPwd, setNewPwd] = useState('')
  const [doctors, setDoctors] = useState([])
  const [staffList, setStaffList] = useState([])

  const [permModal, setPermModal] = useState(null) // user object for the permissions modal
  const [permData, setPermData] = useState([])      // [{module_code, can_view, can_create, can_edit, can_delete, can_export}]
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)

  const load = () => api.get('/users', { params: { include_inactive: includeInactive } }).then(r => setData(r.data)).catch(() => {})
  useEffect(() => { load() }, [includeInactive])
  useEffect(() => {
    api.get('/doctors').then(r => setDoctors(r.data)).catch(() => {})
    api.get('/staff').then(r => setStaffList(r.data)).catch(() => {})
  }, [])

  const openAdd = () => { setEditing(null); setForm(EMPTY); setModal(true) }
  const openEdit = (row) => {
    setEditing(row)
    setForm({
      username: row.username, full_name: row.full_name, role: row.role,
      email: row.email || '', phone: row.phone || '', password: '',
      linked_doctor_id: row.linked_doctor_id || '',
      linked_staff_id: row.linked_staff_id || ''
    })
    setModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.username || !form.full_name) return toast.error('Username and Full Name are required')
    if (!editing && !form.password) return toast.error('Password is required for new users')
    setSaving(true)
    const payload = {
      username: form.username, full_name: form.full_name, role: form.role,
      email: form.email || null, phone: form.phone || null,
      linked_doctor_id: form.linked_doctor_id ? parseInt(form.linked_doctor_id) : null,
      linked_staff_id: form.linked_staff_id ? parseInt(form.linked_staff_id) : null,
    }
    if (!editing) payload.password = form.password
    try {
      if (editing) await api.put(`/users/${editing.user_id}`, payload)
      else await api.post('/users', payload)
      toast.success(editing ? 'User updated!' : 'User created!')
      setModal(false); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setSaving(false) }
  }

  const handleDeactivate = async (row) => {
    if (!confirm(`Deactivate user "${row.username}"?`)) return
    try { await api.put(`/users/${row.user_id}/deactivate`); toast.success('Deactivated'); load() } catch { toast.error('Error') }
  }

  const handleReactivate = async (row) => {
    if (!confirm(`Reactivate user "${row.username}"?`)) return
    try { await api.put(`/users/${row.user_id}/reactivate`); toast.success('Reactivated'); load() } catch { toast.error('Error') }
  }

  const handlePasswordReset = async () => {
    if (!newPwd || newPwd.length < 6) return toast.error('Password must be at least 6 characters')
    try {
      await api.put(`/users/${pwdModal.user_id}/reset-password`, { new_password: newPwd })
      toast.success(`Password reset for ${pwdModal.username}`)
      setPwdModal(null); setNewPwd('')
    } catch { toast.error('Error resetting password') }
  }

  // ── Module / CRUD Permissions ────────────────────────────────
  // NOTE: this saves the permission set correctly, but nothing in the app enforces it yet
  // (no backend route checks it, the sidebar doesn't filter on it) — same as the existing
  // Company Profiles > Manage Roles screen. It's configuration for now, not a restriction.
  // Permissions are scoped to the current company implicitly (the backend resolves the
  // right company database from your login token the same way every other page does —
  // no company_id needs to be sent from here).
  const openPermissions = async (row) => {
    setPermModal(row)
    setPermLoading(true)
    try {
      const res = await api.get(`/users/${row.user_id}/permissions`)
      setPermData(res.data.modules || [])
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load permissions')
      setPermData(PERMISSION_MODULES.map(m => ({ module_code: m.code, can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false })))
    } finally {
      setPermLoading(false)
    }
  }

  const togglePerm = (moduleCode, field) => {
    setPermData(prev => prev.map(m => m.module_code === moduleCode ? { ...m, [field]: !m[field] } : m))
  }

  const savePermissions = async () => {
    if (!permModal) return
    setPermSaving(true)
    try {
      await api.put(`/users/${permModal.user_id}/permissions`, { modules: permData })
      toast.success(`Permissions saved for ${permModal.full_name}`)
      setPermModal(null)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save permissions')
    } finally {
      setPermSaving(false)
    }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const roleColors = { admin: 'bg-red-100 text-red-700', doctor: 'bg-blue-100 text-blue-700', receptionist: 'bg-green-100 text-green-700', pharmacist: 'bg-purple-100 text-purple-700', accountant: 'bg-amber-100 text-amber-700', staff: 'bg-slate-100 text-slate-600' }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary-100 rounded-lg"><UserCog size={18} className="text-primary-600" /></div>
            <div>
              <h2 className="font-bold text-slate-800">User Management</h2>
              <p className="text-xs text-slate-400">{data.length} users</p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors">
            <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} className="w-3.5 h-3.5 accent-primary-600" />
            Show Inactive
          </label>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2"><Plus size={16} />Add User</button>
      </div>

      <div className="card">
        <Table
          columns={[
            { key: 'username',  label: 'Username', width: 110 },
            { key: 'full_name', label: 'Full Name' },
            { key: 'role',      label: 'Role', render: v => <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${roleColors[v] || ''}`}>{v}</span> },
            { key: 'email',     label: 'Email' },
            { key: 'last_login',label: 'Last Login', render: v => v ? new Date(v).toLocaleDateString('en-IN') : '—' },
            { key: 'is_active', label: 'Status', render: v => v
              ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span>
              : <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold uppercase">Inactive</span> },
          ]}
          data={data}
          emptyText="No users found."
          actions={(row) => (
            <>
              {row.is_active ? (
                <>
                  <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors" title="Edit"><Pencil size={14} /></button>
                  <button onClick={() => openPermissions(row)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Module Permissions"><ShieldCheck size={14} /></button>
                  <button onClick={() => { setPwdModal(row); setNewPwd('') }} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Reset Password"><KeyRound size={14} /></button>
                  <button onClick={() => handleDeactivate(row)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Deactivate"><Trash2 size={14} /></button>
                </>
              ) : (
                <button onClick={() => handleReactivate(row)} className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Reactivate"><RotateCcw size={14} /></button>
              )}
            </>
          )}
        />
      </div>

      {/* Add / Edit User Modal */}
      <FormModal isOpen={modal} onClose={() => setModal(false)} title={editing ? `Edit User — ${editing?.username}` : 'Add New User'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Username *</label><input className={`input-field ${editing ? 'bg-slate-50 text-slate-400' : ''}`} value={form.username} onChange={set('username')} readOnly={!!editing} placeholder="john.doe" autoFocus /></div>
            <div><label className="label">Full Name *</label><input className="input-field" value={form.full_name} onChange={set('full_name')} placeholder="John Doe" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role *</label>
              <select className="input-field" value={form.role} onChange={set('role')}>
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            {!editing && <div><label className="label">Password *</label><input className="input-field" type="password" value={form.password} onChange={set('password')} placeholder="Min 6 characters" /></div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Email</label><input className="input-field" type="email" value={form.email} onChange={set('email')} /></div>
            <div><label className="label">Phone</label><input className="input-field" value={form.phone} onChange={set('phone')} /></div>
          </div>
          {form.role === 'doctor' && (
            <div><label className="label">Link to Doctor</label>
              <select className="input-field" value={form.linked_doctor_id} onChange={set('linked_doctor_id')}>
                <option value="">Select Doctor</option>
                {doctors.map(d => <option key={d.doctor_id} value={d.doctor_id}>{d.name} ({d.doctor_code})</option>)}
              </select>
            </div>
          )}
          {form.role !== 'doctor' && (
            <div><label className="label">Link to Staff Member</label>
              <select className="input-field" value={form.linked_staff_id} onChange={set('linked_staff_id')}>
                <option value="">Select Staff (optional)</option>
                {staffList.map(s => <option key={s.staff_id} value={s.staff_id}>{s.name} ({s.staff_code})</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : editing ? 'Update User' : 'Create User'}</button>
          </div>
        </form>
      </FormModal>

      {/* Password Reset Modal */}
      <FormModal isOpen={!!pwdModal} onClose={() => setPwdModal(null)} title={`Reset Password — ${pwdModal?.username}`} size="sm">
        <div className="space-y-4">
          <div><label className="label">New Password</label><input className="input-field" type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="Min 6 characters" autoFocus /></div>
          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button onClick={() => setPwdModal(null)} className="btn-secondary">Cancel</button>
            <button onClick={handlePasswordReset} className="btn-primary">Reset Password</button>
          </div>
        </div>
      </FormModal>

      {/* Module / CRUD Permissions Modal */}
      <FormModal isOpen={!!permModal} onClose={() => setPermModal(null)} title={`Module Permissions — ${permModal?.full_name}`} size="lg">
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Choose which modules {permModal?.full_name} can access, and what they can do in each one.
          </p>
          {permLoading ? (
            <p className="text-sm text-slate-400 py-8 text-center">Loading…</p>
          ) : (
            <div className="border border-slate-100 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Module</th>
                    {PERM_FIELDS.map(f => (
                      <th key={f.key} className="px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide text-center">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULES.map(mod => {
                    const row = permData.find(m => m.module_code === mod.code) || {}
                    return (
                      <tr key={mod.code} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50">
                        <td className="px-4 py-2.5 font-medium text-slate-700">{mod.label}</td>
                        {PERM_FIELDS.map(f => (
                          <td key={f.key} className="px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 accent-primary-600 cursor-pointer"
                              checked={!!row[f.key]}
                              onChange={() => togglePerm(mod.code, f.key)}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button onClick={() => setPermModal(null)} className="btn-secondary">Cancel</button>
            <button onClick={savePermissions} disabled={permSaving || permLoading} className="btn-primary">
              {permSaving ? 'Saving...' : 'Save Permissions'}
            </button>
          </div>
        </div>
      </FormModal>
    </div>
  )
}
