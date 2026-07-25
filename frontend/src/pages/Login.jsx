import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { Eye, EyeOff, Lock, User, Building2, Database, ChevronRight, CheckCircle2 } from 'lucide-react'
import api from '../api'
import { fetchAndStorePermissions } from '../constants/permissions'

export default function Login() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1) // 1 = Credentials, 2 = Select Company
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  
  // Discovery state
  const [discoveryData, setDiscoveryData] = useState(null)

  const handleLoginSubmit = async (e) => {
    e.preventDefault()
    if (!form.username || !form.password) {
      toast.error('Please enter username and password')
      return
    }
    setLoading(true)
    try {
      const res = await api.post('/auth/login', form)
      setDiscoveryData(res.data)
      setStep(2)
      toast.success(`Credentials verified! Please select a company context.`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectCompany = async (company) => {
    setLoading(true)
    try {
      const payload = {
        company_id: company.company_id,
        username: form.username,
        // Match the backend: Pass the temp_token returned from the Step 1 response
        temp_token: discoveryData.temp_token 
      }
      
      const res = await api.post('/auth/select-company', payload)
      
      // Save final token and user context
      localStorage.setItem('token', res.data.access_token)
      localStorage.setItem('user', JSON.stringify({
        full_name:    res.data.full_name,
        role:         res.data.role,
        user_id:      res.data.user_id,
        company_id:   res.data.company_id,
        company_name: res.data.company_name,
        db_name:      res.data.db_name,
        current_fy:   res.data.current_fy
      }))

      // Fetch this user's module View/Create/Edit/Delete/Export permissions and cache them
      // for Sidebar.jsx (nav filtering) and App.jsx (route guard) to read synchronously on
      // every render — must happen after the token is stored above since api.js's request
      // interceptor reads it from localStorage. Never blocks/fails login (see
      // fetchAndStorePermissions's docstring).
      await fetchAndStorePermissions(api, res.data.user_id)

      toast.success(`Welcome back, ${res.data.full_name}!`)
      
      // Route straight to your application main dashboard layout
      navigate('/dashboard') 
      
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Company selection failed')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 flex items-center justify-center p-4 animate-fadeIn">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-white/5 rounded-full" />
        <div className="absolute top-1/2 left-1/4 w-64 h-64 bg-white/3 rounded-full" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 border border-white/20 overflow-hidden">
          {step === 1 ? (
            <>
              {/* Logo */}
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-lg shadow-primary-600/30 animate-bounce">
                  🐾
                </div>
                <h1 className="text-2xl font-bold text-slate-800">Pet Clinic ERP</h1>
                <p className="text-sm text-slate-400 mt-1">Sign in to your account</p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-5">
                {/* Username */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Username</label>
                  <div className="relative">
                    <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm transition-all"
                      type="text"
                      placeholder="Enter your username"
                      value={form.username}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      autoFocus
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Password</label>
                  <div className="relative">
                    <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      className="w-full pl-10 pr-12 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm transition-all"
                      type={showPass ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl shadow-lg shadow-primary-600/30 transition-all hover:scale-[1.02] disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : null}
                  {loading ? 'Verifying Credentials...' : 'Sign In & Discover Companies'}
                </button>
              </form>

              <p className="text-center text-xs text-slate-400 mt-6">
                Default: <span className="font-mono font-semibold text-slate-600">admin / admin123</span>
              </p>
            </>
          ) : (
            <div className="space-y-6 animate-fadeIn">
              <div className="text-center border-b border-slate-100 pb-6">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
                  <CheckCircle2 size={28} />
                </div>
                <h2 className="text-xl font-extrabold text-slate-800">Select Company Context</h2>
                <p className="text-xs text-slate-400 mt-1">Welcome back, <span className="font-bold text-slate-700">{discoveryData?.full_name}</span>. Choose an active database below.</p>
              </div>

              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {discoveryData?.companies.map(c => (
                  <button
                    key={c.company_id}
                    onClick={() => handleSelectCompany(c)}
                    disabled={loading}
                    className="w-full p-4 rounded-2xl border border-slate-100 hover:border-primary-200 bg-white hover:bg-primary-50/50 transition-all duration-200 flex items-center justify-between group shadow-sm hover:shadow-md text-left"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 bg-primary-100 text-primary-700 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 group-hover:scale-105 transition-transform">
                        {c.company_code}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800 text-sm truncate group-hover:text-primary-700 transition-colors">{c.company_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1 font-mono">
                          <Database size={12} /> {c.db_name}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2 py-0.5 bg-slate-100 group-hover:bg-primary-100 text-slate-600 group-hover:text-primary-700 rounded-md text-[11px] font-bold font-mono transition-colors">
                        {c.current_fy}
                      </span>
                      <ChevronRight size={18} className="text-slate-300 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
                >
                  ← Back to Login
                </button>
                <p className="text-[11px] text-slate-400 font-mono">
                  {discoveryData?.companies.length} databases discovered
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-white/60 text-xs mt-4 font-medium">
          Pet Clinic ERP v2.0 — Multi-Tenant Architecture
        </p>
      </div>
    </div>
  )
}
