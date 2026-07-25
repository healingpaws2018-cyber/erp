import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { X, Calendar, Activity, AlertTriangle, FileText, Plus, Filter, Heart, User, Shield, Tag, Share2, Award, Printer } from 'lucide-react'
import api from '../api'
import PetBookPrint from './PetBookPrint'
import CertificateIssueModal from './CertificateIssueModal'
import CertificatePrint from './CertificatePrint'

export default function PetBookModal({ isOpen, onClose, petId }) {
  const [data, setData] = useState(null)
  const [clinic, setClinic] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('timeline')
  const [showExport, setShowExport] = useState(false)

  // Certificates
  const [certificates, setCertificates] = useState([])
  const [certsLoading, setCertsLoading] = useState(false)
  const [showIssueCert, setShowIssueCert] = useState(false)
  const [printCert, setPrintCert] = useState(null)

  const loadCertificates = () => {
    if (!petId) return
    setCertsLoading(true)
    api.get('/certificates', { params: { pet_id: petId } })
      .then(r => setCertificates(r.data || []))
      .catch(() => setCertificates([]))
      .finally(() => setCertsLoading(false))
  }
  
  // Timeline filters
  const [filters, setFilters] = useState({
    CONSULTATION: true,
    VACCINE: true,
    PRESCRIPTION: true,
    LAB_TEST: true,
    SURGERY: true
  })

  // Quick add forms
  const [newAllergy, setNewAllergy] = useState({ allergen: '', reaction_type: '', severity: 'Moderate', notes: '' })
  const [newVital, setNewVital] = useState({ weight_kg: '', temp_celsius: '', heart_rate: '', resp_rate: '', body_condition_score: 5 })
  const [savingAllergy, setSavingAllergy] = useState(false)
  const [savingVital, setSavingVital] = useState(false)

  const loadBook = () => {
    if (!petId) return
    setLoading(true)
    api.get(`/pets/${petId}/book`)
      .then(r => {
        setData(r.data)
        setLoading(false)
      })
      .catch(err => {
        toast.error('Failed to load Pet Book')
        setLoading(false)
      })
  }

  useEffect(() => {
    if (isOpen && petId) {
      loadBook()
      loadCertificates()
      api.get('/clinic/setup').then(r => setClinic(r.data)).catch(() => {})
    }
  }, [isOpen, petId])

  if (!isOpen) return null

  // Derived display helpers (real data only — no placeholders)
  const pet = data?.pet
  const ageStr = pet && (pet.age_years != null || pet.age_months != null)
    ? [pet.age_years ? `${pet.age_years}y` : null, pet.age_months ? `${pet.age_months}m` : null].filter(Boolean).join(' ') || '0m'
    : 'Age not recorded'
  const speciesBreed = pet ? [pet.species_name, pet.breed_name].filter(Boolean).join(' • ') : ''

  const handleAddAllergy = async (e) => {
    e.preventDefault()
    if (!newAllergy.allergen) return toast.error('Allergen name is required')
    setSavingAllergy(true)
    try {
      const { data: saved } = await api.post(`/pets/${petId}/allergies`, newAllergy)
      toast.success('Allergy recorded successfully!')
      setData(prev => ({ ...prev, allergies: [saved, ...prev.allergies] }))
      setNewAllergy({ allergen: '', reaction_type: '', severity: 'Moderate', notes: '' })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to add allergy')
    } finally {
      setSavingAllergy(false)
    }
  }

  const handleAddVital = async (e) => {
    e.preventDefault()
    if (!newVital.weight_kg) return toast.error('Weight is required')
    setSavingVital(true)
    try {
      const payload = {
        weight_kg: newVital.weight_kg ? parseFloat(newVital.weight_kg) : null,
        temp_celsius: newVital.temp_celsius ? parseFloat(newVital.temp_celsius) : null,
        heart_rate: newVital.heart_rate ? parseInt(newVital.heart_rate) : null,
        resp_rate: newVital.resp_rate ? parseInt(newVital.resp_rate) : null,
        body_condition_score: newVital.body_condition_score ? parseInt(newVital.body_condition_score) : null,
      }
      const { data: saved } = await api.post(`/pets/${petId}/vitals`, payload)
      toast.success('Vitals logged successfully!')
      setData(prev => ({
        ...prev,
        vitals: [saved, ...prev.vitals],
        pet: { ...prev.pet, weight_kg: saved.weight_kg ?? prev.pet.weight_kg }
      }))
      setNewVital({ weight_kg: '', temp_celsius: '', heart_rate: '', resp_rate: '', body_condition_score: 5 })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to add vitals')
    } finally {
      setSavingVital(false)
    }
  }

  const toggleFilter = (type) => {
    setFilters(f => ({ ...f, [type]: !f[type] }))
  }

  const filteredTimeline = data?.timeline?.filter(item => filters[item.event_type] !== false) || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-6xl rounded-2xl shadow-2xl border border-slate-100 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-lg shadow-inner">
              🐾
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                Pet Health Book
                {data && <span className="text-xs bg-primary-50 text-primary-600 font-semibold px-2.5 py-1 rounded-lg border border-primary-100">{data.pet.pet_code}</span>}
              </h2>
              <p className="text-xs text-slate-500">Comprehensive longitudinal clinical & medical history</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <button
                onClick={() => setShowExport(true)}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm"
              >
                <Share2 size={16} /> Export / Share
              </button>
            )}
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center p-20 gap-4">
            <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
            <p className="text-sm font-medium text-slate-500">Fetching complete medical archives & timeline...</p>
          </div>
        ) : data ? (
          <div className="flex flex-col flex-1 overflow-hidden">
            
            {/* Glassmorphism Header Banner */}
            <div className="bg-gradient-to-r from-primary-900 via-primary-800 to-indigo-900 text-white px-8 py-6 shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
              <div className="absolute right-1/3 -bottom-10 w-40 h-40 bg-primary-500/20 rounded-full blur-2xl pointer-events-none" />
              
              <div className="flex items-center gap-6 z-10">
                <div className="w-20 h-20 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-center text-4xl shadow-xl">
                  🐶
                </div>
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-3xl font-extrabold tracking-tight">{data.pet.name}</h1>
                    {speciesBreed && (
                      <span className="bg-white/20 backdrop-blur-md text-white font-semibold text-xs px-3 py-1 rounded-full border border-white/10">
                        {speciesBreed}
                      </span>
                    )}
                    <span className="bg-white/20 backdrop-blur-md text-white font-semibold text-xs px-3 py-1 rounded-full border border-white/10">
                      {[data.pet.gender, ageStr].filter(Boolean).join(' • ')}
                    </span>
                    {data.summary.is_spayed_neutered && (
                      <span className="bg-green-500/20 text-green-200 font-bold text-xs px-3 py-1 rounded-full border border-green-500/30 backdrop-blur-md flex items-center gap-1">
                        <Heart size={12} /> Neutered
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-6 mt-3 text-xs text-primary-100 flex-wrap">
                    {data.pet.owner_name && (
                      <div className="flex items-center gap-1.5">
                        <User size={14} className="text-primary-300" />
                        <span>Owner: <strong className="text-white">{data.pet.owner_name}</strong>{data.pet.owner_phone ? ` (${data.pet.owner_phone})` : ''}</span>
                      </div>
                    )}
                    {data.summary.microchip_no && (
                      <div className="flex items-center gap-1.5">
                        <Tag size={14} className="text-primary-300" />
                        <span>Microchip: <strong className="text-white">{data.summary.microchip_no}</strong></span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Warning Flags */}
              <div className="flex flex-col gap-2 z-10 w-full md:w-auto">
                {data.allergies.length > 0 ? (
                  <div className="bg-red-500/20 border border-red-500/30 backdrop-blur-md text-red-200 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-lg">
                    <AlertTriangle size={20} className="text-red-400 shrink-0" />
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-red-300">Active Allergies</div>
                      <div className="text-sm font-extrabold text-white">{data.allergies.map(a => a.allergen).join(', ')}</div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-emerald-500/20 border border-emerald-500/30 backdrop-blur-md text-emerald-200 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-lg">
                    <Shield size={20} className="text-emerald-400 shrink-0" />
                    <div className="text-xs font-bold uppercase tracking-wider text-emerald-100">No Known Allergies</div>
                  </div>
                )}
                
                <div className="bg-white/10 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2 flex items-center justify-between gap-4 text-xs">
                  <span className="text-primary-200">Current Weight:</span>
                  <span className="text-white font-bold text-sm">{data.pet.weight_kg != null ? `${data.pet.weight_kg} kg` : '—'}</span>
                </div>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden">
              
              {/* Left Sidebar Navigation */}
              <div className="w-64 bg-slate-50 border-r border-slate-100 p-4 flex flex-col gap-1 shrink-0 overflow-y-auto">
                <div className="text-[10px] font-bold text-slate-400 uppercase px-3 py-2 tracking-wider">Navigation</div>
                
                <button
                  onClick={() => setActiveTab('timeline')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${activeTab === 'timeline' ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Calendar size={18} />
                  <span>Medical Timeline</span>
                  <span className="ml-auto text-xs bg-black/10 px-2 py-0.5 rounded-full">{filteredTimeline.length}</span>
                </button>

                <button
                  onClick={() => setActiveTab('vitals')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${activeTab === 'vitals' ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Activity size={18} />
                  <span>Vitals & Weight</span>
                  <span className="ml-auto text-xs bg-black/10 px-2 py-0.5 rounded-full">{data.vitals.length}</span>
                </button>

                <button
                  onClick={() => setActiveTab('allergies')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${activeTab === 'allergies' ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <AlertTriangle size={18} />
                  <span>Allergies & ADR</span>
                  <span className="ml-auto text-xs bg-black/10 px-2 py-0.5 rounded-full">{data.allergies.length}</span>
                </button>

                <button
                  onClick={() => setActiveTab('labs')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${activeTab === 'labs' ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <FileText size={18} />
                  <span>Lab & Diagnostics</span>
                  <span className="ml-auto text-xs bg-black/10 px-2 py-0.5 rounded-full">{data.labs.length}</span>
                </button>

                <button
                  onClick={() => setActiveTab('certificates')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-sm transition-all ${activeTab === 'certificates' ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/20' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  <Award size={18} />
                  <span>Certificates</span>
                  <span className="ml-auto text-xs bg-black/10 px-2 py-0.5 rounded-full">{certificates.length}</span>
                </button>

                <div className="mt-auto pt-4 border-t border-slate-200/60 flex flex-col gap-2">
                  <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-xl border border-slate-200/60">
                    <div className="font-bold text-slate-700 mb-1">Lifestyle Note</div>
                    <p className="text-[11px] leading-relaxed">{data.summary.lifestyle_note}</p>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-100 p-3 rounded-xl border border-slate-200/60">
                    <div className="font-bold text-slate-700 mb-1">Dietary Note</div>
                    <p className="text-[11px] leading-relaxed">{data.summary.dietary_note}</p>
                  </div>
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 p-8 overflow-y-auto bg-white">
                
                {/* 1. TIMELINE TAB */}
                {activeTab === 'timeline' && (
                  <div className="flex flex-col gap-6 max-w-4xl mx-auto">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-wrap gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">Unified Medical Feed</h3>
                        <p className="text-xs text-slate-500">Chronological history of all clinical visits, vaccines, and prescriptions</p>
                      </div>

                      {/* Filter Pills */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-400 flex items-center gap-1 mr-1">
                          <Filter size={14} /> Filter:
                        </span>
                        {Object.keys(filters).map(key => (
                          <button
                            key={key}
                            onClick={() => toggleFilter(key)}
                            className={`text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all ${filters[key] ? 'bg-primary-50 border-primary-200 text-primary-700 shadow-sm' : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'}`}
                          >
                            {key}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filteredTimeline.length === 0 ? (
                      <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8">
                        <p className="text-slate-500 font-medium text-sm">No medical timeline events found matching the active filters.</p>
                      </div>
                    ) : (
                      <div className="relative pl-6 border-l-2 border-primary-100 flex flex-col gap-8 my-4 ml-4">
                        {filteredTimeline.map((item, index) => (
                          <div key={item.event_id || index} className="relative group">
                            {/* Timeline Dot */}
                            <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-white border-4 border-primary-600 group-hover:scale-125 transition-transform shadow-md" />
                            
                            {/* Event Card */}
                            <div className="bg-slate-50 hover:bg-slate-100/80 transition-colors p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-2.5">
                              <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex items-center gap-3">
                                  <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg uppercase tracking-wider ${
                                    item.event_type === 'CONSULTATION' ? 'bg-blue-100 text-blue-700' :
                                    item.event_type === 'VACCINE' ? 'bg-emerald-100 text-emerald-700' :
                                    item.event_type === 'PRESCRIPTION' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'
                                  }`}>
                                    {item.event_type}
                                  </span>
                                  <h4 className="font-bold text-slate-800 text-base">{item.title}</h4>
                                </div>
                                <span className="text-xs font-semibold text-slate-500 bg-white px-3 py-1 rounded-xl border border-slate-200/60 shadow-sm flex items-center gap-1.5">
                                  <Calendar size={14} className="text-primary-500" />
                                  {item.event_date.substring(0, 10)}
                                </span>
                              </div>

                              {/* Structured consultation / prescription-note fields — one per line */}
                              {item.details?.length > 0 && (
                                <div className="bg-white p-4 rounded-xl border border-slate-200/40 shadow-inner flex flex-col gap-1.5">
                                  {item.details.map((d, di) => (
                                    <p key={di} className="text-slate-600 text-sm leading-relaxed whitespace-pre-line">
                                      <span className="font-semibold text-slate-700">{d.label}:</span> {d.value}
                                    </p>
                                  ))}
                                </div>
                              )}

                              {/* Prescribed medicines */}
                              {item.medicines?.length > 0 && (
                                <div className="bg-white p-4 rounded-xl border border-slate-200/40 shadow-inner flex flex-col gap-2">
                                  <div className="text-[11px] font-bold text-purple-700 uppercase tracking-wider">Prescribed Medicines</div>
                                  <div className="flex flex-col gap-2">
                                    {item.medicines.map((m, mi) => {
                                      const meta = [
                                        m.dose,
                                        m.frequency,
                                        m.route,
                                        m.duration_days ? `${m.duration_days} day${m.duration_days > 1 ? 's' : ''}` : null,
                                        m.quantity != null ? `Qty: ${m.quantity}` : null,
                                      ].filter(Boolean).join(' • ')
                                      return (
                                        <div key={mi} className="border-l-2 border-purple-200 pl-3">
                                          <div className="text-sm font-semibold text-slate-800">
                                            {m.medicine_name}
                                            {m.strength ? <span className="text-slate-500 font-normal"> ({m.strength}{m.dosage_form ? `, ${m.dosage_form}` : ''})</span> : null}
                                          </div>
                                          {meta && <div className="text-xs text-slate-500">{meta}</div>}
                                          {m.instructions && <div className="text-xs text-slate-500 italic">{m.instructions}</div>}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Fallback for events with no structured detail (vaccine, lab, etc.) */}
                              {!(item.details?.length > 0) && !(item.medicines?.length > 0) && (
                                <p className="text-slate-600 text-sm leading-relaxed bg-white p-4 rounded-xl border border-slate-200/40 shadow-inner font-normal">
                                  {item.summary_snippet}
                                </p>
                              )}

                              {item.doctor_id && (
                                <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                                  <User size={14} className="text-slate-400" />
                                  <span>Attending Doctor ID: <strong>{item.doctor_id}</strong></span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. VITALS TAB */}
                {activeTab === 'vitals' && (
                  <div className="flex flex-col gap-8 max-w-4xl mx-auto">
                    <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4">
                      <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
                        <Plus size={18} className="text-primary-600" /> Log New Vitals / Weight Check
                      </h3>
                      <form onSubmit={handleAddVital} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                          <label className="label">Weight (kg) *</label>
                          <input className="input-field bg-white" type="number" step="0.1" value={newVital.weight_kg} onChange={e => setNewVital(v => ({ ...v, weight_kg: e.target.value }))} placeholder="e.g. 32.5" />
                        </div>
                        <div>
                          <label className="label">Temp (°C)</label>
                          <input className="input-field bg-white" type="number" step="0.1" value={newVital.temp_celsius} onChange={e => setNewVital(v => ({ ...v, temp_celsius: e.target.value }))} placeholder="e.g. 38.5" />
                        </div>
                        <div>
                          <label className="label">Heart Rate (bpm)</label>
                          <input className="input-field bg-white" type="number" value={newVital.heart_rate} onChange={e => setNewVital(v => ({ ...v, heart_rate: e.target.value }))} placeholder="e.g. 110" />
                        </div>
                        <div>
                          <label className="label">Resp Rate (bpm)</label>
                          <input className="input-field bg-white" type="number" value={newVital.resp_rate} onChange={e => setNewVital(v => ({ ...v, resp_rate: e.target.value }))} placeholder="e.g. 24" />
                        </div>
                        <div>
                          <label className="label">BCS (1-9)</label>
                          <select className="input-field bg-white" value={newVital.body_condition_score} onChange={e => setNewVital(v => ({ ...v, body_condition_score: parseInt(e.target.value) }))}>
                            {[1,2,3,4,5,6,7,8,9].map(n => <option key={n} value={n}>{n} {n===5 ? '(Ideal)' : ''}</option>)}
                          </select>
                        </div>
                        <div className="md:col-span-5 flex justify-end pt-2">
                          <button type="submit" disabled={savingVital} className="btn-primary flex items-center gap-2 shadow-md">
                            <Plus size={16} /> {savingVital ? 'Logging...' : 'Log Vitals'}
                          </button>
                        </div>
                      </form>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-800 text-lg mb-4">Vitals & Weight History</h3>
                      {data.vitals.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-slate-500 font-medium text-sm">No vitals logged yet. Use the form above to record the first entry.</p>
                        </div>
                      ) : (
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 text-xs font-bold uppercase tracking-wider">
                                <th className="py-3.5 px-6">Date & Time</th>
                                <th className="py-3.5 px-6">Weight</th>
                                <th className="py-3.5 px-6">Temperature</th>
                                <th className="py-3.5 px-6">Heart Rate</th>
                                <th className="py-3.5 px-6">Resp Rate</th>
                                <th className="py-3.5 px-6">BCS</th>
                                <th className="py-3.5 px-6">Source</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                              {data.vitals.map(v => (
                                <tr key={v.vital_id} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="py-4 px-6 font-semibold text-slate-800">{v.recorded_at}</td>
                                  <td className="py-4 px-6 font-bold text-primary-600">{v.weight_kg ? `${v.weight_kg} kg` : '—'}</td>
                                  <td className="py-4 px-6">{v.temp_celsius ? `${v.temp_celsius} °C` : '—'}</td>
                                  <td className="py-4 px-6">{v.heart_rate ? `${v.heart_rate} bpm` : '—'}</td>
                                  <td className="py-4 px-6">{v.resp_rate ? `${v.resp_rate} bpm` : '—'}</td>
                                  <td className="py-4 px-6">
                                    {v.body_condition_score ? (
                                      <span className={`px-2.5 py-1 rounded-lg font-bold text-xs ${v.body_condition_score === 5 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {v.body_condition_score} / 9
                                      </span>
                                    ) : '—'}
                                  </td>
                                  <td className="py-4 px-6 text-xs text-slate-500">{v.source || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. ALLERGIES TAB */}
                {activeTab === 'allergies' && (
                  <div className="flex flex-col gap-8 max-w-4xl mx-auto">
                    <div className="bg-red-50 p-6 rounded-2xl border border-red-100 shadow-sm flex flex-col gap-4">
                      <h3 className="font-bold text-red-800 text-base flex items-center gap-2">
                        <AlertTriangle size={18} className="text-red-600" /> Record Known Allergy / Adverse Reaction
                      </h3>
                      <form onSubmit={handleAddAllergy} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <label className="label text-red-900">Allergen *</label>
                          <input className="input-field bg-white border-red-200 focus:border-red-500 focus:ring-red-500/20" value={newAllergy.allergen} onChange={e => setNewAllergy(a => ({ ...a, allergen: e.target.value }))} placeholder="e.g. Penicillin, Beef" />
                        </div>
                        <div>
                          <label className="label text-red-900">Reaction Type</label>
                          <input className="input-field bg-white border-red-200 focus:border-red-500 focus:ring-red-500/20" value={newAllergy.reaction_type} onChange={e => setNewAllergy(a => ({ ...a, reaction_type: e.target.value }))} placeholder="e.g. Hives, Facial Swelling" />
                        </div>
                        <div>
                          <label className="label text-red-900">Severity</label>
                          <select className="input-field bg-white border-red-200 focus:border-red-500 focus:ring-red-500/20" value={newAllergy.severity} onChange={e => setNewAllergy(a => ({ ...a, severity: e.target.value }))}>
                            <option value="Mild">Mild</option>
                            <option value="Moderate">Moderate</option>
                            <option value="Severe">Severe</option>
                            <option value="Life-Threatening">Life-Threatening</option>
                          </select>
                        </div>
                        <div>
                          <label className="label text-red-900">Clinical Notes</label>
                          <input className="input-field bg-white border-red-200 focus:border-red-500 focus:ring-red-500/20" value={newAllergy.notes} onChange={e => setNewAllergy(a => ({ ...a, notes: e.target.value }))} placeholder="Any precautions" />
                        </div>
                        <div className="md:col-span-4 flex justify-end pt-2">
                          <button type="submit" disabled={savingAllergy} className="bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2 text-sm">
                            <Plus size={16} /> {savingAllergy ? 'Saving...' : 'Add Allergy'}
                          </button>
                        </div>
                      </form>
                    </div>

                    <div>
                      <h3 className="font-bold text-slate-800 text-lg mb-4">Allergy & ADR Registry</h3>
                      {data.allergies.length === 0 ? (
                        <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                          <p className="text-slate-500 font-medium text-sm">No allergies recorded. Pet has no known adverse drug reactions.</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {data.allergies.map(a => (
                            <div key={a.allergy_id} className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col gap-3 hover:shadow-md transition-shadow">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="font-bold text-slate-800 text-base">{a.allergen}</h4>
                                <span className={`px-2.5 py-1 rounded-lg font-extrabold text-[10px] uppercase tracking-wider ${
                                  a.severity === 'Life-Threatening' ? 'bg-red-100 text-red-700 border border-red-200' :
                                  a.severity === 'Severe' ? 'bg-orange-100 text-orange-700' :
                                  a.severity === 'Moderate' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                                }`}>
                                  {a.severity}
                                </span>
                              </div>

                              <div className="text-xs text-slate-600 flex flex-col gap-1.5 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                                <div><strong className="text-slate-700">Reaction:</strong> {a.reaction_type || 'Unspecified'}</div>
                                <div><strong className="text-slate-700">Discovered:</strong> {a.discovered_date || 'Unknown'}</div>
                                {a.notes && <div><strong className="text-slate-700">Notes:</strong> {a.notes}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. LABS TAB */}
                {activeTab === 'labs' && (
                  <div className="flex flex-col gap-6 max-w-4xl mx-auto">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">Diagnostic Lab & Imaging Archives</h3>
                        <p className="text-xs text-slate-500">Historical blood panels, urinalysis, X-Rays, and cytology reports</p>
                      </div>
                    </div>

                    {data.labs.length === 0 ? (
                      <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8">
                        <p className="text-slate-500 font-medium text-sm">No diagnostic lab records found in the archives.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {data.labs.map(l => (
                          <div key={l.lab_record_id} className="bg-slate-50 hover:bg-slate-100/80 transition-colors p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center font-bold text-lg shrink-0 shadow-inner">
                                🔬
                              </div>
                              <div>
                                <div className="flex items-center gap-3">
                                  <h4 className="font-bold text-slate-800 text-base">{l.test_name}</h4>
                                  <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-lg font-bold uppercase tracking-wider">{l.test_category}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">Performed by: <strong>{l.performed_by || 'In-House Lab'}</strong> • {l.sample_collected_date.substring(0, 10)}</p>
                                {l.results_summary && (
                                  <p className="text-sm text-slate-600 mt-2 bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm">
                                    {l.results_summary}
                                  </p>
                                )}
                              </div>
                            </div>

                            {l.attachment_url && (
                              <a href={l.attachment_url} target="_blank" rel="noreferrer" className="btn-secondary text-xs flex items-center gap-2 shrink-0 bg-white shadow-sm">
                                <FileText size={14} /> View Report
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. CERTIFICATES TAB */}
                {activeTab === 'certificates' && (
                  <div className="flex flex-col gap-6 max-w-4xl mx-auto">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-100 flex-wrap gap-4">
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">Certificates</h3>
                        <p className="text-xs text-slate-500">Auto-generated ARV, health, travel, sterilization and other official certificates for this pet</p>
                      </div>
                      <button
                        onClick={() => setShowIssueCert(true)}
                        className="btn-primary flex items-center gap-2 shadow-md"
                      >
                        <Plus size={16} /> Issue Certificate
                      </button>
                    </div>

                    {certsLoading ? (
                      <div className="text-center py-16 text-sm text-slate-400">Loading certificates…</div>
                    ) : certificates.length === 0 ? (
                      <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200 p-8">
                        <Award size={28} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-slate-500 font-medium text-sm">No certificates issued yet for this pet.</p>
                      </div>
                    ) : (
                      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50/75 border-b border-slate-100 text-slate-500 text-xs font-bold uppercase tracking-wider">
                              <th className="py-3.5 px-6">Certificate</th>
                              <th className="py-3.5 px-6">Cert No</th>
                              <th className="py-3.5 px-6">Issue Date</th>
                              <th className="py-3.5 px-6">Doctor</th>
                              <th className="py-3.5 px-6"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-sm text-slate-600">
                            {certificates.map(c => (
                              <tr key={c.certificate_id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="py-4 px-6 font-semibold text-slate-800">{c.cert_type_label}</td>
                                <td className="py-4 px-6 font-mono text-xs">{c.cert_no}</td>
                                <td className="py-4 px-6">{c.issue_date}</td>
                                <td className="py-4 px-6">{c.doctor_name || '—'}</td>
                                <td className="py-4 px-6 text-right">
                                  <button
                                    onClick={() => setPrintCert(c)}
                                    className="btn-secondary text-xs flex items-center gap-1.5 ml-auto"
                                  >
                                    <Printer size={13} /> Print / Share
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>

          </div>
        ) : null}

      </div>

      {showExport && data && (
        <PetBookPrint data={data} clinic={clinic} onClose={() => setShowExport(false)} />
      )}

      {showIssueCert && data && (
        <CertificateIssueModal
          isOpen={showIssueCert}
          onClose={() => setShowIssueCert(false)}
          petId={petId}
          timeline={data.timeline || []}
          summary={data.summary || {}}
          onIssued={(cert) => {
            setCertificates(prev => [cert, ...prev])
            setShowIssueCert(false)
            setActiveTab('certificates')
            setPrintCert(cert)
          }}
        />
      )}

      {printCert && data && (
        <CertificatePrint
          certificate={printCert}
          pet={data.pet}
          summary={data.summary}
          clinic={clinic}
          onClose={() => setPrintCert(null)}
        />
      )}
    </div>
  )
}
