import { useEffect, useState } from 'react'
import { Package, AlertTriangle, Clock, Plus } from 'lucide-react'
import api from '../api'
import Table from '../components/Table'

function AddBatchModal({ isOpen, onClose, medicines, onSuccess }) {
  const [form, setForm] = useState({
    medicine_id: '',
    batch_no: '',
    expiry_date: '',
    purchase_price: '',
    sale_price: '',
    mrp: '',
    opening_qty: ''
  })
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.medicine_id || !form.batch_no || !form.expiry_date) {
      alert('Please fill in Medicine, Batch No, and Expiry Date.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        medicine_id: Number(form.medicine_id),
        batch_no: form.batch_no,
        expiry_date: form.expiry_date,
        purchase_price: Number(form.purchase_price) || 0,
        sale_price: Number(form.sale_price) || 0,
        mrp: Number(form.mrp) || 0,
        opening_qty: Number(form.opening_qty) || 0,
        source: 'Opening'
      }
      await api.post('/inventory/batches', payload)
      alert('Opening stock / batch added successfully!')
      onSuccess()
      onClose()
      setForm({
        medicine_id: '',
        batch_no: '',
        expiry_date: '',
        purchase_price: '',
        sale_price: '',
        mrp: '',
        opening_qty: ''
      })
    } catch (err) {
      alert('Error adding batch: ' + (err.response?.data?.detail || err.message))
    } finally {
      setSaving(false)
    }
  }

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.45)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Add Opening Stock / New Batch</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Select Medicine *</label>
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.medicine_id} onChange={set('medicine_id')} autoFocus>
              <option value="">-- Select Medicine --</option>
              {medicines.map(m => (
                <option key={m.medicine_id} value={m.medicine_id}>{m.medicine_name} ({m.medicine_code})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Batch No *</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.batch_no} onChange={set('batch_no')} placeholder="BATCH-001" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expiry Date *</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.expiry_date} onChange={set('expiry_date')} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Opening Quantity</label>
              <input type="number" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.opening_qty} onChange={set('opening_qty')} placeholder="100" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Purchase Price (Rate)</label>
              <input type="number" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.purchase_price} onChange={set('purchase_price')} placeholder="10.50" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Selling Price</label>
              <input type="number" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.sale_price} onChange={set('sale_price')} placeholder="15.00" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">MRP</label>
              <input type="number" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" value={form.mrp} onChange={set('mrp')} placeholder="18.00" />
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save Stock'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Inventory() {
  const [data, setData] = useState([])
  const [search, setSearch] = useState('')
  const [ledger, setLedger] = useState([])
  const [activeTab, setActiveTab] = useState('stock')
  const [modal, setModal] = useState(false)

  const loadStock = () => api.get('/inventory/medicines').then(r => setData(r.data)).catch(() => {})
  const loadLedger = () => api.get('/inventory/stock-ledger').then(r => setLedger(r.data)).catch(() => {})

  const handleRefresh = () => {
    loadStock()
    loadLedger()
  }

  useEffect(() => { handleRefresh() }, [])

  // Helper: check if near expiry (90 days)
  const isNearExpiry = (dateStr) => {
    const d = new Date(dateStr)
    const today = new Date()
    const diff = d.getTime() - today.getTime()
    return diff < (1000 * 60 * 60 * 24 * 90)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800 flex items-center gap-2">
          <Package className="text-primary-600" size={20} />
          Inventory & Stock
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            <button onClick={() => setActiveTab('stock')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'stock' ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Current Stock
            </button>
            <button onClick={() => setActiveTab('ledger')}
              className={`px-4 py-1.5 rounded-lg text-xs font-semibold ${activeTab === 'ledger' ? 'bg-white text-primary-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              Stock Ledger
            </button>
          </div>
          <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus size={15} /> Add Opening Stock / Batch
          </button>
        </div>
      </div>

      {activeTab === 'stock' ? (
        <Table
          columns={[
            { key: 'medicine_code', label: 'Code', width: 100 },
            { key: 'medicine_name', label: 'Medicine' },
            { key: 'dosage_form',   label: 'Form', width: 100 },
            { key: 'current_stock', label: 'Total Stock', render: (v, row) => (
              <span className={`font-bold ${Number(v) <= Number(row.reorder_level) ? 'text-red-500' : 'text-emerald-600'}`}>{v}</span>
            )},
            { key: 'reorder_level', label: 'Reorder Level', width: 120 },
            { key: 'medicine_id',   label: 'Status', render: (v, row) => (
              Number(row.current_stock) <= Number(row.reorder_level)
                ? <span className="badge bg-red-100 text-red-700 flex items-center gap-1 w-fit"><AlertTriangle size={12}/> Low Stock</span>
                : <span className="badge bg-green-100 text-green-700 w-fit">Good</span>
            )},
          ]}
          data={data}
          searchValue={search}
          onSearchChange={setSearch}
          emptyText="No inventory found."
        />
      ) : (
        <Table
          columns={[
            { key: 'created_at',    label: 'Timestamp', render: v => new Date(v).toLocaleString() },
            { key: 'medicine_name', label: 'Item', render: (v, row) => (
              <div>
                <div className="font-semibold text-slate-700">{v || `#${row.medicine_id}`}</div>
                {row.batch_no && <div className="text-[10px] text-slate-400">Batch: {row.batch_no}</div>}
              </div>
            )},
            { key: 'txn_type',      label: 'Type', render: v => (
              <span className={`badge ${v === 'Purchase' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{v}</span>
            )},
            { key: 'ref_type',      label: 'Ref' },
            { key: 'qty_in',        label: 'Qty Change', render: (_, row) => {
              const net = Number(row.qty_in || 0) - Number(row.qty_out || 0)
              return net > 0
                ? <span className="text-green-600 font-bold">+{net}</span>
                : <span className="text-red-600 font-bold">{net}</span>
            }},
          ]}
          data={ledger}
          emptyText="No stock movements recorded."
        />
      )}

      <AddBatchModal
        isOpen={modal}
        onClose={() => setModal(false)}
        medicines={data}
        onSuccess={handleRefresh}
      />
    </div>
  )
}
