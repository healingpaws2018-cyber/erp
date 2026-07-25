import { useState, useEffect } from 'react'
import { 
  Building2, Plus, Database, ShieldCheck, 
  MapPin, FileText, Calendar, AlertCircle, 
  CheckCircle2, RefreshCw, Layers, Server, Phone, Mail, Globe, UserCog, Check, X
} from 'lucide-react'

export default function Companies() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createStep, setCreateStep] = useState('')
  const [formData, setFormData] = useState({
    tenant_id: 1,
    company_code: '',
    company_name: '',
    address_line1: '',
    address_line2: '',
    address_line3: '',
    city: '',
    district: '',
    state: '',
    state_code: '',
    pincode: '',
    phone: '',
    alt_phone: '',
    email: '',
    website: '',
    gst_number: '',
    pan_number: '',
    reg_number: '',
    drug_license_no: '',
    established_on: '',
    current_fy: '2026-27',
    fy_start_month: 4
  })

  // Role Management Modal State
  const [roleModal, setRoleModal] = useState(null) // company object
  const [moduleUsers, setModuleUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [savingRoles, setSavingRoles] = useState(false)

  useEffect(() => {
    fetchCompanies()
  }, [])

  const fetchCompanies = async () => {
    try {
      setLoading(true)
      const res = await fetch('http://localhost:8000/companies/?tenant_id=1')
      if (!res.ok) throw new Error('Failed to fetch companies')
      const data = await res.json()
      setCompanies(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleCreateCompany = async (e) => {
    e.preventDefault()
    if (!formData.company_code || !formData.company_name) {
      alert('Please fill in Company Code and Company Name')
      return
    }

    const payload = { ...formData }
    if (!payload.established_on) delete payload.established_on

    try {
      setCreating(true)
      setCreateStep('1. Creating PostgreSQL Database...')
      await new Promise(r => setTimeout(r, 800))

      setCreateStep('2. Instantiating Schema & Tables...')
      await new Promise(r => setTimeout(r, 800))

      setCreateStep('3. Seeding Default Roles & Settings...')

      const res = await fetch('http://localhost:8000/companies/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create company')
      }

      await fetchCompanies()
      setShowModal(false)
      setFormData({
        tenant_id: 1,
        company_code: '',
        company_name: '',
        address_line1: '',
        address_line2: '',
        address_line3: '',
        city: '',
        district: '',
        state: '',
        state_code: '',
        pincode: '',
        phone: '',
        alt_phone: '',
        email: '',
        website: '',
        gst_number: '',
        pan_number: '',
        reg_number: '',
        drug_license_no: '',
        established_on: '',
        current_fy: '2026-27',
        fy_start_month: 4
      })
      alert('✅ Company created successfully! Database and schemas initialized.')
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setCreating(false)
      setCreateStep('')
    }
  }

  // ─── Switch Context Handler ──────────────────────────────────────
  const handleSwitchContext = async (company) => {
    try {
      const userStr = localStorage.getItem('user')
      let username = 'admin'
      if (userStr) {
        const u = JSON.parse(userStr)
        username = u.username || u.full_name || 'admin'
      }
      const payload = {
        company_id: company.company_id,
        username: username,
        temp_token: localStorage.getItem('token') || ''
      }
      const res = await fetch('http://localhost:8000/auth/select-company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to switch context')

      localStorage.setItem('token', data.access_token)
      localStorage.setItem('user', JSON.stringify({
        full_name: data.full_name,
        role: data.role,
        user_id: data.user_id,
        company_id: data.company_id,
        company_name: data.company_name,
        db_name: data.db_name,
        current_fy: data.current_fy,
        modules: data.modules
      }))

      // Cache this user's module View/Create/Edit/Delete/Export permissions for Sidebar.jsx
      // and App.jsx's route guard to read (see constants/permissions.js). Mirrors the same
      // fetch Login.jsx does after its own select-company call — this function is the OTHER
      // path that can land a fresh token+user in localStorage (switching company context
      // from the Companies screen), so it needs the same caching or the guard would fall
      // back to stale/missing permissions until the next full login. Never blocks the
      // context switch if this fails.
      try {
        const permRes = await fetch(`http://localhost:8000/users/${data.user_id}/permissions`, {
          headers: { Authorization: `Bearer ${data.access_token}` }
        })
        const permData = await permRes.json()
        if (permRes.ok) {
          localStorage.setItem('permissions', JSON.stringify({
            modules: permData.modules,
            has_custom_permissions: permData.has_custom_permissions,
          }))
        } else {
          localStorage.removeItem('permissions')
        }
      } catch (permErr) {
        console.warn('Could not load module permissions — defaulting to unrestricted access', permErr)
        localStorage.removeItem('permissions')
      }

      alert(`✅ Context established for ${data.company_name}! Active database is now ${data.db_name}.`)
      window.location.href = '/dashboard'
    } catch (err) {
      alert(`Error switching context: ${err.message}`)
    }
  }

  // ─── Manage Roles Handlers ──────────────────────────────────────
  const handleOpenRoles = async (company) => {
    setRoleModal(company)
    try {
      const res = await fetch(`http://localhost:8000/companies/${company.company_id}/modules`)
      const data = await res.json()
      setModuleUsers(data)
      if (data.length > 0) setSelectedUser(data[0])
    } catch (err) {
      alert(`Error loading module permissions: ${err.message}`)
    }
  }

  const handleTogglePerm = (moduleCode, field) => {
    if (!selectedUser) return
    const updatedModules = selectedUser.modules.map(m => {
      if (m.module_code === moduleCode) {
        return { ...m, [field]: !m[field] }
      }
      return m
    })
    setSelectedUser({ ...selectedUser, modules: updatedModules })
    setModuleUsers(moduleUsers.map(u => u.user_id === selectedUser.user_id ? { ...u, modules: updatedModules } : u))
  }

  const handleSaveRoles = async (e) => {
    e.preventDefault()
    if (!selectedUser || !roleModal) return
    setSavingRoles(true)
    try {
      const payload = {
        user_id: selectedUser.user_id,
        modules: selectedUser.modules
      }
      const res = await fetch(`http://localhost:8000/companies/${roleModal.company_id}/modules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Failed to update permissions')
      alert('✅ Module permissions updated successfully!')
      setRoleModal(null)
    } catch (err) {
      alert(`Error saving permissions: ${err.message}`)
    } finally {
      setSavingRoles(false)
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-primary-950 to-slate-900 rounded-3xl p-8 text-white shadow-2xl relative overflow-hidden">
        <div className="absolute -right-10 -top-10 w-60 h-60 bg-primary-500/20 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -left-10 -bottom-10 w-60 h-60 bg-blue-500/20 rounded-full blur-3xl pointer-events-none"></div>
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-primary-500/30 border border-primary-500/40 rounded-full text-xs font-semibold tracking-wider uppercase text-primary-300 backdrop-blur-md flex items-center gap-1.5">
                <Server size={14} /> Master DB Isolated
              </span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">🏢 Multi-Company Registry</h1>
            <p className="text-slate-300 mt-2 max-w-2xl text-sm md:text-base leading-relaxed">
              Manage your clinic branches and legal entities. Each company operates in an isolated, dedicated PostgreSQL database with automatic schema instantiation and Fernet credential encryption at rest.
            </p>
          </div>

          <button
            onClick={() => {
              if (companies.length >= 3) {
                alert('Maximum limit of 3 companies reached for this tenant.')
                return
              }
              setShowModal(true)
            }}
            disabled={companies.length >= 3}
            className={`flex items-center gap-2 px-6 py-3.5 rounded-xl font-bold text-sm transition-all duration-200 shadow-lg shrink-0 ${
              companies.length >= 3 
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700' 
                : 'bg-primary-600 hover:bg-primary-500 text-white shadow-primary-600/30 hover:scale-[1.02]'
            }`}
          >
            <Plus size={18} />
            Add New Company {companies.length}/3
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-primary-50 text-primary-600 rounded-xl flex items-center justify-center font-bold shadow-inner">
            <Building2 size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Registered Entities</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-0.5">{companies.length} <span className="text-sm font-normal text-slate-400">/ 3 Max</span></p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-bold shadow-inner">
            <Database size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Databases</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-0.5">{companies.length} <span className="text-sm font-normal text-emerald-600">● Live</span></p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-bold shadow-inner">
            <ShieldCheck size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Security Status</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-0.5">Fernet <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 align-middle">Encrypted</span></p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center font-bold shadow-inner">
            <Calendar size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Financial Year</p>
            <p className="text-2xl font-extrabold text-slate-800 mt-0.5">2026-27</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-64 bg-white rounded-2xl border border-slate-100 shadow-sm">
          <RefreshCw size={32} className="animate-spin text-primary-600 mb-4" />
          <p className="text-slate-500 font-medium">Fetching company registry & database statuses...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-700 flex items-center gap-4">
          <AlertCircle size={28} className="shrink-0" />
          <div>
            <p className="font-bold">Error loading company registry</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      ) : companies.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-16 text-center max-w-2xl mx-auto space-y-6 animate-fadeIn">
          <div className="w-20 h-20 bg-primary-50 text-primary-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <Building2 size={36} />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-slate-800">No Companies Configured Yet</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              Your tenant account is active but has no associated clinical entities. Click below to instantiate your first company database.
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-3 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl shadow-lg shadow-primary-600/30 transition-all hover:scale-[1.02]"
          >
            Instantiate First Company DB
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fadeIn">
          {companies.map((c) => (
            <div key={c.company_id} className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden group">
              {/* Card Header */}
              <div className="bg-gradient-to-r from-slate-50 to-white p-6 border-b border-slate-100 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-primary-600 text-white rounded-xl flex items-center justify-center font-bold text-lg shadow-md group-hover:scale-105 transition-all">
                    {c.company_code}
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg leading-tight group-hover:text-primary-600 transition-colors">{c.company_name}</h3>
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1 font-mono">
                      <Database size={12} /> {c.db_name}
                    </p>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full flex items-center gap-1 shrink-0">
                  <CheckCircle2 size={12} /> {c.status}
                </span>
              </div>

              {/* Card Body */}
              <div className="p-6 flex-1 space-y-4 text-sm">
                <div className="flex items-start gap-3 text-slate-600">
                  <MapPin size={16} className="text-slate-400 mt-0.5 shrink-0" />
                  <span className="leading-snug">
                    {[c.address_line1, c.address_line2, c.address_line3].filter(Boolean).join(', ') || 'No address provided'}
                    <br />
                    {c.city}, {c.state} {c.state_code ? `(${c.state_code})` : ''} - {c.pincode}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <p className="text-xs text-slate-400 font-medium uppercase">Phone / Email</p>
                    <p className="font-semibold text-slate-700 mt-0.5 truncate">{c.phone || c.email || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium uppercase">Active FY</p>
                    <p className="font-semibold text-primary-600 font-mono mt-0.5">{c.current_fy}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                  <div>
                    <p className="text-xs text-slate-400 font-medium uppercase">GSTIN</p>
                    <p className="font-semibold text-slate-700 font-mono mt-0.5">{c.gst_number || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 font-medium uppercase">Drug License</p>
                    <p className="font-semibold text-slate-700 font-mono mt-0.5">{c.drug_license_no || 'N/A'}</p>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <p className="text-xs text-slate-400 font-medium uppercase mb-1">Seeded Roles</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['Admin', 'Doctor', 'Receptionist', 'Pharmacist'].map(role => (
                      <span key={role} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-xs font-medium">
                        {role}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card Footer */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 grid grid-cols-2 gap-2">
                <button 
                  onClick={() => handleOpenRoles(c)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5"
                >
                  <UserCog size={14} /> Manage Roles
                </button>
                <button 
                  onClick={() => handleSwitchContext(c)}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-primary-600/20 flex items-center justify-center gap-1.5"
                >
                  <Database size={14} /> Switch Context
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Role Management Modal */}
      {roleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-slate-900 to-primary-950 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">Manage Roles & Module Permissions</h3>
                <p className="text-slate-300 text-xs mt-1">Configuring RBAC for <span className="font-bold text-primary-400">{roleModal.company_name}</span></p>
              </div>
              <button onClick={() => setRoleModal(null)} className="text-slate-400 hover:text-white text-xl p-2">✕</button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
              {/* Left Sidebar: User List */}
              <div className="w-full md:w-1/3 bg-slate-50 border-r border-slate-100 overflow-y-auto p-4 space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-3">Tenant Users</p>
                {moduleUsers.map(u => (
                  <button
                    key={u.user_id}
                    onClick={() => setSelectedUser(u)}
                    className={`w-full p-3 rounded-2xl text-left transition-all flex items-center justify-between ${
                      selectedUser?.user_id === u.user_id 
                        ? 'bg-primary-600 text-white shadow-md shadow-primary-600/20' 
                        : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{u.full_name}</p>
                      <p className={`text-xs truncate ${selectedUser?.user_id === u.user_id ? 'text-primary-200' : 'text-slate-400'}`}>
                        {u.email || 'No email'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Right Content: Module Permissions Table */}
              <div className="flex-1 p-6 overflow-y-auto space-y-6">
                {selectedUser ? (
                  <form onSubmit={handleSaveRoles} className="space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                      <div>
                        <h4 className="font-bold text-slate-800 text-base">{selectedUser.full_name}</h4>
                        <p className="text-xs text-slate-400">Configure granular module permissions for this user</p>
                      </div>
                      <span className="px-3 py-1 bg-primary-50 text-primary-700 rounded-full text-xs font-bold uppercase tracking-wider">
                        {selectedUser.role}
                      </span>
                    </div>

                    <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100 text-slate-600 font-bold text-xs uppercase tracking-wider">
                            <th className="p-4">Module</th>
                            <th className="p-4 text-center">View</th>
                            <th className="p-4 text-center">Create</th>
                            <th className="p-4 text-center">Edit</th>
                            <th className="p-4 text-center">Delete</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedUser.modules.map(m => (
                            <tr key={m.module_code} className="hover:bg-slate-50/50 transition-colors">
                              <td className="p-4 font-semibold text-slate-800">{m.module_code}</td>
                              {['can_view', 'can_create', 'can_edit', 'can_delete'].map(field => (
                                <td key={field} className="p-4 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePerm(m.module_code, field)}
                                    className={`w-6 h-6 rounded-lg flex items-center justify-center mx-auto transition-all ${
                                      m[field] 
                                        ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30 hover:bg-emerald-600' 
                                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                    }`}
                                  >
                                    {m[field] ? <Check size={14} /> : <X size={14} />}
                                  </button>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setRoleModal(null)}
                        className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-sm transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingRoles}
                        className="px-6 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-primary-600/30 flex items-center gap-2"
                      >
                        {savingRoles ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                        Save Permissions
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400 space-y-2">
                    <UserCog size={36} />
                    <p>Select a user from the left sidebar to configure permissions.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Company Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-4xl w-full shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 bg-gradient-to-r from-slate-900 to-primary-950 text-white flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">Instantiate New Company Database</h3>
                <p className="text-slate-300 text-xs mt-1">Automatic PostgreSQL DB Creation & Alembic Schema Instantiation</p>
              </div>
              <button onClick={() => !creating && setShowModal(false)} className="text-slate-400 hover:text-white text-xl p-2">✕</button>
            </div>

            <form onSubmit={handleCreateCompany} className="p-6 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-3 pb-2 border-b border-slate-100">
                  <h4 className="text-sm font-bold text-primary-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Building2 size={16} /> 1. Core Identification
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Company Code *</label>
                      <input
                        type="text"
                        name="company_code"
                        required
                        placeholder="e.g. ABC"
                        maxLength={10}
                        value={formData.company_code}
                        onChange={handleInputChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono uppercase text-sm"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">3-5 letter unique DB prefix</p>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Company / Clinic Name *</label>
                      <input
                        type="text"
                        name="company_name"
                        required
                        placeholder="e.g. ABC Pet Clinic & Surgical Center"
                        value={formData.company_name}
                        onChange={handleInputChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-3 pb-2 border-b border-slate-100">
                  <h4 className="text-sm font-bold text-primary-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <MapPin size={16} /> 2. Location & Address
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Address Line 1</label>
                      <input type="text" name="address_line1" placeholder="Flat, House no., Building" value={formData.address_line1} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Address Line 2</label>
                      <input type="text" name="address_line2" placeholder="Area, Street, Sector" value={formData.address_line2} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Address Line 3</label>
                      <input type="text" name="address_line3" placeholder="Landmark" value={formData.address_line3} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">City</label>
                      <input type="text" name="city" placeholder="City" value={formData.city} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">District</label>
                      <input type="text" name="district" placeholder="District" value={formData.district} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">State & State Code</label>
                      <div className="flex gap-2">
                        <input type="text" name="state" placeholder="State" value={formData.state} onChange={handleInputChange} className="w-2/3 px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                        <input type="text" name="state_code" placeholder="Code" maxLength={5} value={formData.state_code} onChange={handleInputChange} className="w-1/3 px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm font-mono uppercase" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Pincode</label>
                      <input type="text" name="pincode" placeholder="Pincode" value={formData.pincode} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-3 pb-2 border-b border-slate-100">
                  <h4 className="text-sm font-bold text-primary-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Phone size={16} /> 3. Contact & Digital
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Phone</label>
                      <input type="text" name="phone" placeholder="Primary Phone" value={formData.phone} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Alt Phone</label>
                      <input type="text" name="alt_phone" placeholder="Secondary Phone" value={formData.alt_phone} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Email</label>
                      <input type="email" name="email" placeholder="clinic@example.com" value={formData.email} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Website</label>
                      <input type="text" name="website" placeholder="www.petclinic.com" value={formData.website} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-3 pb-2 border-b border-slate-100">
                  <h4 className="text-sm font-bold text-primary-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <ShieldCheck size={16} /> 4. Tax & Licensing
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">GSTIN Number</label>
                      <input type="text" name="gst_number" placeholder="27AAAAA0000A1Z5" value={formData.gst_number} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm uppercase" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">PAN Number</label>
                      <input type="text" name="pan_number" placeholder="AAAAA0000A" value={formData.pan_number} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm uppercase" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Registration No</label>
                      <input type="text" name="reg_number" placeholder="Reg No" value={formData.reg_number} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Drug License No</label>
                      <input type="text" name="drug_license_no" placeholder="MH-MZ-123456" value={formData.drug_license_no} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Established Date</label>
                      <input type="date" name="established_on" value={formData.established_on} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">Initial Financial Year</label>
                      <input type="text" name="current_fy" disabled value={formData.current_fy} className="w-full px-4 py-2.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-sm text-slate-500 cursor-not-allowed" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">FY Start Month</label>
                      <select name="fy_start_month" value={formData.fy_start_month} onChange={handleInputChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm bg-white">
                        <option value={4}>April (Indian FY)</option>
                        <option value={1}>January (Calendar Year)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {creating && (
                <div className="p-6 bg-primary-50 border border-primary-200 rounded-2xl flex flex-col items-center justify-center text-center space-y-3 animate-pulse">
                  <RefreshCw size={28} className="animate-spin text-primary-600" />
                  <div>
                    <p className="font-bold text-primary-800 text-sm">Instantiating Multi-Tenant Infrastructure...</p>
                    <p className="text-xs text-primary-600 mt-1 font-mono">{createStep}</p>
                  </div>
                </div>
              )}

              <div className="pt-6 border-t border-slate-100 flex items-center justify-end gap-3">
                <button type="button" onClick={() => !creating && setShowModal(false)} disabled={creating} className="px-6 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-sm transition-all">Cancel</button>
                <button type="submit" disabled={creating} className="px-6 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-primary-600/30 disabled:opacity-50 flex items-center gap-2">
                  {creating ? <><RefreshCw size={16} className="animate-spin" /> Creating DB...</> : <><Layers size={16} /> Instantiate Database & Schema</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
