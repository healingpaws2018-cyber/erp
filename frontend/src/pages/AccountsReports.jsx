import { useState, useEffect } from 'react'
import { saveAs } from 'file-saver'
import {
  BookOpen, BarChart3, Wallet, Landmark, Users, Building2,
  Search, Download, FileSearch
} from 'lucide-react'
import api from '../api'
import Table from '../components/Table'
import { formatDisplayDate } from '../utils'

// Same hardcoded FY list already used by JournalVoucher.jsx / PaymentVoucher.jsx — there is no
// backend endpoint that lists financial years yet, so every page that needs an FY dropdown
// duplicates this constant today. A real fix would add a `/financial-years` endpoint once and
// have every one of these pages read from it instead.
const FY_OPTIONS = ['2023-24', '2024-25', '2025-26', '2026-27']

const TABS = [
  { key: 'gl',       label: 'General Ledger',       icon: BookOpen },
  { key: 'tb',       label: 'Trial Balance',        icon: BarChart3 },
  { key: 'cash',     label: 'Cash Book',             icon: Wallet },
  { key: 'bank',     label: 'Bank Book',             icon: Landmark },
  { key: 'debtor',   label: 'Debtor Outstanding',    icon: Users },
  { key: 'creditor', label: 'Creditor Outstanding',  icon: Building2 },
]

const VOUCHER_TYPE_STYLES = {
  SalesBill:      'bg-blue-50 text-blue-700',
  PurchaseBill:   'bg-purple-50 text-purple-700',
  CreditNote:     'bg-amber-50 text-amber-700',
  DebitNote:      'bg-rose-50 text-rose-700',
  PaymentVoucher: 'bg-red-50 text-red-700',
  ReceiptVoucher: 'bg-emerald-50 text-emerald-700',
  AdvancePayment: 'bg-indigo-50 text-indigo-700',
  BankArrival:    'bg-teal-50 text-teal-700',
  JournalVoucher: 'bg-slate-100 text-slate-600',
}

// ── Formatting helpers ──────────────────────────────────────────
const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const VoucherBadge = ({ type }) => (
  <span className={`badge font-semibold ${VOUCHER_TYPE_STYLES[type] || 'bg-slate-100 text-slate-600'}`}>{type || '—'}</span>
)

const BalanceType = ({ type }) => (
  <span className={`text-[10px] font-bold ml-1 ${type === 'DR' ? 'text-blue-500' : 'text-rose-500'}`}>{type}</span>
)

const Amount = ({ value }) => (
  Number(value) > 0
    ? <span className="text-slate-700 font-medium tabular-nums">₹{fmt(value)}</span>
    : <span className="text-slate-300">—</span>
)

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
  const blob = new Blob([jsonToCsv(data, columns)], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, filename)
}

// ── Small shared bits ───────────────────────────────────────────
const FyDateFilters = ({ fyCode, setFyCode, fromDate, setFromDate, toDate, setToDate, showDates = true }) => (
  <>
    <div>
      <label className="label">Financial Year</label>
      <select className="input-field" value={fyCode} onChange={e => setFyCode(e.target.value)}>
        <option value="">Select FY</option>
        {FY_OPTIONS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
      </select>
    </div>
    {showDates && (
      <>
        <div>
          <label className="label">From Date</label>
          <input type="date" className="input-field" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="label">To Date</label>
          <input type="date" className="input-field" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
      </>
    )}
  </>
)

const BalanceSummary = ({ opening, closing }) => {
  if (!opening || !closing) return null
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="stat-card">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Opening Balance</p>
        <p className={`text-2xl font-bold mt-1 ${opening.balance_type === 'DR' ? 'text-blue-600' : 'text-rose-600'}`}>
          ₹{fmt(opening.net)} <BalanceType type={opening.balance_type} />
        </p>
      </div>
      <div className="stat-card">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Closing Balance</p>
        <p className={`text-2xl font-bold mt-1 ${closing.balance_type === 'DR' ? 'text-blue-600' : 'text-rose-600'}`}>
          ₹{fmt(closing.net)} <BalanceType type={closing.balance_type} />
        </p>
      </div>
    </div>
  )
}

const EmptyPrompt = ({ text }) => (
  <div className="card flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
    <FileSearch size={32} strokeWidth={1.5} />
    <p className="text-sm">{text}</p>
  </div>
)

export default function AccountsReports() {
  const [activeTab, setActiveTab] = useState('gl')

  // Common filters
  const [fyCode, setFyCode] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Tab 1 – General Ledger
  const [glId, setGlId] = useState('')
  const [glOptions, setGlOptions] = useState([])
  const [glData, setGlData] = useState([])
  const [glSummary, setGlSummary] = useState(null)
  const [glLoaded, setGlLoaded] = useState(false)

  // Tab 2 – Trial Balance
  const [tbAsOfDate, setTbAsOfDate] = useState('')
  const [tbData, setTbData] = useState([])
  const [tbTotals, setTbTotals] = useState(null)

  // Tab 3 – Cash Book
  const [cashData, setCashData] = useState([])
  const [cashSummary, setCashSummary] = useState(null)
  const [cashLoaded, setCashLoaded] = useState(false)

  // Tab 4 – Bank Book
  const [bankGlId, setBankGlId] = useState('')
  const [bankOptions, setBankOptions] = useState([])
  const [bankData, setBankData] = useState([])
  const [bankSummary, setBankSummary] = useState(null)
  const [bankLoaded, setBankLoaded] = useState(false)

  // Tab 5 – Debtor Outstanding
  const [debtorOwnerId, setDebtorOwnerId] = useState('')
  const [debtorData, setDebtorData] = useState([])
  const [debtorLoaded, setDebtorLoaded] = useState(false)

  // Tab 6 – Creditor Outstanding
  const [creditorSupplierId, setCreditorSupplierId] = useState('')
  const [creditorData, setCreditorData] = useState([])
  const [creditorLoaded, setCreditorLoaded] = useState(false)

  // Load GL options for dropdowns. The backend router for Chart of Accounts is mounted at
  // '/ledger' (see routes/ledger.py) — same endpoint Ledger.jsx itself uses.
  useEffect(() => {
    api.get('/ledger/gl').then(res => {
      setGlOptions(res.data)
      setBankOptions(res.data.filter(opt => opt.sub_group && opt.sub_group.toLowerCase().includes('bank')))
    }).catch(() => {})
  }, [])

  // ── Fetch handlers ──────────────────────────────────────────
  const fetchGeneralLedger = () => {
    if (!glId) return
    api.get('/reports/general-ledger', { params: { gl_id: glId, fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => {
        setGlData(res.data.transactions || [])
        setGlSummary({ opening: res.data.opening_balance, closing: res.data.closing_balance })
        setGlLoaded(true)
      })
  }

  const fetchTrialBalance = () => {
    if (!tbAsOfDate) return
    api.get('/reports/trial-balance', { params: { fy_code: fyCode, as_of_date: tbAsOfDate } })
      .then(res => {
        const rows = (res.data.groups || []).flatMap(g => g.accounts.map(a => ({ ...a, group_name: g.group_name })))
        setTbData(rows)
        setTbTotals({ dr: res.data.grand_total_dr, cr: res.data.grand_total_cr, isBalanced: res.data.is_balanced })
      })
  }

  const fetchCashBook = () => {
    api.get('/reports/cash-book', { params: { fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => {
        setCashData(res.data.transactions || [])
        setCashSummary(res.data.opening_balance ? { opening: res.data.opening_balance, closing: res.data.closing_balance } : null)
        setCashLoaded(true)
      })
  }

  const fetchBankBook = () => {
    if (!bankGlId) return
    // Backend param is 'bank_gl_id', not 'gl_id'.
    api.get('/reports/bank-book', { params: { bank_gl_id: bankGlId, fy_code: fyCode, from_date: fromDate || undefined, to_date: toDate || undefined } })
      .then(res => {
        const account = (res.data.accounts || [])[0]
        setBankData(account ? account.transactions : [])
        setBankSummary(account ? { opening: account.opening_balance, closing: account.closing_balance } : null)
        setBankLoaded(true)
      })
  }

  const fetchDebtorOutstanding = () => {
    api.get('/reports/debtor-outstanding', { params: { fy_code: fyCode, owner_id: debtorOwnerId || undefined } })
      .then(res => {
        setDebtorData((res.data.debtor_outstanding || []).map(r => ({ ...r, party_name: r.owner_name })))
        setDebtorLoaded(true)
      })
  }

  const fetchCreditorOutstanding = () => {
    api.get('/reports/creditor-outstanding', { params: { fy_code: fyCode, supplier_id: creditorSupplierId || undefined } })
      .then(res => {
        setCreditorData((res.data.creditor_outstanding || []).map(r => ({ ...r, party_name: r.supplier_name })))
        setCreditorLoaded(true)
      })
  }

  // ── CSV column definitions (raw field names) ────────────────
  const glCsvColumns = [
    { label: 'Date', accessor: 'posting_date' },
    { label: 'Voucher Type', accessor: 'voucher_type' },
    { label: 'Voucher No', accessor: 'voucher_no' },
    { label: 'Narration', accessor: 'narration' },
    { label: 'DR', accessor: 'dr_amount' },
    { label: 'CR', accessor: 'cr_amount' },
    { label: 'Running Balance', accessor: 'running_balance' },
  ]
  const tbCsvColumns = [
    { label: 'Group', accessor: 'group_name' },
    { label: 'GL Code', accessor: 'gl_code' },
    { label: 'GL Name', accessor: 'gl_name' },
    { label: 'DR Balance', accessor: 'dr' },
    { label: 'CR Balance', accessor: 'cr' },
  ]
  const cashCsvColumns = [
    { label: 'Date', accessor: 'posting_date' },
    { label: 'Voucher No', accessor: 'voucher_no' },
    { label: 'Voucher Type', accessor: 'voucher_type' },
    { label: 'Narration', accessor: 'narration' },
    { label: 'Cash In (DR)', accessor: 'dr_amount' },
    { label: 'Cash Out (CR)', accessor: 'cr_amount' },
    { label: 'Balance', accessor: 'running_balance' },
  ]
  const debtorCsvColumns = [
    { label: 'Party Name', accessor: 'party_name' },
    { label: 'Total Billed', accessor: 'total_billed' },
    { label: 'Total Received', accessor: 'total_received' },
    { label: 'Outstanding', accessor: 'outstanding' },
  ]
  const creditorCsvColumns = [
    { label: 'Party Name', accessor: 'party_name' },
    { label: 'Total Billed', accessor: 'total_billed' },
    { label: 'Total Paid', accessor: 'total_paid' },
    { label: 'Outstanding', accessor: 'outstanding' },
  ]

  // ── Table column definitions (for on-screen rendering) ───────
  const glColumns = [
    { key: 'posting_date', label: 'Date', render: v => formatDisplayDate(v) },
    { key: 'voucher_type', label: 'Type', render: v => <VoucherBadge type={v} /> },
    { key: 'voucher_no', label: 'Voucher No', render: v => <span className="font-mono text-xs text-slate-600">{v}</span> },
    { key: 'narration', label: 'Narration' },
    { key: 'dr_amount', label: 'Debit', render: v => <Amount value={v} /> },
    { key: 'cr_amount', label: 'Credit', render: v => <Amount value={v} /> },
    {
      key: 'running_balance', label: 'Running Balance',
      render: (v, row) => (
        <span className={`font-semibold tabular-nums ${row.balance_type === 'DR' ? 'text-blue-600' : 'text-rose-600'}`}>
          ₹{fmt(v)} <BalanceType type={row.balance_type} />
        </span>
      )
    },
  ]

  const tbColumns = [
    { key: 'group_name', label: 'Group' },
    { key: 'gl_code', label: 'GL Code', render: v => <span className="font-mono text-xs text-slate-600">{v}</span> },
    { key: 'gl_name', label: 'Account' },
    { key: 'dr', label: 'Debit', render: v => <Amount value={v} /> },
    { key: 'cr', label: 'Credit', render: v => <Amount value={v} /> },
  ]

  const cashLikeColumns = [
    { key: 'posting_date', label: 'Date', render: v => formatDisplayDate(v) },
    { key: 'voucher_no', label: 'Voucher No', render: v => <span className="font-mono text-xs text-slate-600">{v}</span> },
    { key: 'voucher_type', label: 'Type', render: v => <VoucherBadge type={v} /> },
    { key: 'narration', label: 'Narration' },
    { key: 'dr_amount', label: 'Cash In (DR)', render: v => <Amount value={v} /> },
    { key: 'cr_amount', label: 'Cash Out (CR)', render: v => <Amount value={v} /> },
    {
      key: 'running_balance', label: 'Balance',
      render: (v, row) => (
        <span className={`font-semibold tabular-nums ${row.balance_type === 'DR' ? 'text-blue-600' : 'text-rose-600'}`}>
          ₹{fmt(v)} <BalanceType type={row.balance_type} />
        </span>
      )
    },
  ]

  const debtorColumns = [
    { key: 'party_name', label: 'Owner' },
    { key: 'total_billed', label: 'Total Billed', render: v => <Amount value={v} /> },
    { key: 'total_received', label: 'Total Received', render: v => <Amount value={v} /> },
    { key: 'outstanding', label: 'Outstanding', render: v => <span className="font-semibold text-rose-600 tabular-nums">₹{fmt(v)}</span> },
  ]

  const creditorColumns = [
    { key: 'party_name', label: 'Supplier' },
    { key: 'total_billed', label: 'Total Billed', render: v => <Amount value={v} /> },
    { key: 'total_paid', label: 'Total Paid', render: v => <Amount value={v} /> },
    { key: 'outstanding', label: 'Outstanding', render: v => <span className="font-semibold text-rose-600 tabular-nums">₹{fmt(v)}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-100 rounded-lg"><BarChart3 size={18} className="text-primary-600" /></div>
        <div>
          <h2 className="font-bold text-slate-800">Accounts Reports</h2>
          <p className="text-xs text-slate-400">General Ledger, Trial Balance, Cash/Bank Books &amp; Outstanding</p>
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

      {/* ---------- General Ledger ---------- */}
      {activeTab === 'gl' && (
        <div className="space-y-4">
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="label">GL Account</label>
                <select className="input-field" value={glId} onChange={e => setGlId(e.target.value)}>
                  <option value="">Select account…</option>
                  {glOptions.map(opt => (
                    <option key={opt.gl_id} value={opt.gl_id}>{opt.gl_code} — {opt.gl_name}</option>
                  ))}
                </select>
              </div>
              <FyDateFilters fyCode={fyCode} setFyCode={setFyCode} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <button className="btn-primary flex items-center gap-2" onClick={fetchGeneralLedger} disabled={!glId}>
                <Search size={15} />Run Report
              </button>
              <button
                className="btn-secondary flex items-center gap-2"
                onClick={() => downloadCsv(glData, glCsvColumns, 'general_ledger.csv')}
                disabled={!glData.length}
              >
                <Download size={15} />Export CSV
              </button>
            </div>
          </div>

          {!glLoaded ? (
            <EmptyPrompt text="Select a GL account and click Run Report to view its ledger." />
          ) : (
            <>
              <BalanceSummary opening={glSummary?.opening} closing={glSummary?.closing} />
              <Table columns={glColumns} data={glData} emptyText="No transactions posted for this account in the selected period." />
            </>
          )}
        </div>
      )}

      {/* ---------- Trial Balance ---------- */}
      {activeTab === 'tb' && (
        <div className="space-y-4">
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="label">Financial Year</label>
                <select className="input-field" value={fyCode} onChange={e => setFyCode(e.target.value)}>
                  <option value="">Select FY</option>
                  {FY_OPTIONS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
                </select>
              </div>
              <div>
                <label className="label">As Of Date</label>
                <input type="date" className="input-field" value={tbAsOfDate} onChange={e => setTbAsOfDate(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <button className="btn-primary flex items-center gap-2" onClick={fetchTrialBalance} disabled={!tbAsOfDate}>
                <Search size={15} />Run Report
              </button>
              <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(tbData, tbCsvColumns, 'trial_balance.csv')} disabled={!tbData.length}>
                <Download size={15} />Export CSV
              </button>
            </div>
          </div>
          {tbTotals && (
            <div className="stat-card flex items-center justify-between">
              <div className="flex gap-6">
                <div><p className="text-xs text-slate-400 uppercase font-semibold">Grand Total DR</p><p className="font-bold text-slate-700">₹{fmt(tbTotals.dr)}</p></div>
                <div><p className="text-xs text-slate-400 uppercase font-semibold">Grand Total CR</p><p className="font-bold text-slate-700">₹{fmt(tbTotals.cr)}</p></div>
              </div>
              <span className={`badge font-semibold ${tbTotals.isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                {tbTotals.isBalanced ? 'Balanced ✓' : 'Not Balanced ✗'}
              </span>
            </div>
          )}
          <Table columns={tbColumns} data={tbData} emptyText="Select a Financial Year and As Of Date, then click Run Report." />
        </div>
      )}

      {/* ---------- Cash Book ---------- */}
      {activeTab === 'cash' && (
        <div className="space-y-4">
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <FyDateFilters fyCode={fyCode} setFyCode={setFyCode} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <button className="btn-primary flex items-center gap-2" onClick={fetchCashBook}><Search size={15} />Run Report</button>
              <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(cashData, cashCsvColumns, 'cash_book.csv')} disabled={!cashData.length}>
                <Download size={15} />Export CSV
              </button>
            </div>
          </div>
          {!cashLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view cash movements." />
          ) : (
            <>
              <BalanceSummary opening={cashSummary?.opening} closing={cashSummary?.closing} />
              <Table columns={cashLikeColumns} data={cashData} emptyText="No cash transactions in the selected period." />
            </>
          )}
        </div>
      )}

      {/* ---------- Bank Book ---------- */}
      {activeTab === 'bank' && (
        <div className="space-y-4">
          <div className="card">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="label">Bank Account</label>
                <select className="input-field" value={bankGlId} onChange={e => setBankGlId(e.target.value)}>
                  <option value="">Select bank account…</option>
                  {bankOptions.map(opt => (
                    <option key={opt.gl_id} value={opt.gl_id}>{opt.gl_code} — {opt.gl_name}</option>
                  ))}
                </select>
              </div>
              <FyDateFilters fyCode={fyCode} setFyCode={setFyCode} fromDate={fromDate} setFromDate={setFromDate} toDate={toDate} setToDate={setToDate} />
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <button className="btn-primary flex items-center gap-2" onClick={fetchBankBook} disabled={!bankGlId}><Search size={15} />Run Report</button>
              <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(bankData, cashCsvColumns, 'bank_book.csv')} disabled={!bankData.length}>
                <Download size={15} />Export CSV
              </button>
            </div>
          </div>
          {!bankLoaded ? (
            <EmptyPrompt text="Select a bank account and click Run Report to view its transactions." />
          ) : (
            <>
              <BalanceSummary opening={bankSummary?.opening} closing={bankSummary?.closing} />
              <Table columns={cashLikeColumns} data={bankData} emptyText="No transactions posted for this bank account in the selected period." />
            </>
          )}
        </div>
      )}

      {/* ---------- Debtor Outstanding ---------- */}
      {activeTab === 'debtor' && (
        <div className="space-y-4">
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
                <label className="label">Owner ID (optional)</label>
                <input type="text" className="input-field" placeholder="Leave blank for all owners" value={debtorOwnerId} onChange={e => setDebtorOwnerId(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <button className="btn-primary flex items-center gap-2" onClick={fetchDebtorOutstanding}><Search size={15} />Run Report</button>
              <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(debtorData, debtorCsvColumns, 'debtor_outstanding.csv')} disabled={!debtorData.length}>
                <Download size={15} />Export CSV
              </button>
            </div>
          </div>
          {!debtorLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view outstanding owner balances." />
          ) : (
            <Table columns={debtorColumns} data={debtorData} emptyText="No outstanding balances found." />
          )}
        </div>
      )}

      {/* ---------- Creditor Outstanding ---------- */}
      {activeTab === 'creditor' && (
        <div className="space-y-4">
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
                <label className="label">Supplier ID (optional)</label>
                <input type="text" className="input-field" placeholder="Leave blank for all suppliers" value={creditorSupplierId} onChange={e => setCreditorSupplierId(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
              <button className="btn-primary flex items-center gap-2" onClick={fetchCreditorOutstanding}><Search size={15} />Run Report</button>
              <button className="btn-secondary flex items-center gap-2" onClick={() => downloadCsv(creditorData, creditorCsvColumns, 'creditor_outstanding.csv')} disabled={!creditorData.length}>
                <Download size={15} />Export CSV
              </button>
            </div>
          </div>
          {!creditorLoaded ? (
            <EmptyPrompt text="Select a Financial Year and click Run Report to view outstanding supplier balances." />
          ) : (
            <Table columns={creditorColumns} data={creditorData} emptyText="No outstanding balances found." />
          )}
        </div>
      )}
    </div>
  )
}
