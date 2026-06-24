import React, { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { 
  Plus, Trash2, Save, User, PawPrint, Stethoscope, 
  Search, History, Printer, Edit2, X, Info, Filter,
  Calendar, ShoppingBag, ArrowRight, CheckCircle2
} from 'lucide-react'
import api from '../api'
import SalesBillPrint from '../components/SalesBillPrint'

const EMPTY_LINE = { 
  id: Date.now(), 
  line_type: 'Medicine', 
  medicine_id: '', 
  batch_id: '', 
  procedure_id: '', 
  qty: 1, 
  rate: 0, 
  discount_pct: 0 
}

export default function SalesBill() {
  const [activeTab, setActiveTab] = useState('new')
  const [owners, setOwners] = useState([])
  const [pets, setPets] = useState([])
  const [doctors, setDoctors] = useState([])
  const [medicines, setMedicines] = useState([])
  const [procedures, setProcedures] = useState([])
  const [batches, setBatches] = useState({}) 
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingBillId, setEditingBillId] = useState(null)
  const [searchNo, setSearchNo] = useState('')
  const [showPrint, setShowPrint] = useState(false)
  const [printBillData, setPrintBillData] = useState(null)
  const [withGst, setWithGst] = useState(true)   // GST toggle — false = no tax applied
  const [petPrescriptions, setPetPrescriptions] = useState([])
  const [showRxPicker, setShowRxPicker] = useState(false)

  const [form, setForm] = useState({
    bill_date: new Date().toISOString().split('T')[0],
    owner_id: '',
    pet_id: '',
    doctor_id: '',
    payment_mode: 'Cash',
    notes: '',
    items: [{ ...EMPTY_LINE }]
  })

  useEffect(() => {
    fetchMasters()
  }, [])

  useEffect(() => {
    if (activeTab === 'history') fetchHistory()
  }, [activeTab])

  const fetchMasters = async () => {
    try {
      const [o, d, m, p] = await Promise.all([
        api.get('/owners'),
        api.get('/doctors'),
        api.get('/inventory/medicines'),
        api.get('/services/procedures')
      ])
      setOwners(o.data)
      setDoctors(d.data)
      setMedicines(m.data)
      setProcedures(p.data)
    } catch (err) { toast.error('Error loading master data') }
  }

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const r = await api.get('/billing/sales/')
      setHistory(r.data)
    } catch (err) { toast.error('Error loading history') }
    finally { setLoading(false) }
  }

  const fetchOwnerPets = async (id) => {
    try {
      const res = await api.get(`/pets?owner_id=${id}`)
      setPets(res.data)
    } catch (err) { console.error(err) }
  }

  const fetchMedicineBatches = async (medId) => {
    if (batches[medId]) return
    try {
      const res = await api.get(`/inventory/batches/${medId}`)
      setBatches(prev => ({ ...prev, [medId]: res.data }))
    } catch (err) { console.error(err) }
  }

  // Fetch all prescriptions for a pet so the user can pull prescribed meds into the bill.
  const loadPrescriptionsForPet = async (petId) => {
    if (!petId) { setPetPrescriptions([]); return }
    try {
      const res = await api.get(`/prescriptions/pet/${petId}`)
      // Newest first, and only prescriptions that actually have medicine items.
      const rxs = (res.data || []).filter(rx => rx.items && rx.items.length > 0)
      setPetPrescriptions(rxs)
    } catch (err) { setPetPrescriptions([]) }
  }

  // Map a prescription item to a product in the medicines master:
  // prefer the linked medicine_id, otherwise fall back to a case-insensitive name match.
  const resolveMedicine = (rxItem) => {
    if (rxItem.medicine_id) {
      const byId = medicines.find(m => m.medicine_id === rxItem.medicine_id)
      if (byId) return byId
    }
    const name = (rxItem.medicine_name || '').trim().toLowerCase()
    return medicines.find(m => (m.medicine_name || '').trim().toLowerCase() === name) || null
  }

  // Pull the prescribed medicines of one prescription into the bill as line items.
  // Product name is pre-filled; the user picks the batch (which sets the rate) and qty.
  const applyPrescription = (rx) => {
    const newLines = []
    const unmatched = []
    rx.items.forEach(it => {
      const med = resolveMedicine(it)
      if (!med) { unmatched.push(it.medicine_name); return }
      fetchMedicineBatches(med.medicine_id)
      newLines.push({
        ...EMPTY_LINE,
        id: Date.now() + Math.random(),
        line_type: 'Medicine',
        medicine_id: String(med.medicine_id),
        batch_id: 'auto',                              // FEFO by default; user can override
        qty: it.quantity ? parseFloat(it.quantity) : 1, // editable default
        rate: 0,                                        // set per batch on split / save
        discount_pct: 0,
        gst_pct: med.gst_pct,
      })
    })

    if (newLines.length === 0) {
      toast.error('None of the prescribed medicines matched a product in inventory')
      return
    }

    setForm(f => {
      // Drop the blank starter line, keep any lines the user already filled.
      const kept = f.items.filter(l => l.medicine_id || l.procedure_id)
      return { ...f, items: [...kept, ...newLines] }
    })

    if (unmatched.length) {
      toast(`Loaded ${newLines.length}. No product match for: ${unmatched.join(', ')}`, { icon: '⚠️', duration: 5000 })
    } else {
      toast.success(`Loaded ${newLines.length} prescribed medicine(s) — select batch & qty`)
    }
    setShowRxPicker(false)
  }

  const addLine = () => setForm(f => ({ ...f, items: [...f.items, { ...EMPTY_LINE, id: Date.now() }] }))
  const removeLine = (id) => setForm(f => ({ ...f, items: f.items.filter(l => l.id !== id) }))

  const updateLine = (id, field, value) => {
    const newItems = form.items.map(l => {
      if (l.id !== id) return l
      const updated = { ...l, [field]: value }
      if (field === 'medicine_id' && value) {
        fetchMedicineBatches(value)
        const med = medicines.find(m => m.medicine_id === parseInt(value))
        if(med) updated.gst_pct = med.gst_pct
        updated.batch_id = 'auto'   // default to FEFO auto-allocation
        updated.rate = 0
      }
      if (field === 'batch_id' && value) {
        const batch = batches[l.medicine_id]?.find(b => b.batch_id === parseInt(value))
        if (batch) updated.rate = batch.sale_price
      }
      if (field === 'procedure_id' && value) {
        const proc = procedures.find(p => p.procedure_id === parseInt(value))
        if (proc) {
          updated.rate = proc.fee
          updated.gst_pct = proc.gst_pct
        }
      }
      return updated
    })
    setForm({ ...form, items: newItems })
  }

  // Total stock for a medicine across all its batches.
  const totalAvailable = (medId) =>
    (batches[medId] || []).reduce((s, b) => s + parseFloat(b.current_qty || 0), 0)

  // FEFO allocation: split `qty` across a medicine's batches, earliest expiry first.
  // Returns { lines } or { error } if there isn't enough total stock.
  const allocateFEFO = (medId, qty, base = {}) => {
    const list = (batches[medId] || [])
      .filter(b => parseFloat(b.current_qty) > 0)
      .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date))
    const total = list.reduce((s, b) => s + parseFloat(b.current_qty), 0)
    let remaining = parseFloat(qty) || 0
    if (remaining <= 0) return { error: 'Enter a quantity first' }
    if (remaining > total) {
      const name = medicines.find(m => m.medicine_id === parseInt(medId))?.medicine_name || 'medicine'
      return { error: `Only ${total} of ${name} in stock across ${list.length} batch(es)` }
    }
    const lines = []
    for (const b of list) {
      if (remaining <= 0) break
      const take = Math.min(remaining, parseFloat(b.current_qty))
      lines.push({
        ...EMPTY_LINE,
        ...base,
        id: Date.now() + Math.random(),
        line_type: 'Medicine',
        medicine_id: String(medId),
        batch_id: String(b.batch_id),
        qty: take,
        rate: parseFloat(b.sale_price) || 0,
      })
      remaining -= take
    }
    return { lines }
  }

  // Replace one "Auto" line in-place with its concrete per-batch lines.
  const autoAllocateLine = (lineId) => {
    const l = form.items.find(x => x.id === lineId)
    if (!l || !l.medicine_id) return toast.error('Select a medicine first')
    const { lines, error } = allocateFEFO(l.medicine_id, l.qty, { discount_pct: l.discount_pct, gst_pct: l.gst_pct })
    if (error) return toast.error(error)
    setForm(f => {
      const idx = f.items.findIndex(x => x.id === lineId)
      const items = [...f.items]
      items.splice(idx, 1, ...lines)
      return { ...f, items }
    })
    toast.success(`Split across ${lines.length} batch${lines.length > 1 ? 'es' : ''} (earliest expiry first)`)
  }

  const calculateGstSummary = () => {
    if (!withGst) return []   // No GST slabs when billing without GST
    const slabs = {}
    form.items.forEach(l => {
      const gross = (parseFloat(l.rate) || 0) * (parseFloat(l.qty) || 0)
      const disc = gross * ((parseFloat(l.discount_pct) || 0) / 100)
      const taxable = gross - disc
      const gstPct = parseFloat(l.gst_pct) || 18
      const taxAmount = taxable * (gstPct / 100)
      
      if (!slabs[gstPct]) slabs[gstPct] = { gstPct, taxable: 0, taxAmount: 0, net: 0 }
      slabs[gstPct].taxable += taxable
      slabs[gstPct].taxAmount += taxAmount
      slabs[gstPct].net += (taxable + taxAmount)
    })
    return Object.values(slabs).sort((a,b) => b.gstPct - a.gstPct)
  }

  const calculateTotals = () => {
    if (!withGst) {
      // Without GST: grand total = sum of (rate × qty × (1 - discount%))
      const grandTotal = form.items.reduce((acc, l) => {
        const gross = (parseFloat(l.rate) || 0) * (parseFloat(l.qty) || 0)
        const disc = gross * ((parseFloat(l.discount_pct) || 0) / 100)
        return acc + (gross - disc)
      }, 0)
      return { subtotal: grandTotal, totalTax: 0, grandTotal: Math.round(grandTotal) }
    }
    const summary = calculateGstSummary()
    const subtotal = summary.reduce((acc, s) => acc + s.taxable, 0)
    const totalTax = summary.reduce((acc, s) => acc + s.taxAmount, 0)
    return { subtotal, totalTax, grandTotal: Math.round(subtotal + totalTax) }
  }

  const handleSave = async () => {
    if (!form.owner_id) return toast.error('Please select an Owner')
    if (form.items.some(l => (l.line_type==='Medicine' && (!l.medicine_id || !l.batch_id)) || (l.line_type==='Procedure' && !l.procedure_id))) {
      return toast.error('Each line needs a product (and batch / Auto) selected')
    }

    // Expand any remaining "Auto (FEFO)" medicine lines into concrete per-batch lines.
    let expandedItems = []
    for (const l of form.items) {
      if (l.line_type === 'Medicine' && l.batch_id === 'auto') {
        const { lines, error } = allocateFEFO(l.medicine_id, l.qty, { discount_pct: l.discount_pct, gst_pct: l.gst_pct })
        if (error) return toast.error(error)
        expandedItems.push(...lines)
      } else {
        expandedItems.push(l)
      }
    }

    setSaving(true)
    try {
      // Format items for backend
      const items = expandedItems.map((l, idx) => ({
        line_no: idx + 1,
        line_type: l.line_type,
        medicine_id: l.medicine_id ? parseInt(l.medicine_id) : null,
        batch_id: l.batch_id ? parseInt(l.batch_id) : null,
        procedure_id: l.procedure_id ? parseInt(l.procedure_id) : null,
        qty: parseFloat(l.qty),
        rate: parseFloat(l.rate),
        discount_pct: parseFloat(l.discount_pct)
      }))

      const payload = { ...form, with_gst: withGst, items }

      let savedBill = null
      if (editingBillId) {
        const res = await api.put(`/billing/sales/${editingBillId}`, payload)
        toast.success('Bill updated successfully!')
        savedBill = res.data
      } else {
        const res = await api.post('/billing/sales/confirm', payload)
        toast.success(`Bill Generated: ${res.data.bill_number}`)
        savedBill = res.data
      }
      resetForm()
      if (savedBill) {
        setPrintBillData(savedBill)
        setShowPrint(true)
      }
      setActiveTab('history')
    } catch (err) {
      const detail = err.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map(e => `${e.loc?.slice(-1)[0] ?? ''}: ${e.msg}`).join('; ')
        : (typeof detail === 'string' ? detail : 'Error saving bill')
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const resetForm = () => {
    setForm({
      bill_date: new Date().toISOString().split('T')[0],
      owner_id: '',
      pet_id: '',
      doctor_id: '',
      payment_mode: 'Cash',
      notes: '',
      items: [{ ...EMPTY_LINE }]
    })
    setEditingBillId(null)
    setPetPrescriptions([])
    setShowRxPicker(false)
  }

  const handleEdit = (bill) => {
    setEditingBillId(bill.bill_id)
    setForm({
      bill_date: bill.bill_date,
      owner_id: bill.owner_id,
      pet_id: bill.pet_id || '',
      doctor_id: bill.doctor_id || '',
      payment_mode: bill.payment_mode || 'Cash',
      notes: bill.notes || '',
      items: bill.items.map(i => ({
        id: i.item_id,
        line_type: i.line_type,
        medicine_id: i.medicine_id || '',
        batch_id: i.batch_id || '',
        procedure_id: i.procedure_id || '',
        qty: i.qty,
        rate: i.rate,
        discount_pct: i.discount_pct
      }))
    })
    if (bill.owner_id) fetchOwnerPets(bill.owner_id)
    if (bill.pet_id) loadPrescriptionsForPet(bill.pet_id)
    bill.items.forEach(i => { if(i.medicine_id) fetchMedicineBatches(i.medicine_id) })
    setActiveTab('new')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this bill and reverse stock?')) return
    try {
      await api.delete(`/billing/sales/${id}`)
      toast.success('Bill deleted')
      fetchHistory()
    } catch (err) { toast.error('Error deleting bill') }
  }

  const searchBill = async () => {
    if (!searchNo) return
    try {
      const res = await api.get(`/billing/sales/by-number/${searchNo}`)
      handleEdit(res.data)
    } catch (err) { toast.error('Bill not found') }
  }

  const { subtotal, totalTax, grandTotal } = calculateTotals()

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <ShoppingBag size={24} />
            </div>
            {editingBillId ? 'Edit Sales Bill' : 'Sales & Retail Billing'}
          </h1>
          <p className="text-sm text-slate-500 font-medium ml-12">
            {editingBillId ? `Updating Bill: ${editingBillId}` : 'Tax-compliant retail invoice engine'}
          </p>
        </div>

        <div className="flex bg-slate-100 p-1 rounded-xl w-fit shadow-inner">
          <button 
            onClick={() => setActiveTab('new')}
            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'new' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            {editingBillId ? <Edit2 size={14}/> : <Plus size={14}/>} {editingBillId ? 'Edit Mode' : 'New Bill'}
          </button>
          <button 
            onClick={() => { setActiveTab('history'); resetForm(); }}
            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}
          >
            <History size={14}/> History
          </button>
        </div>
      </div>

      {activeTab === 'new' ? (
        <div className="grid grid-cols-1 gap-6">
          <div className="card shadow-xl border-t-4 border-indigo-600">
            {/* INVOICE SEARCH BAR */}
            <div className="mb-8 p-4 bg-slate-50 rounded-2xl flex items-center gap-4 border border-slate-200 border-dashed">
              <div className="text-xs font-black text-slate-400 uppercase w-32">Quick Search:</div>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
                <input 
                  className="input-field pl-10 h-10 text-sm font-bold bg-white" 
                  placeholder="Enter Bill Number (e.g. SB-001) and press Enter..." 
                  value={searchNo}
                  onChange={e => setSearchNo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchBill()}
                />
              </div>
              <button 
                onClick={searchBill}
                className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-tighter rounded-lg hover:bg-black transition-all"
              >
                Load Bill
              </button>
            </div>

            {/* SELECTIONS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8 border-b border-slate-100 pb-8">
              <div>
                <label className="label flex items-center gap-2"><User size={14}/> Pet Owner *</label>
                <select className="input-field h-11 font-bold text-sm" value={form.owner_id} onChange={e => { setForm({...form, owner_id: e.target.value}); fetchOwnerPets(e.target.value); }}>
                  <option value="">Choose Owner...</option>
                  {owners.map(o => <option key={o.owner_id} value={o.owner_id}>{o.name} ({o.phone})</option>)}
                </select>
              </div>
              <div>
                <label className="label flex items-center gap-2"><PawPrint size={14}/> Pet Name</label>
                <select className="input-field h-11 text-sm font-bold" value={form.pet_id} onChange={e => { setForm({...form, pet_id: e.target.value}); loadPrescriptionsForPet(e.target.value); }}>
                  <option value="">Select Pet...</option>
                  {pets.map(p => <option key={p.pet_id} value={p.pet_id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label flex items-center gap-2"><Stethoscope size={14}/> Doctor Name</label>
                <select className="input-field h-11 text-sm font-bold" value={form.doctor_id} onChange={e => setForm({...form, doctor_id: e.target.value})}>
                  <option value="">Select Doctor...</option>
                  {doctors.map(d => <option key={d.doctor_id} value={d.doctor_id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label flex items-center gap-2"><Calendar size={14}/> Bill Date</label>
                <input type="date" className="input-field h-11 font-bold" value={form.bill_date} onChange={e => setForm({...form, bill_date: e.target.value})} />
              </div>
            </div>

            {/* GST / NON-GST TOGGLE */}
            <div className="mb-6 flex items-center gap-4 p-3 bg-slate-50 rounded-2xl border border-slate-100">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Billing Mode:</span>
              <div className="flex bg-white rounded-xl p-0.5 border border-slate-200 shadow-inner">
                <button
                  type="button"
                  onClick={() => setWithGst(true)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                    withGst ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  With GST
                </button>
                <button
                  type="button"
                  onClick={() => setWithGst(false)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                    !withGst ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Without GST
                </button>
              </div>
              {!withGst && (
                <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-1 rounded-lg border border-emerald-200">
                  ✓ Tax-exempt billing — only sale price used
                </span>
              )}
            </div>

            {/* LOAD FROM PRESCRIPTION */}
            {form.pet_id && (
              <div className="mb-6">
                {petPrescriptions.length === 0 ? (
                  <div className="text-[11px] text-slate-400 font-bold italic flex items-center gap-2">
                    <Info size={14} /> No prescriptions found for this pet.
                  </div>
                ) : (
                  <div className="bg-violet-50 border border-violet-100 rounded-2xl p-4">
                    <button
                      type="button"
                      onClick={() => setShowRxPicker(s => !s)}
                      className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-violet-700 hover:text-violet-900 transition-colors"
                    >
                      <Stethoscope size={16} />
                      Load from Prescription ({petPrescriptions.length})
                      <ArrowRight size={14} className={`transition-transform ${showRxPicker ? 'rotate-90' : ''}`} />
                    </button>

                    {showRxPicker && (
                      <div className="mt-4 space-y-2">
                        {petPrescriptions.map(rx => (
                          <div key={rx.prescription_id} className="bg-white rounded-xl border border-violet-100 p-3 flex items-center justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-xs font-black text-slate-700 font-mono">{rx.rx_no}</div>
                              <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                                <Calendar size={10} /> {new Date(rx.rx_date).toLocaleDateString()}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-1 truncate">
                                {rx.items.map(i => i.medicine_name).join(', ')}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => applyPrescription(rx)}
                              className="shrink-0 px-3 py-2 bg-violet-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-violet-700 transition-all active:scale-95 flex items-center gap-1.5"
                            >
                              <Plus size={12} /> Add {rx.items.length} Med{rx.items.length > 1 ? 's' : ''}
                            </button>
                          </div>
                        ))}
                        <p className="text-[10px] text-violet-500 font-bold pt-1">
                          Medicines are added with names pre-filled. Select a batch and enter the quantity for each.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* BILL LINES */}
            <div className="overflow-x-auto -mx-6 px-6 mb-6">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="bg-slate-50 border-y border-slate-100">
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="px-4 py-4 text-left w-40">Type</th>
                    <th className="px-4 py-4 text-left">Description / Product</th>
                    <th className="px-4 py-4 text-left w-40">Batch No</th>
                    <th className="px-4 py-4 text-center w-24">Qty</th>
                    <th className="px-4 py-4 text-right w-32">Rate (₹)</th>
                    <th className="px-4 py-4 text-right w-24">Disc %</th>
                    <th className="px-4 py-4 text-right w-32">Amount</th>
                    <th className="px-2 py-4 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {form.items.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/50 group">
                      <td className="px-4 py-3">
                        <select className="input-field py-1.5 font-bold" value={l.line_type} onChange={e => updateLine(l.id, 'line_type', e.target.value)}>
                          <option value="Medicine">Medicine Item</option>
                          <option value="Procedure">Svc Procedure</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {l.line_type === 'Medicine' ? (
                          <select className="input-field py-1.5 font-bold" value={l.medicine_id} onChange={e => updateLine(l.id, 'medicine_id', e.target.value)}>
                            <option value="">Choose Med...</option>
                            {medicines.map(m => <option key={m.medicine_id} value={m.medicine_id}>{m.medicine_name}</option>)}
                          </select>
                        ) : (
                          <select className="input-field py-1.5 font-bold" value={l.procedure_id} onChange={e => updateLine(l.id, 'procedure_id', e.target.value)}>
                            <option value="">Choose Svc...</option>
                            {procedures.map(p => <option key={p.procedure_id} value={p.procedure_id}>{p.procedure_name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {l.line_type === 'Medicine' && (
                          <div className="flex flex-col gap-1">
                            <select className="input-field py-1.5 text-[10px] font-black uppercase text-indigo-600" value={l.batch_id} onChange={e => updateLine(l.id, 'batch_id', e.target.value)}>
                              <option value="">Batch...</option>
                              {l.medicine_id && <option value="auto">⚡ Auto FEFO — {totalAvailable(l.medicine_id)} avl</option>}
                              {batches[l.medicine_id]?.map(b => <option key={b.batch_id} value={b.batch_id}>{b.batch_no} ({b.current_qty} Avl)</option>)}
                            </select>
                            {l.batch_id === 'auto' && l.medicine_id && (
                              <button
                                type="button"
                                onClick={() => autoAllocateLine(l.id)}
                                className="text-[9px] font-black uppercase tracking-tighter text-emerald-600 hover:text-emerald-800 flex items-center gap-1"
                              >
                                <ArrowRight size={10} /> Split {l.qty || 0} across batches
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input type="number" className="input-field py-1.5 text-center font-bold" value={l.qty} onChange={e => updateLine(l.id, 'qty', e.target.value)} />
                      </td>
                      <td className="px-4 py-3">
                        <input type="number" className="input-field py-1.5 text-right font-black text-slate-700" value={l.rate} onChange={e => updateLine(l.id, 'rate', e.target.value)} />
                      </td>
                      <td className="px-4 py-3">
                        <input type="number" className="input-field py-1.5 text-right text-rose-500 font-bold" value={l.discount_pct} onChange={e => updateLine(l.id, 'discount_pct', e.target.value)} />
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900 border-l border-slate-50">
                        ₹{((l.rate * l.qty) * (1 - (l.discount_pct||0)/100)).toFixed(2)}
                      </td>
                      <td className="px-2 py-3 text-center">
                        <button onClick={() => removeLine(l.id)} className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16}/></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={addLine} className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-slate-200 text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-xl hover:border-indigo-300 hover:text-indigo-600 transition-all active:scale-95">
              <Plus size={14}/> Add Item / Service Line
            </button>

            {/* GST Summary & TOTALS AREA */}
            <div className="flex flex-col md:flex-row justify-between gap-12 border-t border-slate-100 pt-8">
              <div className="flex-1 max-w-lg">
                {/* GST Summary table — hidden in Without-GST mode */}
              {withGst ? (
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-slate-400 font-black uppercase tracking-widest border-b border-slate-200">
                        <th className="py-2 text-left">GST%</th>
                        <th className="py-2 text-right">Taxable</th>
                        <th className="py-2 text-right">CGST</th>
                        <th className="py-2 text-right">SGST</th>
                        <th className="py-2 text-right">Total GST</th>
                        <th className="py-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {calculateGstSummary().map(s => (
                        <tr key={s.gstPct}>
                          <td className="py-2 font-black text-slate-600">{s.gstPct}%</td>
                          <td className="py-2 text-right">₹{s.taxable.toLocaleString()}</td>
                          <td className="py-2 text-right text-slate-500">₹{(s.taxAmount/2).toLocaleString()}</td>
                          <td className="py-2 text-right text-slate-500">₹{(s.taxAmount/2).toLocaleString()}</td>
                          <td className="py-2 text-right font-bold text-primary-600">₹{s.taxAmount.toLocaleString()}</td>
                          <td className="py-2 text-right font-black text-slate-900">₹{s.net.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex items-center gap-3">
                  <span className="text-2xl">🧾</span>
                  <div>
                    <div className="text-xs font-black text-emerald-700 uppercase tracking-wide">Without GST Mode</div>
                    <div className="text-[10px] text-emerald-600 mt-0.5">No tax applied. Bill uses sale price only.</div>
                  </div>
                </div>
              )}

                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="label">Payment Mode</label>
                    <select className="input-field h-10 font-bold text-sm" value={form.payment_mode} onChange={e => setForm({...form, payment_mode: e.target.value})}>
                      <option value="Cash">Cash</option>
                      <option value="UPI">UPI</option>
                      <option value="Card">Card</option>
                      <option value="Credit">Credit</option>
                    </select>
                  </div>
                  <div>
                    <label className="label text-[10px] uppercase font-black text-slate-400">Reference / Notes</label>
                    <textarea className="input-field h-22 text-sm py-2" placeholder="Internal remarks..." value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}/>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-50 p-6 rounded-3xl space-y-3 border border-slate-100">
                  {withGst ? (
                    <>
                      <div className="flex justify-between items-center text-sm font-bold text-slate-500">
                        <span className="uppercase tracking-widest text-[10px]">Net Taxable:</span>
                        <span className="font-mono">₹{subtotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm font-bold text-indigo-500">
                        <span className="uppercase tracking-widest text-[10px]">GST (CGST+SGST):</span>
                        <span className="font-mono">+ ₹{totalTax.toLocaleString()}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between items-center text-sm font-bold text-slate-500">
                      <span className="uppercase tracking-widest text-[10px]">Subtotal (excl. GST):</span>
                      <span className="font-mono">₹{subtotal.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="pt-4 border-t border-slate-200 mt-4 flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-tighter">
                        {withGst ? 'Grand Total (Rounded)' : 'Total (No GST, Rounded)'}
                      </span>
                      <span className={`text-xs font-bold uppercase tracking-widest italic ${withGst ? 'text-indigo-400' : 'text-emerald-500'}`}>
                        Payable Amount
                      </span>
                    </div>
                    <span className="text-4xl font-black text-slate-900">₹{grandTotal.toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button onClick={resetForm} className="flex-1 px-4 py-4 bg-slate-100 text-slate-500 font-black uppercase text-xs tracking-widest rounded-2xl hover:bg-slate-200 transition-all active:scale-95 shadow-sm">Discard</button>
                  <button 
                    disabled={saving}
                    onClick={handleSave}
                    className="flex-[2] px-6 py-4 bg-indigo-600 text-white font-black uppercase text-xs tracking-widest rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:bg-slate-300"
                  >
                    {saving ? 'Processing...' : (
                      <>
                        <Save size={18}/> {editingBillId ? 'Update & Save Changes' : 'Confirm & Save Bill'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card !p-0 overflow-hidden shadow-xl border-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="px-6 py-5">Bill Details</th>
                    <th className="px-6 py-5">Customer / Pet</th>
                    <th className="px-6 py-5">Doctor / Agent</th>
                    <th className="px-6 py-5 text-right">Invoice Amount</th>
                    <th className="px-6 py-5">Status</th>
                    <th className="px-6 py-5 text-right">Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {loading ? (
                    <tr><td colSpan="6" className="px-6 py-12 text-center text-slate-400 font-black uppercase animate-pulse">Fetching history...</td></tr>
                  ) : history.length === 0 ? (
                    <tr><td colSpan="6" className="px-6 py-12 text-center text-slate-400">No invoices found</td></tr>
                  ) : history.map(bill => (
                    <tr key={bill.bill_id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-indigo-600 font-mono tracking-tighter">{bill.bill_number}</div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 font-bold italic"><Calendar size={10}/> {new Date(bill.bill_date).toLocaleDateString()}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-700 uppercase">{bill.owner?.name || 'Walking Customer'}</div>
                        <div className="text-[10px] text-indigo-400 flex items-center gap-1 font-black uppercase"><PawPrint size={10}/> {bill.pet?.name || 'N/A'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><Stethoscope size={12}/> {bill.doctor?.name || 'House Staff'}</div>
                        <div className="text-[10px] text-slate-400 font-medium">Mode: {bill.payment_mode}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="text-sm font-black text-slate-800">₹{parseFloat(bill.net_payable).toLocaleString()}</div>
                        <div className="text-[9px] text-emerald-500 font-black uppercase tracking-tighter">Paid Fully</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100`}>
                          {bill.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleEdit(bill)} className="p-2 text-slate-300 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"><Edit2 size={16}/></button>
                          <button 
                            onClick={() => {
                              setPrintBillData(bill)
                              setShowPrint(true)
                            }}
                            className="p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                          >
                            <Printer size={16}/>
                          </button>
                          <button onClick={() => handleDelete(bill.bill_id)} className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"><Trash2 size={16}/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showPrint && printBillData && (
        <SalesBillPrint 
          bill={printBillData}
          owners={owners}
          pets={pets}
          doctors={doctors}
          onClose={() => {
            setShowPrint(false)
            setPrintBillData(null)
          }}
        />
      )}
    </div>
  )
}
