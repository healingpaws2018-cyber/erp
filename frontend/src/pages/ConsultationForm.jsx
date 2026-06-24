import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import { Save, Plus, Trash2, CheckCircle, FileText, Printer, Search } from 'lucide-react'
import api from '../api'
import PrescriptionPrint from '../components/PrescriptionPrint'

const VISIT_TYPES = ['OPD', 'Follow-Up', 'Emergency', 'Walk-In']
const FREQ_OPTIONS = ['Morn/Eve', 'Mor', 'Eve', 'Afternoon', 'Once daily', 'Twice daily', 'Three times daily', 'Every 8 hours', 'Every 12 hours', 'As needed']
const ROUTE_OPTIONS = ['Oral', 'Topical', 'IV', 'IM', 'SC', 'Intranasal', 'Ophthalmic', 'Otic']
const FORM_OPTIONS  = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops', 'Ointment', 'Powder', 'Cream', 'Gel', 'Spray']
const INSTRUCTION_OPTIONS = ['Before food', 'After food', 'In warm water', 'In cold water', 'With food', 'On empty stomach', 'At bedtime', 'Shake well before use']

const FREQ_MULTIPLIERS = {
  'Morn/Eve': 2,
  'Mor': 1,
  'Eve': 1,
  'Afternoon': 1,
  'Once daily': 1,
  'Twice daily': 2,
  'Three times daily': 3,
  'Thrice daily': 3,
  'Every 8 hours': 3,
  'Every 12 hours': 2,
  'As needed': 1
}

function extractNumber(str) {
  const match = String(str).match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 1;
}

function calculateQty(dose, frequency, days) {
  if (!dose && !frequency && !days) return '';
  const d = extractNumber(dose || '');
  const f = FREQ_MULTIPLIERS[frequency] || 1;
  const daysNum = parseInt(days) || 1;
  return d * f * daysNum;
}

const EMPTY_CONSULT = {
  consult_date: new Date().toISOString().slice(0, 10),
  consult_time: new Date().toTimeString().slice(0, 5),
  pet_id: '', owner_id: '', doctor_id: '',
  appointment_id: null, visit_type: 'OPD',
  chief_complaint: '', temp_celsius: '', weight_kg: '',
  heart_rate: '', resp_rate: '',
  clinical_notes: '', diagnosis: '', advice: '',
  followup_date: '', followup_notes: '', consult_fee: '',
  procedures: []
}

// Convert Fahrenheit → Celsius for storage (backend stores celsius)
const fToC = (f) => f ? ((parseFloat(f) - 32) * 5 / 9).toFixed(2) : ''
// Convert Celsius → Fahrenheit for display
const cToF = (c) => c ? ((parseFloat(c) * 9 / 5) + 32).toFixed(1) : ''

const EMPTY_RX_ITEM = {
  medicine_name: '', dosage_form: '', strength: '',
  dose: '', frequency: '', route: '', duration_days: '',
  instructions: '', quantity: ''
}

export default function ConsultationForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)

  const [form, setForm]           = useState(EMPTY_CONSULT)
  const [rxItems, setRxItems]     = useState([])
  const [rxNotes, setRxNotes]     = useState('')
  const [procedures, setProcedures] = useState([])
  const [procMaster, setProcMaster] = useState([])
  const [pets, setPets]           = useState([])
  const [owners, setOwners]       = useState([])
  const [doctors, setDoctors]     = useState([])
  const [medicines, setMedicines] = useState([])
  const [species, setSpecies]     = useState([])
  const [breeds, setBreeds]       = useState([])
  
  const [saving, setSaving]       = useState(false)
  const [loading, setLoading]     = useState(true)
  const [consultation, setConsultation] = useState(null)
  const [existingRx, setExistingRx]     = useState(null)
  const [activeTab, setActiveTab]       = useState('vitals')
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [showPrint, setShowPrint]       = useState(false)
  
  const [activeSearchIndex, setActiveSearchIndex] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [petsR, ownersR, docsR, procR, medR, specR, breedR] = await Promise.all([
        api.get('/pets').catch(() => ({ data: [] })),
        api.get('/owners').catch(() => ({ data: [] })),
        api.get('/doctors').catch(() => ({ data: [] })),
        api.get('/procedures-master').catch(() => ({ data: [] })),
        api.get('/inventory/medicines').catch(() => ({ data: [] })),
        api.get('/masters/species').catch(() => ({ data: [] })),
        api.get('/masters/breeds').catch(() => ({ data: [] })),
      ])
      setPets(petsR.data)
      setOwners(ownersR.data)
      setDoctors(docsR.data)
      setProcMaster(procR.data)
      setMedicines(medR.data)
      setSpecies(specR.data)
      setBreeds(breedR.data)

      if (isEdit) {
        const c = await api.get(`/consultations/${id}`)
        const data = c.data
        setConsultation(data)
        setForm({
          consult_date: data.consult_date, consult_time: String(data.consult_time || '').slice(0, 5),
          pet_id: String(data.pet_id), owner_id: String(data.owner_id), doctor_id: String(data.doctor_id),
          appointment_id: data.appointment_id, visit_type: data.visit_type,
          chief_complaint: data.chief_complaint || '', temp_celsius: data.temp_celsius ? cToF(data.temp_celsius) : '',
          weight_kg: data.weight_kg || '', heart_rate: data.heart_rate || '', resp_rate: data.resp_rate || '',
          clinical_notes: data.clinical_notes || '', diagnosis: data.diagnosis || '',
          advice: data.advice || '', followup_date: data.followup_date || '',
          followup_notes: data.followup_notes || '', consult_fee: data.consult_fee || '', procedures: []
        })
        const cproc = await api.get(`/consultations/${id}/procedures`).catch(() => ({ data: [] }))
        setProcedures(cproc.data)
        const rx = await api.get(`/prescriptions/consult/${id}`).catch(() => ({ data: [] }))
        if (rx.data.length > 0) {
          const existing = rx.data[0]
          setExistingRx(existing)
          setRxItems(existing.items || [])
          setRxNotes(existing.notes || '')
        }
      } else {
        const apptId  = searchParams.get('appt_id')
        const petId   = searchParams.get('pet_id')
        const ownerId = searchParams.get('owner_id')
        const docId   = searchParams.get('doctor_id')
        
        let initialForm = {
          ...EMPTY_CONSULT,
          appointment_id: apptId ? parseInt(apptId) : null,
          pet_id:    petId   || '',
          owner_id:  ownerId || '',
          doctor_id: docId   || '',
        }
        
        // Auto-fetch appointment time
        if (apptId) {
            try {
                const apptRes = await api.get(`/appointments`);
                const matchedAppt = apptRes.data.find(a => a.appt_id === parseInt(apptId));
                if (matchedAppt) {
                    initialForm.consult_date = matchedAppt.appt_date;
                    initialForm.consult_time = String(matchedAppt.appt_time || '').slice(0, 5);
                }
            } catch(e) {}
        }
        
        setForm(initialForm)
        
        if (docId) {
          const doc = docsR.data.find(d => d.doctor_id === parseInt(docId))
          if (doc?.consultation_fee) setForm(f => ({ ...f, consult_fee: doc.consultation_fee }))
        }
      }
    } finally { setLoading(false) }
  }, [id, isEdit, searchParams])

  useEffect(() => { load() }, [load])

  const handlePetChange = (e) => {
    const pid = parseInt(e.target.value)
    const pet = pets.find(p => p.pet_id === pid)
    setForm(f => ({ ...f, pet_id: e.target.value, owner_id: pet?.owner_id?.toString() || f.owner_id }))
  }

  const handleDocChange = (e) => {
    const doc = doctors.find(d => d.doctor_id === parseInt(e.target.value))
    setForm(f => ({ ...f, doctor_id: e.target.value, consult_fee: doc?.consultation_fee || f.consult_fee }))
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const addProcedure = (procId) => {
    const proc = procMaster.find(p => p.procedure_id === parseInt(procId))
    if (!proc) return
    if (procedures.find(p => p.procedure_id === proc.procedure_id)) return
    setProcedures(prev => [...prev, { procedure_id: proc.procedure_id, procedure_name: proc.procedure_name, fee: proc.fee, quantity: 1 }])
  }

  const removeProcedure = (idx) => setProcedures(prev => prev.filter((_, i) => i !== idx))

  const addRxItem  = () => setRxItems(prev => [...prev, { ...EMPTY_RX_ITEM }])
  const removeItem = (idx) => setRxItems(prev => prev.filter((_, i) => i !== idx))
  
  const setItem = (idx, key, val) => {
    setRxItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [key]: val };
      
      // Auto-calculate quantity if dose, frequency, or days changes
      if (['dose', 'frequency', 'duration_days'].includes(key)) {
        updated.quantity = calculateQty(updated.dose, updated.frequency, updated.duration_days);
      }
      return updated;
    }))
  }
  
  const selectMedicine = (idx, med) => {
      setRxItems(prev => prev.map((item, i) => {
          if (i !== idx) return item;
          const updated = {
              ...item,
              medicine_name: med.medicine_name,
              dosage_form: med.dosage_form || '',
              strength: med.strength || '',
          };
          updated.quantity = calculateQty(updated.dose, updated.frequency, updated.duration_days);
          return updated;
      }));
      setActiveSearchIndex(null);
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.pet_id || !form.doctor_id) return toast.error('Pet and Doctor are required')
    setSaving(true)
    try {
      // Append :00 to time to satisfy Pydantic fully if missing
      const cTime = form.consult_time.length === 5 ? form.consult_time + ':00' : form.consult_time;
      
      const payload = {
        consult_date: form.consult_date,
        consult_time: cTime,
        appointment_id: form.appointment_id ? parseInt(form.appointment_id) : null,
        pet_id:       parseInt(form.pet_id) || 0,
        owner_id:     parseInt(form.owner_id) || 0,
        doctor_id:    parseInt(form.doctor_id) || 0,
        visit_type:   form.visit_type || 'OPD',
        chief_complaint: form.chief_complaint || null,
        temp_celsius: form.temp_celsius ? parseFloat(fToC(form.temp_celsius)) : null,
        weight_kg:    form.weight_kg    ? parseFloat(form.weight_kg)    : null,
        heart_rate:   form.heart_rate && !isNaN(form.heart_rate) ? parseInt(form.heart_rate) : null,
        resp_rate:    form.resp_rate && !isNaN(form.resp_rate) ? parseInt(form.resp_rate) : null,
        clinical_notes: form.clinical_notes || null,
        diagnosis:      form.diagnosis || null,
        advice:         form.advice || null,
        followup_date:  form.followup_date || null,
        followup_notes: form.followup_notes || null,
        consult_fee:    form.consult_fee ? parseFloat(form.consult_fee) : 0,
        procedures: (procedures || []).map(p => ({ procedure_id: p.procedure_id, quantity: p.quantity || 1, fee: p.fee }))
      }
      let consultId = id
      if (isEdit) {
        await api.put(`/consultations/${id}`, payload)
        toast.success('Consultation updated!')
      } else {
        const r = await api.post('/consultations', payload)
        consultId = r.data.consult_id
        setConsultation(r.data)
        toast.success('Consultation saved!')
        navigate(`/consultations/${consultId}`, { replace: true })
      }

      if (rxItems.length > 0) {
        const rxPayload = {
          consult_id: parseInt(consultId), pet_id: parseInt(form.pet_id),
          owner_id: parseInt(form.owner_id), doctor_id: parseInt(form.doctor_id),
          notes: rxNotes, items: rxItems.filter(i => i.medicine_name)
        }
        if (existingRx) {
          await api.put(`/prescriptions/${existingRx.prescription_id}`, rxPayload)
        } else {
          const rxR = await api.post('/prescriptions', rxPayload)
          setExistingRx(rxR.data)
        }
        toast.success('Prescription saved!')
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Save failed')
    } finally { setSaving(false) }
  }

  const handleDownloadPdf = async () => {
    if (!existingRx) return
    setDownloadingPdf(true)
    try {
      const response = await api.get(`/prescriptions/${existingRx.prescription_id}/pdf`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `Prescription_${existingRx.rx_no}.pdf`)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      toast.error('Failed to generate PDF')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const handleClose = async () => {
    if (!confirm('Close this consultation? This cannot be undone.')) return
    try {
      await api.put(`/consultations/${id}/close`)
      toast.success('Consultation closed!'); load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>
  )

  const isClosed = consultation?.status === 'Closed' || consultation?.status === 'Billed'
  
  const selectedPet = form.pet_id ? pets.find(p => p.pet_id === parseInt(form.pet_id)) : null
  const petSpecies = selectedPet ? species.find(s => s.species_id === selectedPet.species_id)?.species_name : ''
  const petBreed = selectedPet ? breeds.find(b => b.breed_id === selectedPet.breed_id)?.breed_name : ''
  const petAge = selectedPet ? `${selectedPet.age_years || 0}y ${selectedPet.age_months || 0}m` : ''

  return (
    <div className="max-w-4xl space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">
            {isEdit ? `Consultation — ${consultation?.consult_no || ''}` : 'New Consultation / OPD'}
          </h2>
          {isClosed && <span className="badge bg-green-100 text-green-700 mt-1">Closed</span>}
        </div>
        <div className="flex gap-2">
          {existingRx && (
            <button 
              type="button"
              onClick={() => setShowPrint(true)}
              className="btn-secondary flex items-center gap-2 text-primary-600"
            >
              <Printer size={15} /> Print Rx
            </button>
          )}
          {isEdit && !isClosed && (
            <button type="button" onClick={handleClose} className="btn-secondary flex items-center gap-2 text-green-600">
              <CheckCircle size={15} /> Close Consultation
            </button>
          )}
          {!isClosed && (
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save size={15} /> {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <form onSubmit={handleSave}>
        <div className="card mb-4">
          <h3 className="font-semibold text-slate-700 mb-4 text-sm">Patient Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="label">Pet *</label>
              <select className="input-field" value={form.pet_id} onChange={handlePetChange} disabled={isClosed}>
                <option value="">Select Pet</option>
                {pets.map(p => <option key={p.pet_id} value={p.pet_id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Owner</label>
              <select className="input-field" value={form.owner_id} onChange={set('owner_id')} disabled={isClosed}>
                <option value="">Select Owner</option>
                {owners.map(o => <option key={o.owner_id} value={o.owner_id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Doctor *</label>
              <select className="input-field" value={form.doctor_id} onChange={handleDocChange} disabled={isClosed}>
                <option value="">Select Doctor</option>
                {doctors.map(d => <option key={d.doctor_id} value={d.doctor_id}>Dr. {d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Date</label>
              <input className="input-field" type="date" value={form.consult_date} onChange={set('consult_date')} disabled={isClosed} />
            </div>
            <div>
              <label className="label">Time</label>
              <input className="input-field" type="time" value={form.consult_time} onChange={set('consult_time')} disabled={isClosed} />
            </div>
            <div>
              <label className="label">Visit Type</label>
              <select className="input-field" value={form.visit_type} onChange={set('visit_type')} disabled={isClosed}>
                {VISIT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          
          {selectedPet && (
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl grid grid-cols-2 md:grid-cols-4 gap-4">
                <div><span className="text-[10px] uppercase font-bold text-slate-400">Species</span><p className="text-sm font-semibold text-slate-700">{petSpecies || 'Unknown'}</p></div>
                <div><span className="text-[10px] uppercase font-bold text-slate-400">Breed</span><p className="text-sm font-semibold text-slate-700">{petBreed || 'Unknown'}</p></div>
                <div><span className="text-[10px] uppercase font-bold text-slate-400">Age</span><p className="text-sm font-semibold text-slate-700">{petAge}</p></div>
                <div><span className="text-[10px] uppercase font-bold text-slate-400">Sex</span><p className="text-sm font-semibold text-slate-700">{selectedPet.gender || 'Unknown'}</p></div>
            </div>
          )}
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit mb-4">
          {['vitals', 'notes', 'procedures', 'prescription', 'followup'].map(t => (
            <button key={t} type="button" onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                activeTab === t ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {activeTab === 'vitals' && (
          <div className="card space-y-4">
            <div>
              <label className="label">Chief Complaint</label>
              <textarea className="input-field resize-none" rows={2} value={form.chief_complaint} onChange={set('chief_complaint')} disabled={isClosed} placeholder="What brings the patient today?" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><label className="label">Temp (°F)</label><input className="input-field" type="number" step="0.1" value={form.temp_celsius} onChange={set('temp_celsius')} disabled={isClosed} placeholder="101.3" /></div>
              <div><label className="label">Weight (kg)</label><input className="input-field" type="number" step="0.1" value={form.weight_kg} onChange={set('weight_kg')} disabled={isClosed} /></div>
              <div><label className="label">Heart Rate (bpm)</label><input className="input-field" type="number" value={form.heart_rate} onChange={set('heart_rate')} disabled={isClosed} /></div>
              <div><label className="label">Resp Rate</label><input className="input-field" type="number" value={form.resp_rate} onChange={set('resp_rate')} disabled={isClosed} /></div>
            </div>
            <div><label className="label">Consultation Fee (₹)</label><input className="input-field w-40" type="number" value={form.consult_fee} onChange={set('consult_fee')} disabled={isClosed} /></div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="card space-y-4">
            <div><label className="label">Clinical Notes / Examination Findings</label><textarea className="input-field resize-none" rows={4} value={form.clinical_notes} onChange={set('clinical_notes')} disabled={isClosed} placeholder="Physical examination findings, observations..." /></div>
            <div><label className="label">Diagnosis</label><textarea className="input-field resize-none" rows={3} value={form.diagnosis} onChange={set('diagnosis')} disabled={isClosed} placeholder="Provisional or confirmed diagnosis..." /></div>
            <div><label className="label">Advice / Treatment Plan</label><textarea className="input-field resize-none" rows={2} value={form.advice} onChange={set('advice')} disabled={isClosed} placeholder="Rest, diet, activity restrictions..." /></div>
          </div>
        )}

        {activeTab === 'procedures' && (
          <div className="card space-y-4">
            {!isClosed && (
              <div className="flex items-center gap-3">
                <select className="input-field w-64" defaultValue=""
                  onChange={e => { addProcedure(e.target.value); e.target.value = '' }}>
                  <option value="" disabled>+ Add Procedure</option>
                  {procMaster.map(p => <option key={p.procedure_id} value={p.procedure_id}>{p.procedure_name} — ₹{p.fee}</option>)}
                </select>
              </div>
            )}
            {procedures.length === 0 ? (
              <p className="text-slate-400 text-sm">No procedures added.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100">
                  <th className="table-th">Procedure</th><th className="table-th">Qty</th><th className="table-th">Fee</th>{!isClosed && <th className="table-th"></th>}
                </tr></thead>
                <tbody>
                  {procedures.map((p, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="table-td">{p.procedure_name}</td>
                      <td className="table-td w-20"><input className="input-field py-1 text-xs" type="number" value={p.quantity} min={1} disabled={isClosed} onChange={e => setProcedures(prev => prev.map((x, j) => j === i ? { ...x, quantity: parseInt(e.target.value) } : x))} /></td>
                      <td className="table-td">₹{(p.fee * (p.quantity || 1)).toLocaleString()}</td>
                      {!isClosed && <td className="table-td"><button type="button" onClick={() => removeProcedure(i)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>}
                    </tr>
                  ))}
                  <tr><td colSpan={2} className="table-td font-semibold">Total</td><td className="table-td font-bold text-primary-600">₹{procedures.reduce((s, p) => s + (p.fee * (p.quantity || 1)), 0).toLocaleString()}</td></tr>
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'prescription' && (
          <div className="card space-y-4 overflow-visible">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                <FileText size={16} className="text-primary-500" />
                E-Prescription {existingRx && <span className="badge bg-blue-100 text-blue-600 text-xs">{existingRx.rx_no}</span>}
              </h3>
              {!isClosed && <button type="button" onClick={addRxItem} className="btn-secondary flex items-center gap-1 text-xs"><Plus size={13} />Add Medicine</button>}
            </div>

            {/* Chief Complaint banner — split on newlines so each complaint shows on its own line */}
            {form.chief_complaint && (
              <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 block mb-1">Chief Complaint</span>
                <ul className="space-y-0.5">
                  {form.chief_complaint.split('\n').map((line, idx) => line.trim()).filter(Boolean).map((line, idx) => (
                    <li key={idx} className="text-sm text-amber-900 font-medium leading-snug flex items-start gap-1.5">
                      <span className="text-amber-400 mt-0.5 shrink-0">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rxItems.length === 0 ? (
              <p className="text-slate-400 text-sm">No medicines prescribed yet.</p>
            ) : (
              <div className="space-y-3">
                {rxItems.map((item, i) => (
                  <div key={i} className="border border-slate-100 rounded-xl p-3 bg-slate-50/50 relative">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                      <div className="md:col-span-2 relative">
                        <label className="label">Medicine Name *</label>
                        <input className="input-field py-1.5 text-xs" value={item.medicine_name} 
                            onChange={e => {
                                setItem(i, 'medicine_name', e.target.value);
                                if (e.target.value.length >= 2) setActiveSearchIndex(i);
                                else setActiveSearchIndex(null);
                            }} 
                            disabled={isClosed} placeholder="e.g. Amoxicillin" 
                            onFocus={() => { if (item.medicine_name.length >= 2) setActiveSearchIndex(i) }}
                            onBlur={() => setTimeout(() => setActiveSearchIndex(null), 200)}
                        />
                        {activeSearchIndex === i && item.medicine_name.length >= 2 && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                {medicines.filter(m => m.medicine_name.toLowerCase().includes(item.medicine_name.toLowerCase())).map(m => (
                                    <div key={m.medicine_id} className="p-2 hover:bg-slate-50 cursor-pointer text-sm flex flex-col"
                                         onMouseDown={() => selectMedicine(i, m)}>
                                        <span className="font-semibold text-slate-800">{m.medicine_name}</span>
                                        <span className="text-[10px] text-slate-500">Stock: {m.current_stock || 0}</span>
                                    </div>
                                ))}
                                {medicines.filter(m => m.medicine_name.toLowerCase().includes(item.medicine_name.toLowerCase())).length === 0 && (
                                    <div className="p-2 text-xs text-slate-400 bg-slate-50 rounded-b-lg">No matching medicines in Master</div>
                                )}
                            </div>
                        )}
                      </div>
                      <div><label className="label">Form</label>
                        <select className="input-field py-1.5 text-xs" value={item.dosage_form} onChange={e => setItem(i, 'dosage_form', e.target.value)} disabled={isClosed}>
                          <option value="">-</option>{FORM_OPTIONS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      <div><label className="label">Strength</label><input className="input-field py-1.5 text-xs" value={item.strength} onChange={e => setItem(i, 'strength', e.target.value)} disabled={isClosed} placeholder="250mg" /></div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <div><label className="label">Dose</label><input className="input-field py-1.5 text-xs" value={item.dose} onChange={e => setItem(i, 'dose', e.target.value)} disabled={isClosed} placeholder="1 tab" /></div>
                      <div><label className="label">Frequency</label>
                        <select className="input-field py-1.5 text-xs" value={item.frequency} onChange={e => setItem(i, 'frequency', e.target.value)} disabled={isClosed}>
                          <option value="">-</option>{FREQ_OPTIONS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      <div><label className="label">Route</label>
                        <select className="input-field py-1.5 text-xs" value={item.route} onChange={e => setItem(i, 'route', e.target.value)} disabled={isClosed}>
                          <option value="">-</option>{ROUTE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      <div><label className="label">Days</label><input className="input-field py-1.5 text-xs" type="number" value={item.duration_days} onChange={e => setItem(i, 'duration_days', e.target.value)} disabled={isClosed} placeholder="5" /></div>
                      <div><label className="label">Qty</label><input className="input-field py-1.5 text-xs" type="number" value={item.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} disabled={isClosed} /></div>
                    </div>
                    <div className="mt-2 flex items-end gap-2">
                      <div className="flex-1">
                        <label className="label">Instructions</label>
                        <select className="input-field py-1.5 text-xs" value={item.instructions} onChange={e => setItem(i, 'instructions', e.target.value)} disabled={isClosed}>
                          <option value="">— Select instruction —</option>
                          {INSTRUCTION_OPTIONS.map(o => <option key={o}>{o}</option>)}
                        </select>
                      </div>
                      {!isClosed && <button type="button" onClick={() => removeItem(i)} className="p-1.5 text-red-400 hover:text-red-600 mb-0.5"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div><label className="label">General Instructions (Rx Notes)</label><textarea className="input-field resize-none" rows={2} value={rxNotes} onChange={e => setRxNotes(e.target.value)} disabled={isClosed} placeholder="Rest for 5 days. Avoid bathing. Revisit if condition worsens." /></div>
          </div>
        )}

        {activeTab === 'followup' && (
          <div className="card space-y-4">
            <div><label className="label">Follow-up Date</label><input className="input-field w-48" type="date" value={form.followup_date} onChange={set('followup_date')} disabled={isClosed} /></div>
            <div><label className="label">Follow-up Notes</label><textarea className="input-field resize-none" rows={3} value={form.followup_notes} onChange={set('followup_notes')} disabled={isClosed} placeholder="Instructions for next visit..." /></div>
          </div>
        )}
      </form>

      {/* Prescription Print Modal */}
      {showPrint && existingRx && (
        <PrescriptionPrint
          consultation={{
            ...consultation,
            doctor_id:      parseInt(form.doctor_id) || consultation?.doctor_id,
            temp_fahrenheit: form.temp_celsius,   // form stores °F value in temp_celsius field
            temp_celsius:    form.temp_celsius ? fToC(form.temp_celsius) : null,
            weight_kg:       form.weight_kg,
            heart_rate:      form.heart_rate,
            resp_rate:       form.resp_rate,
            chief_complaint: form.chief_complaint,
            diagnosis:       form.diagnosis,
            advice:          form.advice,
            followup_date:   form.followup_date,
          }}
          rxData={existingRx}
          pet={selectedPet}
          owner={owners.find(o => o.owner_id === parseInt(form.owner_id))}
          species={petSpecies}
          breed={petBreed}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  )
}
