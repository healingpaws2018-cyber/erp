import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Save, Building2, Trash2, AlertTriangle, X } from 'lucide-react'
import api from '../api'
import AddressBlock from '../components/AddressBlock'

export default function ClinicSetup() {
  const DEFAULTS = {
    clinic_name: '', 
    address1: '', address2: '', address3: '', 
    city_id: '', city_name: 'Hyderabad', district: '', state_name: 'Telangana', state_code: '36',
    pincode: '', phone: '', alt_phone: '', email: '',
    website: '', gstin: '', pan: '', reg_number: '', drug_license_no: '',
    fy_start_month: 4
  }
  const [form, setForm] = useState(DEFAULTS)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [exists, setExists] = useState(false)
  const [cities, setCities] = useState([])

  const [clearPassword, setClearPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const handleClearDatabase = async (e) => {
    e.preventDefault()
    if (confirmText !== 'ERASE') {
      toast.error('Please type ERASE to confirm.')
      return
    }
    setClearing(true)
    try {
      const res = await api.post('/clinic/clear-data', { password: clearPassword })
      toast.success(res.data.message || 'Database cleared successfully!')
      setClearPassword('')
      setConfirmText('')
      setIsModalOpen(false)
    } catch (err) {
      toast.error(getErrMsg(err, 'Database clear failed'))
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => {
    setFetching(true)
    Promise.all([
      api.get('/clinic/setup').catch(err => err.response?.status === 404 ? { data: {} } : Promise.reject(err)),
      api.get('/masters/cities')
    ]).then(([setupRes, citiesRes]) => {
      if (setupRes.data.clinic_id) {
        setForm({ ...DEFAULTS, ...setupRes.data })
        setExists(true)
      }
      setCities(citiesRes.data)
    }).catch((err) => {
      console.error('Data load error:', err)
      toast.error('Failed to load clinic data')
    }).finally(() => setFetching(false))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.clinic_name) { toast.error('Clinic Name is required'); return }
    setLoading(true)
    try {
      // Coerce city_id: empty string → null, digit string → integer
      const payload = {
        ...form,
        city_id: form.city_id === '' || form.city_id === null || form.city_id === undefined
          ? null
          : Number(form.city_id)
      }
      if (exists) {
        await api.put('/clinic/setup', payload)
      } else {
        await api.post('/clinic/setup', payload)
        setExists(true)
      }
      toast.success('Clinic profile saved!')
    } catch (err) {
      toast.error(getErrMsg(err, 'Save failed'))
    } finally {
      setLoading(false)
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // Safely extract a string message from a FastAPI error response
  // (422 errors return detail as an array of validation error objects)
  const getErrMsg = (err, fallback = 'Save failed') => {
    const detail = err.response?.data?.detail
    if (!detail) return fallback
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return detail.map(d => d.msg || JSON.stringify(d)).join('; ')
    return fallback
  }

  if (fetching) return (
    <div className="card flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="max-w-3xl">
      <div className="card">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
          <div className="p-2 bg-primary-100 rounded-lg">
            <Building2 size={20} className="text-primary-600" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">Clinic Profile</h2>
            <p className="text-xs text-slate-400">{exists ? 'Update your clinic details' : 'Set up your clinic for the first time'}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-6 border-b border-slate-100">
            <div className="md:col-span-2">
              <label className="label">Clinic Name *</label>
              <input className="input-field" value={form.clinic_name} onChange={set('clinic_name')} placeholder="e.g. PawCare Veterinary Clinic" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input-field" value={form.phone || ''} onChange={set('phone')} placeholder="9876543210" />
            </div>
            <div>
              <label className="label">Alternate Phone</label>
              <input className="input-field" value={form.alt_phone || ''} onChange={set('alt_phone')} placeholder="Optional" />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input-field" type="email" value={form.email || ''} onChange={set('email')} placeholder="info@clinic.com" />
            </div>
            <div>
              <label className="label">Website</label>
              <input className="input-field" value={form.website || ''} onChange={set('website')} placeholder="https://..." />
            </div>
          </div>

          <AddressBlock form={form} set={set} cities={cities} />

          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-100">
            <div>
              <label className="label">Drug License No.</label>
              <input className="input-field" value={form.drug_license_no || ''} onChange={set('drug_license_no')} placeholder="Optional" />
            </div>
            <div>
              <label className="label">Vet Council Reg. No.</label>
              <input className="input-field" value={form.reg_number || ''} onChange={set('reg_number')} placeholder="VET/TS/2023/001" />
            </div>
            <div className="md:col-span-2">
              <label className="label">Financial Year Starts In</label>
              <select className="input-field" value={form.fy_start_month || 4} onChange={set('fy_start_month')}>
                <option value={1}>January (Jan – Dec)</option>
                <option value={2}>February</option>
                <option value={3}>March</option>
                <option value={4}>April (Apr – Mar) — Indian FY</option>
                <option value={7}>July</option>
                <option value={10}>October</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end mt-6 pt-4 border-t border-slate-100">
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save size={16} />}
              {loading ? 'Saving...' : exists ? 'Update Clinic' : 'Save Clinic'}
            </button>
          </div>
        </form>
      </div>

      {/* Danger Zone */}
      <div className="card border border-red-200 bg-red-50/5 mt-8">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-red-100">
          <div className="p-2 bg-red-100 rounded-lg">
            <Trash2 size={20} className="text-red-600" />
          </div>
          <div>
            <h2 className="font-bold text-red-800">Danger Zone</h2>
            <p className="text-xs text-red-400">Irreversible administrative actions</p>
          </div>
        </div>

        <div>
          <p className="text-sm text-slate-600 mb-4 font-sans leading-relaxed">
            Use this utility to clear all dynamic client and financial data from the database. 
            All billing history, sales bills, ledger postings, appointments, consultations, prescriptions, medicines, owners, and pets will be erased. 
            <strong> Core configurations (cities, species, breeds, users, and financial years) are preserved.</strong>
          </p>

          <div className="flex flex-col sm:flex-row gap-3 items-end max-w-lg">
            <div className="flex-1">
              <label className="label text-red-700">Enter Database Erase Password</label>
              <input 
                type="password" 
                className="input-field border-slate-200 focus:border-red-500 focus:ring-red-500" 
                value={clearPassword} 
                onChange={(e) => setClearPassword(e.target.value)} 
                placeholder="••••••••" 
              />
            </div>
            <button 
              type="button" 
              disabled={!clearPassword} 
              onClick={() => setIsModalOpen(true)}
              className="btn-danger flex items-center gap-2 whitespace-nowrap bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed h-[38px]"
            >
              <Trash2 size={16} />
              <span>Erase All Data</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle size={20} />
                <h3 className="font-bold text-slate-800">Erase All Client Data?</h3>
              </div>
              <button 
                onClick={() => { setIsModalOpen(false); setConfirmText(''); }}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleClearDatabase} className="p-6">
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                This action is <span className="font-bold text-red-600">permanent and cannot be undone</span>. 
                All transaction histories, appointments, medical files, invoices, and ledgers will be permanently deleted from this database.
              </p>

              <div className="mb-6">
                <label className="label text-slate-500 mb-2">
                  Type <span className="font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">ERASE</span> below to confirm:
                </label>
                <input 
                  type="text" 
                  className="input-field border-slate-200 focus:border-red-500 focus:ring-red-500 font-semibold tracking-wider text-center" 
                  value={confirmText} 
                  onChange={(e) => setConfirmText(e.target.value)} 
                  placeholder="Type ERASE"
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); setConfirmText(''); }}
                  className="btn-secondary py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={clearing || confirmText !== 'ERASE'}
                  className="btn-danger flex items-center justify-center gap-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {clearing ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 size={16} />}
                  <span>{clearing ? 'Erasing Database...' : 'Confirm Erase'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
