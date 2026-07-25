import { useState } from 'react'
import { saveAs } from 'file-saver'
import {
  Percent, Receipt, Building2, Tags, Calculator, Truck,
  Search, Download, FileSearch
} from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import { formatDisplayDate } from '../utils'

// Same hardcoded FY list already used by JournalVoucher.jsx / PaymentVoucher.jsx / AccountsReports.jsx —
// there is no backend endpoint that lists financial years yet (tracked in project notes), so every page
// that needs an FY dropdown duplicates this constant today.
const FY_OPTIONS = ['2023-24', '2024-25', '2025-26', '2026-27']

const TABS = [
  { key: 'sales',    label: 'Sales Register',    icon: Receipt },
  { key: 'b2b',      label: 'B2B Summary',       icon: Building2 },
  { key: 'hsn',      label: 'HSN Summary',       icon: Tags },
  { key: 'gstr3b',   label: 'GSTR-3B Summary',   icon: Calculator },
  { key: 'purchase', label: 'Purchase Register', icon: Truck },
]

const GST_TYPE_STYLES = {
  sales:       'bg-blue-50 text-blue-700',
  credit_note: 'bg-amber-50 text-amber-700',
  purchase:    'bg-purple-50 text-purple-700',
  debit_note:  'bg-rose-50 text-rose-700',
}
const GST_TYPE_LABELS = {
  sales: 'Sales', credit_note: 'Credit Note', purchase: 'Purchase', debit_note: 'Debit Note',
}

// ── Formatting helpers ──────────────────────────────────────────
const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const GstTypeBadge = ({ type }) => (
  <span className={`badge font-semibold ${GST_TYPE_STYLES[type] || 'bg-slate-100 text-slate-600'}`}>
    {GST_TYPE_LABELS[type] || type || '—'}
  </span>
)

// Register-style amounts can be negative (credit/debit notes) — unlike AccountsReports.jsx's Amount
// helper (which treats <=0 as blank), negatives here are real data and shown in red with a minus sign.
const Amount = ({ value }) => {
  const n = Number(value || 0)
  if (n === 0) return <span className="text-slate-300">—</span>
  return (
    <span className={`font-medium tabular-nums ${n < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
      {n < 0 ? '-' : ''}₹{fmt(Math.abs(n))}
    </span>
  )
}

// ── CSV export ───────────────────────────────────────────────────
const jsonToCsv = (data, columns) => {
  const header = columns.map(col => col.label).join(',')
  const rows = data.map(row =>
    columns.map(col => {
      const val = row[col.accessor]
      return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : (val ?? '')
    }).join(',')
  )
  return [header, ...rows].join('\n')
}

const downloadCsv = (data, columns, filename) => {
  if (!data || !data.length) return
  const blob = new Blob([jsonToCsv(data, columns)], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, filename)
}

// ── Small shared bits ───────────────────────────────────────────
const sumField = (data, key) => (data || []).reduce((s, r) => s + Number(r[key] || 0), 0)

const TotalsSummary = ({ data, fields }) => {
  if (!data || !data.length) return null
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {fields.map(f => (
        <div key={f.key} className="stat-card">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{f.label}</p>
          <p className="text-xl font-bold mt-1 text-slate-700 tabular-nums">₹{fmt(sumField(data, f.key))}</p>
        </div>
      ))}
    </div>
  )
}

const Gstr3bCard = ({ title, rows }) => (
  <div className="card">
    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">{title}</p>
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center justify-between">
          <span className="text-sm text-slate-600">{r.label}</span>
          <span className="font-semibold text-slate-800 tabular-nums">₹{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  </div>
)

const EmptyPrompt = ({ text }) => (
  <div className="card flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
    <FileSearch size={32} strokeWidth={1.5} />
    <p className="text-sm">{text}</p>
  </div>
)

export default function GSTReports() {
  const [activeTab, setActiveTab] = useState('sales')

  // Shared filters — every /reports/gst/* endpoint takes the same fy_code/from_date/to_date shape.
  const [fyCode, setFyCode] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [salesRegister, setSalesRegister] = useState([])
  const [salesLoaded, setSalesLoaded] = useState(false)

  const [b2bSummary, setB2bSummary] = useState([])
  const [b2bLoaded, setB2bLoaded] = useState(false)

  const [hsnSummary, setHsnSummary] = useState([])
  const [hsnLoaded, setHsnLoaded] = useState(false)

  const [gstr3bSummary, setGstr3bSummary] = useState(null)
  const [gstr3bLoaded, setGstr3bLoaded] = useState(false)

  const [purchaseRegister, setPurchaseRegister] = useState([])
  const [purchaseLoaded, setPurchaseLoaded] = useState(false)

  // ── Fetch handlers — one per tab, matching AccountsReports.jsx's pattern ──
  const fetchSalesRegister = () => {
    if (!fyCode) return
    api.get('/reports/gst/sales-register', { params: { fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => { setSalesRegister(res.data.sales_register || []); setSalesLoaded(true) })
      .catch(console.error)
  }

  const fetchB2b = () => {
    if (!fyCode) return
    api.get('/reports/gst/b2b', { params: { fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => { setB2bSummary(res.data.b2b || []); setB2bLoaded(true) })
      .catch(console.error)
  }

  const fetchHsnSummary = () => {
    if (!fyCode) return
    api.get('/reports/gst/hsn-summary', { params: { fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => { setHsnSummary(res.data.hsn_summary || []); setHsnLoaded(true) })
      .catch(console.error)
  }

  const fetchGstr3b = () => {
    if (!fyCode) return
    api.get('/reports/gst/gstr3b-summary', { params: { fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => { setGstr3bSummary(res.data || null); setGstr3bLoaded(true) })
      .catch(console.error)
  }

  const fetchPurchaseRegister = () => {
    if (!fyCode) return
    api.get('/reports/gst/purchase-register', { params: { fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => { setPurchaseRegister(res.data.purchase_register || []); setPurchaseLoaded(true) })
      .catch(console.error)
  }

  const RUN_REPORT = {
    sales: fetchSalesRegister,
    b2b: fetchB2b,
    hsn: fetchHsnSummary,
    gstr3b: fetchGstr3b,
    purchase: fetchPurchaseRegister,
  }

  // ── CSV column definitions (raw field names) ────────────────
  const registerCsvColumns = [
    { label: 'Date', accessor: 'date' },
    { label: 'Type', accessor: 'type' },
    { label: 'Voucher No', accessor: 'voucher_no' },
    { label: 'Party', accessor: 'party_name' },
    { label: 'GSTIN', accessor: 'gstin' },
    { label: 'Taxable', accessor: 'taxable' },
    { label: 'CGST', accessor: 'cgst' },
    { label: 'SGST', accessor: 'sgst' },
    { label: 'IGST', accessor: 'igst' },
    { label: 'Total', accessor: 'total' },
  ]
  const b2bCsvColumns = [
    { label: 'GSTIN', accessor: 'gstin' },
    { label: 'Party', accessor: 'party_name' },
    { label: 'Taxable', accessor: 'taxable' },
    { label: 'CGST', accessor: 'cgst' },
    { label: 'SGST', accessor: 'sgst' },
    { label: 'IGST', accessor: 'igst' },
    { label: 'Total', accessor: 'total' },
  ]
  const hsnCsvColumns = [
    { label: 'HSN Code', accessor: 'hsn_code' },
    { label: 'Qty', accessor: 'total_qty' },
    { label: 'Taxable', accessor: 'total_taxable' },
    { label: 'CGST', accessor: 'total_cgst' },
    { label: 'SGST', accessor: 'total_sgst' },
    { label: 'IGST', accessor: 'total_igst' },
    { label: 'Total', accessor: 'total' },
  ]
  const gstr3bCsvColumns = [
    { label: 'Outward Taxable', accessor: 'outward_taxable' },
    { label: 'Outward CGST', accessor: 'outward_cgst' },
    { label: 'Outward SGST', accessor: 'outward_sgst' },
    { label: 'Outward IGST', accessor: 'outward_igst' },
    { label: 'Inward CGST Credit', accessor: 'inward_cgst_credit' },
    { label: 'Inward SGST Credit', accessor: 'inward_sgst_credit' },
    { label: 'Inward IGST Credit', accessor: 'inward_igst_credit' },
    { label: 'Net CGST Payable', accessor: 'net_cgst_payable' },
    { label: 'Net SGST Payable', accessor: 'net_sgst_payable' },
    { label: 'Net IGST Payable', accessor: 'net_igst_payable' },
  ]

  // ── Table column definitions (for on-screen rendering) ───────
  const registerColumns = [
    { key: 'date', label: 'Date', render: v => formatDisplayDate(v) },
    { key: 'type', label: 'Type', render: v => <GstTypeBadge type={v} /> },
    { key: 'voucher_no', label: 'Voucher No', render: v => <span className="font-mono text-xs text-slate-600">{v}</span> },
    { key: 'party_name', label: 'Party', render: v => v || <span className="text-slate-300">—</span> },
    { key: 'gstin', label: 'GSTIN', render: v => v ? <span className="font-mono text-xs text-slate-600">{v}</span> : <span className="text-slate-300">—</span> },
    { key: 'taxable', label: 'Taxable', render: v => <Amount value={v} /> },
    { key: 'cgst', label: 'CGST', render: v => <Amount value={v} /> },
    { key: 'sgst', label: 'SGST', render: v => <Amount value={v} /> },
    { key: 'igst', label: 'IGST', render: v => <Amount value={v} /> },
    { key: 'total', label: 'Total', render: v => <Amount value={v} /> },
  ]

  const b2bColumns = [
    { key: 'gstin', label: 'GSTIN', render: v => v ? <span className="font-mono text-xs text-slate-600">{v}</span> : <span className="text-slate-300">—</span> },
    { key: 'party_name', label: 'Party', render: v => v || <span className="text-slate-300">—</span> },
    { key: 'taxable', label: 'Taxable', render: v => <Amount value={v} /> },
    { key: 'cgst', label: 'CGST', render: v => <Amount value={v} /> },
    { key: 'sgst', label: 'SGST', render: v => <Amount value={v} /> },
    { key: 'igst', label: 'IGST', render: v => <Amount value={v} /> },
    { key: 'total', label: 'Total', render: v => <Amount value={v} /> },
  ]

  const hsnColumns = [
    { key: 'hsn_code', label: 'HSN Code', render: v => <span className="font-mono text-xs text-slate-600">{v}</span> },
    { key: 'total_qty', label: 'Qty', render: v => <span className="tabular-nums text-slate-700">{fmt(v)}</span> },
    { key: 'total_taxable', label: 'Taxable', render: v => <Amount value={v} /> },
    { key: 'total_cgst', label: 'CGST', render: v => <Amount value={v} /> },
    { key: 'total_sgst', label: 'SGST', render: v => <Amount value={v} /> },
    { key: 'total_igst', label: 'IGST', render: v => <Amount value={v} /> },
    { key: 'total', label: 'Total', render: v => <Amount value={v} /> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-100 rounded-lg"><Percent size={18} className="text-primary-600" /></div>
        <div>
          <h2 className="font-bold text-slate-800">GST Reports</h2>
          <p className="text-xs text-slate-400">Sales Register, B2B, HSN Summary, GSTR-3B &amp; Purchase Register</p>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
              activeTab === t.key ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared filter card — every tab takes the same FY / From / To params */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="label">Financial Year</label>
            <select className="input-field" value={fyCode} onChange={e => setFyCode(e.target.value)}>
              <option value="">Select FY</option>
              {FY_OPTIONS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>
          </div>
          <div>
            <label className="label">From Date</label>
            <input type="date" className="input-field" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="label">To Date</label>
            <input type="date" className="input-field" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
          <button className="btn-primary flex items-center gap-2" onClick={() => RUN_REPORT[activeTab]?.()} disabled={!fyCode}>
            <Search size={15} />Run Report
          </button>
        </div>
      </div>

      {/* ---------- Sales Register ---------- */}
      {activeTab === 'sales' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(salesRegister, registerCsvColumns, 'sales_register.csv')} disabled={!salesRegister.length}>
              <Download size={15} />Export CSV
            </button>
          </div>
          {!salesLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view the Sales Register." />
          ) : (
            <>
              <TotalsSummary data={salesRegister} fields={[
                { key: 'taxable', label: 'Taxable' }, { key: 'cgst', label: 'CGST' }, { key: 'sgst', label: 'SGST' },
                { key: 'igst', label: 'IGST' }, { key: 'total', label: 'Grand Total' },
              ]} />
              <Table columns={registerColumns} data={salesRegister} emptyText="No sales or credit notes in the selected period." />
            </>
          )}
        </div>
      )}

      {/* ---------- B2B Summary ---------- */}
      {activeTab === 'b2b' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(b2bSummary, b2bCsvColumns, 'b2b_summary.csv')} disabled={!b2bSummary.length}>
              <Download size={15} />Export CSV
            </button>
          </div>
          {!b2bLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view B2B (GSTIN) sales." />
          ) : (
            <>
              <TotalsSummary data={b2bSummary} fields={[
                { key: 'taxable', label: 'Taxable' }, { key: 'cgst', label: 'CGST' }, { key: 'sgst', label: 'SGST' },
                { key: 'igst', label: 'IGST' }, { key: 'total', label: 'Grand Total' },
              ]} />
              <Table columns={b2bColumns} data={b2bSummary} emptyText="No B2B (GSTIN) sales in the selected period." />
            </>
          )}
        </div>
      )}

      {/* ---------- HSN Summary ---------- */}
      {activeTab === 'hsn' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(hsnSummary, hsnCsvColumns, 'hsn_summary.csv')} disabled={!hsnSummary.length}>
              <Download size={15} />Export CSV
            </button>
          </div>
          {!hsnLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view the HSN Summary." />
          ) : (
            <>
              <TotalsSummary data={hsnSummary} fields={[
                { key: 'total_taxable', label: 'Taxable' }, { key: 'total_cgst', label: 'CGST' }, { key: 'total_sgst', label: 'SGST' },
                { key: 'total_igst', label: 'IGST' }, { key: 'total', label: 'Grand Total' },
              ]} />
              <Table columns={hsnColumns} data={hsnSummary} emptyText="No sales line items in the selected period." />
            </>
          )}
        </div>
      )}

      {/* ---------- GSTR-3B Summary ---------- */}
      {activeTab === 'gstr3b' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(gstr3bSummary ? [gstr3bSummary] : [], gstr3bCsvColumns, 'gstr3b_summary.csv')} disabled={!gstr3bSummary}>
              <Download size={15} />Export CSV
            </button>
          </div>
          {!gstr3bLoaded || !gstr3bSummary ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view the GSTR-3B Summary." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Gstr3bCard title="Outward Supplies" rows={[
                { label: 'Taxable Value', value: gstr3bSummary.outward_taxable },
                { label: 'CGST', value: gstr3bSummary.outward_cgst },
                { label: 'SGST', value: gstr3bSummary.outward_sgst },
                { label: 'IGST', value: gstr3bSummary.outward_igst },
              ]} />
              <Gstr3bCard title="Input Tax Credit (Inward)" rows={[
                { label: 'CGST Credit', value: gstr3bSummary.inward_cgst_credit },
                { label: 'SGST Credit', value: gstr3bSummary.inward_sgst_credit },
                { label: 'IGST Credit', value: gstr3bSummary.inward_igst_credit },
              ]} />
              <Gstr3bCard title="Net Payable" rows={[
                { label: 'CGST Payable', value: gstr3bSummary.net_cgst_payable },
                { label: 'SGST Payable', value: gstr3bSummary.net_sgst_payable },
                { label: 'IGST Payable', value: gstr3bSummary.net_igst_payable },
              ]} />
            </div>
          )}
        </div>
      )}

      {/* ---------- Purchase Register ---------- */}
      {activeTab === 'purchase' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(purchaseRegister, registerCsvColumns, 'purchase_register.csv')} disabled={!purchaseRegister.length}>
              <Download size={15} />Export CSV
            </button>
          </div>
          {!purchaseLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view the Purchase Register." />
          ) : (
            <>
              <TotalsSummary data={purchaseRegister} fields={[
                { key: 'taxable', label: 'Taxable' }, { key: 'cgst', label: 'CGST' }, { key: 'sgst', label: 'SGST' },
                { key: 'igst', label: 'IGST' }, { key: 'total', label: 'Grand Total' },
              ]} />
              <Table columns={registerColumns} data={purchaseRegister} emptyText="No purchases or debit notes in the selected period." />
            </>
          )}
        </div>
      )}
    </div>
  )
}
