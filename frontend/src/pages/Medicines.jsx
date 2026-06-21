import React, { useState, useEffect } from 'react'
import api from '../api'
import { Plus, Pencil } from 'lucide-react'

export default function Medicines() {
  const [medicines, setMedicines]     = useState([])
  const [search, setSearch]           = useState('')
  const [showActiveOnly, setShowActiveOnly] = useState(true)
  const [loading, setLoading]         = useState(false)

  // Dropdowns
  const [units, setUnits]         = useState([])
  const [hsnCodes, setHsnCodes]   = useState([])
  const [gstRates, setGstRates]   = useState([])

  // Modal
  const [isModalOpen, setIsModalOpen]       = useState(false)
  const [editingMedicine, setEditingMedicine] = useState(null)
  const [saving, setSaving]                 = useState(false)
  const blankForm = {
    medicine_name: '', medicine_name2: '', dosage_form: '',
    strength: '', hsn_id: '', gst_rate_id: '', unit_id: '',
    reorder_level: 0, is_active: true
  }
  const [formData, setFormData] = useState(blankForm)

  // Opening stock state
  const [currentStock, setCurrentStock]         = useState(0)
  const [showStockForm, setShowStockForm]       = useState(false)
  const [stockQty, setStockQty]                 = useState('')
  const [stockPurchasePrice, setStockPurchasePrice] = useState('')
  const [stockSalePrice, setStockSalePrice]     = useState('')
  const [stockMrp, setStockMrp]                 = useState('')
  const [stockSaving, setStockSaving]           = useState(false)

  // Batch state
  const [batches, setBatches]           = useState([])
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [batchSaving, setBatchSaving]   = useState(false)
  const blankBatch = { batch_no: '', mfg_date: '', expiry_date: '', purchase_price: '', sale_price: '', mrp: '', opening_qty: '0' }
  const [batchForm, setBatchForm]       = useState(blankBatch)

  // HSN quick-add
  const [hsnQuickModal, setHsnQuickModal] = useState(false)
  const [hsnForm, setHsnForm]           = useState({ hsn_code: '', description: '', default_gst_pct: '12' })
  const [hsnSaving, setHsnSaving]       = useState(false)

  // ── LOADERS ──────────────────────────────────────────────
  useEffect(() => { fetchMedicines() }, [search, showActiveOnly])
  useEffect(() => { fetchMasters() }, [])

  const fetchMasters = async () => {
    try {
      const [u, h, g] = await Promise.all([
        api.get('/inventory/units'),
        api.get('/masters/hsn'),
        api.get('/masters/gst-rates')
      ])
      setUnits(u.data); setHsnCodes(h.data); setGstRates(g.data)
    } catch {}
  }

  const fetchHsn = async () => {
    try { const r = await api.get('/masters/hsn'); setHsnCodes(r.data) } catch {}
  }

  const fetchMedicines = async () => {
    setLoading(true)
    try {
      const res = await api.get('/inventory/medicines', {
        params: { search, include_inactive: !showActiveOnly }
      })
      setMedicines(res.data)
    } catch { alert('Failed to fetch medicines') }
    finally { setLoading(false) }
  }

  const loadBatches = (medicineId) =>
    api.get(`/inventory/batches/${medicineId}`)
      .then(r => setBatches(r.data)).catch(() => setBatches([]))

  // ── OPEN / CLOSE MODAL ────────────────────────────────────
  const resetStockState = () => {
    setShowStockForm(false); setStockQty(''); setStockPurchasePrice('')
    setStockSalePrice(''); setStockMrp('')
  }

  const handleOpenModal = (med = null) => {
    resetStockState()
    setShowBatchForm(false); setBatchForm(blankBatch); setBatches([])
    if (med) {
      setEditingMedicine(med)
      setCurrentStock(Number(med.current_stock) || 0)
      setFormData({
        medicine_name:  med.medicine_name,
        medicine_name2: med.medicine_name2 || '',
        dosage_form:    med.dosage_form    || '',
        strength:       med.strength       || '',
        hsn_id:         med.hsn_id         || '',
        gst_rate_id:    med.gst_rate_id    || '',
        unit_id:        med.unit_id        || '',
        reorder_level:  med.reorder_level,
        is_active:      med.is_active
      })
      loadBatches(med.medicine_id)
    } else {
      setEditingMedicine(null)
      setCurrentStock(0)
      setFormData(blankForm)
    }
    setIsModalOpen(true)
  }

  const closeModal = () => { setIsModalOpen(false); setEditingMedicine(null) }

  // ── SAVE MEDICINE ─────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.medicine_name) { alert('Medicine name is required'); return }
    setSaving(true)
    try {
      const payload = {
        ...formData,
        hsn_id:       formData.hsn_id       ? Number(formData.hsn_id)       : null,
        gst_rate_id:  formData.gst_rate_id  ? Number(formData.gst_rate_id)  : null,
        unit_id:      formData.unit_id       ? Number(formData.unit_id)      : null,
        reorder_level: Number(formData.reorder_level) || 0
      }
      if (editingMedicine) {
        await api.put(`/inventory/medicines/${editingMedicine.medicine_id}`, payload)
        fetchMedicines()
        closeModal()
      } else {
        const res = await api.post('/inventory/medicines', payload)
        const created = res.data
        setEditingMedicine(created)
        setCurrentStock(0)
        loadBatches(created.medicine_id)
        fetchMedicines()
        // keep modal open — let user add opening stock immediately
      }
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.detail || err.message))
    } finally { setSaving(false) }
  }

  // ── QUICK OPENING STOCK ──────────────────────────────────
  const handleQuickStock = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const qty = parseFloat(stockQty)
    if (!qty || qty <= 0) { alert('Please enter a valid quantity greater than 0'); return }
    setStockSaving(true)
    try {
      const now = new Date()
      // Timestamp-based batch_no — unique on every call, no collision risk
      const autoBatchNo = `OPG-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${now.getTime().toString().slice(-5)}`
      await api.post('/inventory/batches', {
        medicine_id:    editingMedicine.medicine_id,
        batch_no:       autoBatchNo,
        expiry_date:    `${now.getFullYear() + 5}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
        purchase_price: parseFloat(stockPurchasePrice) || 0,
        sale_price:     parseFloat(stockSalePrice)     || 0,
        mrp:            parseFloat(stockMrp)           || 0,
        opening_qty:    qty,
        source:         'Opening'
      })
      // Optimistic update — add qty directly; no fragile search-and-find re-fetch
      setCurrentStock(prev => prev + qty)
      resetStockState()
      loadBatches(editingMedicine.medicine_id)
      fetchMedicines() // refresh table in background
    } catch (err) {
      alert('Error adding stock: ' + (err.response?.data?.detail || err.message))
    } finally { setStockSaving(false) }
  }

  // ── ADD BATCH ────────────────────────────────────────────
  const handleAddBatch = async (e) => {
    e.preventDefault()
    if (!batchForm.batch_no)    { alert('Batch number is required'); return }
    if (!batchForm.expiry_date) { alert('Expiry date is required');  return }
    setBatchSaving(true)
    try {
      await api.post('/inventory/batches', {
        medicine_id:    editingMedicine.medicine_id,
        batch_no:       batchForm.batch_no,
        mfg_date:       batchForm.mfg_date    || null,
        expiry_date:    batchForm.expiry_date,
        purchase_price: parseFloat(batchForm.purchase_price) || 0,
        sale_price:     parseFloat(batchForm.sale_price)     || 0,
        mrp:            parseFloat(batchForm.mrp)            || 0,
        opening_qty:    parseFloat(batchForm.opening_qty)    || 0,
        source:         'Opening'
      })
      setBatchForm(blankBatch); setShowBatchForm(false)
      loadBatches(editingMedicine.medicine_id)
      fetchMedicines()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.detail || err.message))
    } finally { setBatchSaving(false) }
  }

  // ── HSN QUICK SAVE ───────────────────────────────────────
  const handleHsnQuickSave = async (e) => {
    e.preventDefault()
    if (!hsnForm.hsn_code || !hsnForm.description) { alert('HSN code and description required'); return }
    setHsnSaving(true)
    try {
      const res = await api.post('/masters/hsn', { ...hsnForm, default_gst_pct: parseFloat(hsnForm.default_gst_pct) || 12 })
      await fetchHsn()
      setFormData(prev => ({ ...prev, hsn_id: String(res.data.hsn_id) }))
      setHsnForm({ hsn_code: '', description: '', default_gst_pct: '12' })
      setHsnQuickModal(false)
    } catch (err) { alert('Error: ' + (err.response?.data?.detail || err.message)) }
    finally { setHsnSaving(false) }
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm'
  const lbl = 'block text-xs font-bold text-gray-500 uppercase mb-1'

  // ── RENDER ────────────────────────────────────────────────
  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Page Header */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Medicine / Item Master</h1>
        <button
          onClick={() => handleOpenModal()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg shadow-sm transition-colors flex items-center gap-2 text-sm font-semibold"
        >
          <Plus size={16} /> Add Medicine
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex flex-wrap gap-4 items-center border border-gray-100">
        <input
          type="text"
          placeholder="Search by name or generic..."
          className="flex-1 min-w-[280px] border border-gray-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={!showActiveOnly} onChange={() => setShowActiveOnly(!showActiveOnly)} className="w-4 h-4 rounded" />
          Show Inactive
        </label>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Code','Medicine Name','Form','Strength','Stock','Status',''].map(h => (
                <th key={h} className="px-5 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-sm">Loading...</td></tr>
            )}
            {!loading && medicines.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400 text-sm">No medicines found.</td></tr>
            )}
            {medicines.map(med => (
              <tr key={med.medicine_id} className="hover:bg-gray-50 transition-colors">
                <td className="px-5 py-3 text-sm font-medium text-indigo-600">{med.medicine_code}</td>
                <td className="px-5 py-3">
                  <div className="text-sm font-semibold text-gray-900">{med.medicine_name}</div>
                  <div className="text-xs text-gray-400">{med.medicine_name2}</div>
                </td>
                <td className="px-5 py-3 text-sm text-gray-600">{med.dosage_form || '—'}</td>
                <td className="px-5 py-3 text-sm text-gray-600">{med.strength || '—'}</td>
                <td className="px-5 py-3">
                  <span className={`text-sm font-bold ${Number(med.current_stock) <= Number(med.reorder_level) ? 'text-red-500' : 'text-emerald-600'}`}>
                    {med.current_stock}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-1 text-xs rounded-full font-medium ${med.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {med.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => handleOpenModal(med)} className="text-indigo-600 hover:text-indigo-900 text-sm font-medium flex items-center gap-1 ml-auto">
                    <Pencil size={14} /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── MAIN MODAL ─────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(15,23,42,0.5)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-6">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50 rounded-t-2xl">
              <div>
                <h2 className="text-lg font-bold text-gray-800">
                  {editingMedicine ? 'Edit Medicine' : 'New Medicine Master'}
                </h2>
                {editingMedicine && <p className="text-xs text-gray-400 mt-0.5">Code: {editingMedicine.medicine_code}</p>}
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
            </div>

            <div className="p-6 space-y-6">

              {/* ── MEDICINE DETAILS FORM ── */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className={lbl}>Medicine Primary Name *</label>
                    <input type="text" required className={inp} value={formData.medicine_name}
                      onChange={e => setFormData({...formData, medicine_name: e.target.value})} autoFocus />
                  </div>
                  <div className="col-span-2">
                    <label className={lbl}>Generic / Alternate Name</label>
                    <input type="text" className={inp} value={formData.medicine_name2}
                      onChange={e => setFormData({...formData, medicine_name2: e.target.value})} />
                  </div>
                  <div>
                    <label className={lbl}>Dosage Form</label>
                    <select className={inp} value={formData.dosage_form} onChange={e => setFormData({...formData, dosage_form: e.target.value})}>
                      <option value="">Select Form</option>
                      {['Tablet','Capsule','Syrup','Injection','Drops','Ointment','Powder','Cream','Gel','Spray'].map(f =>
                        <option key={f} value={f}>{f}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Strength / Dosage</label>
                    <input type="text" placeholder="e.g. 500mg, 250ml" className={inp}
                      value={formData.strength} onChange={e => setFormData({...formData, strength: e.target.value})} />
                  </div>
                  <div>
                    <label className={lbl}>Unit of Measure</label>
                    <select className={inp} value={formData.unit_id} onChange={e => setFormData({...formData, unit_id: e.target.value})}>
                      <option value="">Select Unit</option>
                      {units.map(u => <option key={u.unit_id} value={u.unit_id}>{u.unit_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Reorder Level (Min Stock)</label>
                    <input type="number" className={inp} value={formData.reorder_level}
                      onChange={e => setFormData({...formData, reorder_level: e.target.value})} />
                  </div>

                  {/* GST & HSN */}
                  <div className="col-span-2 border-t pt-3 mt-1">
                    <h3 className="text-sm font-bold text-indigo-600 mb-3">GST &amp; HSN Compliance</h3>
                  </div>
                  <div>
                    <label className={lbl}>HSN Code</label>
                    <div className="flex gap-1.5 items-center">
                      <select className={`${inp} flex-1`} value={formData.hsn_id} onChange={e => setFormData({...formData, hsn_id: e.target.value})}>
                        <option value="">Select HSN</option>
                        {hsnCodes.map(h => <option key={h.hsn_id} value={h.hsn_id}>{h.hsn_code} — {h.description}</option>)}
                      </select>
                      <button type="button" onClick={() => setHsnQuickModal(true)}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 text-xs font-semibold transition-colors">
                        <Plus size={13} /> HSN
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={lbl}>GST Rate (%)</label>
                    <select className={inp} value={formData.gst_rate_id} onChange={e => setFormData({...formData, gst_rate_id: e.target.value})}>
                      <option value="">Select Rate</option>
                      {gstRates.map(g => <option key={g.gst_rate_id} value={g.gst_rate_id}>{g.rate_name} ({g.gst_percent}%)</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} className="w-4 h-4 text-indigo-600" />
                    Item is Active
                  </label>
                  <div className="flex gap-3">
                    <button type="button" onClick={closeModal}
                      className="px-5 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm font-medium">Cancel</button>
                    <button type="submit" disabled={saving}
                      className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold disabled:opacity-60 transition-colors">
                      {saving ? 'Saving...' : editingMedicine ? 'Update Medicine' : 'Save & Add Stock'}
                    </button>
                  </div>
                </div>
              </form>

              {/* ── OPENING STOCK WIDGET ── */}
              {editingMedicine && (
                <div className="border-t border-gray-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                        Opening Stock
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">Add current stock on hand. Updates Inventory &amp; Stock Ledger instantly.</p>
                    </div>
                    {/* Live stock counter */}
                    <div className={`text-center px-5 py-2 rounded-xl border-2 ${
                      currentStock <= 0
                        ? 'border-red-200 bg-red-50'
                        : currentStock <= Number(formData.reorder_level || 0)
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-emerald-200 bg-emerald-50'
                    }`}>
                      <div className={`text-2xl font-extrabold leading-none ${
                        currentStock <= 0 ? 'text-red-600'
                        : currentStock <= Number(formData.reorder_level || 0) ? 'text-amber-600'
                        : 'text-emerald-600'
                      }`}>{currentStock}</div>
                      <div className="text-[10px] text-gray-500 font-medium mt-0.5 uppercase tracking-wide">In Stock</div>
                    </div>
                  </div>

                  {!showStockForm ? (
                    <button
                      type="button"
                      onClick={() => setShowStockForm(true)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-50 transition-colors"
                    >
                      <Plus size={16} /> Add Opening Stock
                    </button>
                  ) : (
                    <form onSubmit={handleQuickStock} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Add Stock Entry</h4>
                        <button type="button" onClick={() => { setShowStockForm(false); setStockQty('') }}
                          className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-bold text-emerald-800 mb-1">Quantity to Add *</label>
                          <input
                            className="w-full border border-emerald-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none text-lg font-bold"
                            type="number" step="0.01" min="0.01"
                            value={stockQty} onChange={e => setStockQty(e.target.value)}
                            placeholder="e.g. 100" autoFocus
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-emerald-800 mb-1">Purchase Price</label>
                          <input className="w-full border border-emerald-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                            type="number" step="0.01" min="0" value={stockPurchasePrice}
                            onChange={e => setStockPurchasePrice(e.target.value)} placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-emerald-800 mb-1">MRP</label>
                          <input className="w-full border border-emerald-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                            type="number" step="0.01" min="0" value={stockMrp}
                            onChange={e => setStockMrp(e.target.value)} placeholder="0.00" />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-bold text-emerald-800 mb-1">Sale Price</label>
                          <input className="w-full border border-emerald-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none text-sm"
                            type="number" step="0.01" min="0" value={stockSalePrice}
                            onChange={e => setStockSalePrice(e.target.value)} placeholder="0.00" />
                        </div>
                        <div className="col-span-2">
                          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                            Auto batch: <span className="font-mono text-gray-600">OPG-{new Date().getFullYear()}{String(new Date().getMonth()+1).padStart(2,'0')}-{editingMedicine?.medicine_id}</span> · Expiry: 5 yrs
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end pt-1 border-t border-emerald-200">
                        <button type="button" onClick={() => { setShowStockForm(false); setStockQty('') }}
                          className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-xs font-medium">Cancel</button>
                        <button type="submit" disabled={stockSaving || !stockQty}
                          className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors">
                          {stockSaving ? 'Adding...' : `Add ${stockQty || 0} Units to Stock`}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* ── BATCH PANEL ── */}
              {editingMedicine && (
                <div className="border-t border-gray-100 pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500"></span>
                        Batch Numbers
                        <span className="text-gray-400 font-normal">({batches.length} batch{batches.length !== 1 ? 'es' : ''})</span>
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">Opening stock batches. Purchase batches come from Purchase Bills.</p>
                    </div>
                    {!showBatchForm && (
                      <button type="button" onClick={() => setShowBatchForm(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                        <Plus size={13} /> Add Batch
                      </button>
                    )}
                  </div>

                  {batches.length > 0 && (
                    <div className="rounded-xl border border-gray-100 overflow-hidden mb-4">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            {['Batch No','Mfg Date','Expiry','Pur.Price','Sale Price','MRP','Qty','Source'].map(h => (
                              <th key={h} className={`py-2 px-3 text-gray-400 font-semibold uppercase tracking-wide ${h === 'Batch No' || h === 'Mfg Date' || h === 'Expiry' || h === 'Source' ? 'text-left' : 'text-right'}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {batches.map(b => {
                            const isExpired    = b.expiry_date && new Date(b.expiry_date) < new Date()
                            const isNearExpiry = b.expiry_date && !isExpired && (new Date(b.expiry_date) - new Date()) < 90*24*60*60*1000
                            return (
                              <tr key={b.batch_id} className="hover:bg-gray-50">
                                <td className="py-2 px-3 font-semibold text-indigo-700">{b.batch_no}</td>
                                <td className="py-2 px-3 text-gray-500">{b.mfg_date || '—'}</td>
                                <td className="py-2 px-3">
                                  <span className={`font-medium ${isExpired ? 'text-red-600' : isNearExpiry ? 'text-amber-600' : 'text-gray-600'}`}>{b.expiry_date}</span>
                                  {isExpired    && <span className="ml-1 px-1 bg-red-100 text-red-600 rounded text-[10px]">Expired</span>}
                                  {isNearExpiry && !isExpired && <span className="ml-1 px-1 bg-amber-100 text-amber-600 rounded text-[10px]">Near</span>}
                                </td>
                                <td className="py-2 px-3 text-right text-gray-600">{Number(b.purchase_price).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right text-gray-600">{Number(b.sale_price).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right font-semibold text-gray-700">{Number(b.mrp).toFixed(2)}</td>
                                <td className="py-2 px-3 text-right">
                                  <span className={`font-bold ${Number(b.current_qty) <= 0 ? 'text-red-500' : 'text-emerald-600'}`}>{Number(b.current_qty)}</span>
                                </td>
                                <td className="py-2 px-3">
                                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">{b.source}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {batches.length === 0 && !showBatchForm && (
                    <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl">
                      No batches yet. Click "Add Batch" to add opening stock with full details.
                    </div>
                  )}

                  {showBatchForm && (
                    <form onSubmit={handleAddBatch} className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold text-indigo-700 uppercase tracking-wide">New Batch Entry</h4>
                        <button type="button" onClick={() => { setShowBatchForm(false); setBatchForm(blankBatch) }}
                          className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">Batch No *</label>
                          <input className={inp} value={batchForm.batch_no} onChange={e => setBatchForm(f => ({...f, batch_no: e.target.value}))} placeholder="e.g. BT2024001" autoFocus />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">Mfg Date</label>
                          <input className={inp} type="date" value={batchForm.mfg_date} onChange={e => setBatchForm(f => ({...f, mfg_date: e.target.value}))} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">Expiry Date *</label>
                          <input className={inp} type="date" value={batchForm.expiry_date} onChange={e => setBatchForm(f => ({...f, expiry_date: e.target.value}))} />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">Purchase Price</label>
                          <input className={inp} type="number" step="0.01" min="0" value={batchForm.purchase_price} onChange={e => setBatchForm(f => ({...f, purchase_price: e.target.value}))} placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">Sale Price</label>
                          <input className={inp} type="number" step="0.01" min="0" value={batchForm.sale_price} onChange={e => setBatchForm(f => ({...f, sale_price: e.target.value}))} placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">MRP</label>
                          <input className={inp} type="number" step="0.01" min="0" value={batchForm.mrp} onChange={e => setBatchForm(f => ({...f, mrp: e.target.value}))} placeholder="0.00" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-indigo-700 mb-1">Opening Qty</label>
                          <input className={inp} type="number" step="0.01" min="0" value={batchForm.opening_qty} onChange={e => setBatchForm(f => ({...f, opening_qty: e.target.value}))} placeholder="0" />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end pt-1">
                        <button type="button" onClick={() => { setShowBatchForm(false); setBatchForm(blankBatch) }}
                          className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-xs">Cancel</button>
                        <button type="submit" disabled={batchSaving}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold disabled:opacity-60 transition-colors">
                          {batchSaving ? 'Adding...' : 'Add Batch'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── HSN QUICK-ADD SUB-MODAL ── */}
      {hsnQuickModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.6)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-indigo-50 rounded-t-2xl">
              <div>
                <h2 className="font-semibold text-gray-800 text-sm">Quick Add HSN Code</h2>
                <p className="text-xs text-gray-500 mt-0.5">Add without leaving this form</p>
              </div>
              <button onClick={() => { setHsnForm({ hsn_code: '', description: '', default_gst_pct: '12' }); setHsnQuickModal(false) }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleHsnQuickSave} className="px-5 py-4 space-y-3">
              <div>
                <label className={lbl}>HSN Code *</label>
                <input className={inp} value={hsnForm.hsn_code} onChange={e => setHsnForm(f => ({...f, hsn_code: e.target.value}))} placeholder="e.g. 3004" maxLength={10} autoFocus />
              </div>
              <div>
                <label className={lbl}>Description *</label>
                <input className={inp} value={hsnForm.description} onChange={e => setHsnForm(f => ({...f, description: e.target.value}))} placeholder="Medicaments for veterinary use" />
              </div>
              <div>
                <label className={lbl}>Default GST %</label>
                <input className={inp} type="number" step="0.01" min="0" value={hsnForm.default_gst_pct} onChange={e => setHsnForm(f => ({...f, default_gst_pct: e.target.value}))} />
              </div>
              <div className="flex gap-2 justify-end pt-2 border-t border-gray-100">
                <button type="button" onClick={() => { setHsnForm({ hsn_code: '', description: '', default_gst_pct: '12' }); setHsnQuickModal(false) }}
                  className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 text-sm">Cancel</button>
                <button type="submit" disabled={hsnSaving}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-60">
                  {hsnSaving ? 'Adding...' : 'Add HSN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
