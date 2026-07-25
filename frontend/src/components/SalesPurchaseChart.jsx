import { useEffect, useState } from 'react'
import { TrendingUp, ShoppingCart, ShoppingBag, Wallet } from 'lucide-react'
import api from '../api'

/**
 * SalesPurchaseChart — Dashboard widget answering "how much came in (Sales) vs went
 * out (Purchases)" for the current week, current month, or current financial year,
 * backed by GET /reports/analytics/sales-purchases. Self-contained (own state +
 * fetch), same Week/Month/Year windowing convention as DoctorWorkloadChart.
 *
 * Two grouped (side-by-side) bars per bucket, rather than stacked — Sales and
 * Purchases aren't parts of one whole, so stacking them the way Doctor Workload
 * stacks Appointments/Due-Revisits would be misleading.
 *
 * X-axis granularity follows the window: Week -> one pair of bars per day (Mon-Sun),
 * Month -> one pair per calendar day, Year -> one pair per month of the current
 * financial year.
 */

const WINDOWS = [
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year',  label: 'Year' },
]

function niceMax(n) {
  if (n <= 5) return 5
  const magnitude = Math.pow(10, Math.floor(Math.log10(n)))
  const residual = n / magnitude
  let niceResidual
  if (residual <= 1) niceResidual = 1
  else if (residual <= 2) niceResidual = 2
  else if (residual <= 5) niceResidual = 5
  else niceResidual = 10
  return niceResidual * magnitude
}

const todayIso = () => new Date().toISOString().slice(0, 10)

const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export default function SalesPurchaseChart() {
  const [window_, setWindow] = useState('week')
  const [refDate, setRefDate] = useState(todayIso())
  const [rangeLabel, setRangeLabel] = useState('')
  const [totals, setTotals] = useState({ sales: 0, purchases: 0 })
  const [buckets, setBuckets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/reports/analytics/sales-purchases', {
      params: {
        window: window_,
        ...(window_ === 'year' ? {} : { ref_date: refDate }),
      }
    })
      .then(r => {
        setBuckets(r.data.buckets || [])
        setRangeLabel(r.data.range_label || '')
        setTotals({ sales: r.data.total_sales || 0, purchases: r.data.total_purchases || 0 })
      })
      .catch(() => { setBuckets([]); setRangeLabel(''); setTotals({ sales: 0, purchases: 0 }) })
      .finally(() => setLoading(false))
  }, [window_, refDate])

  const max = niceMax(Math.max(1, ...buckets.flatMap(b => [b.sales, b.purchases])))
  const ticks = [1, 0.75, 0.5, 0.25, 0].map(f => Math.round(max * f))
  const hasAnyData = buckets.some(b => b.sales > 0 || b.purchases > 0)
  const net = totals.sales - totals.purchases
  // Month view can have 28-31 bar-pairs — give each a minimum width and let the row
  // scroll horizontally rather than squeezing bars unreadably thin.
  const minBarColWidth = window_ === 'month' ? 40 : window_ === 'year' ? 70 : 60

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
            <TrendingUp size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Sales vs Purchases</h3>
            <p className="text-xs text-slate-400">{rangeLabel || 'Revenue vs cost of goods'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {window_ !== 'year' && (
            <input
              type="date"
              className="input-field !py-1.5 !text-xs !w-auto"
              value={refDate}
              max={todayIso()}
              onChange={e => setRefDate(e.target.value)}
            />
          )}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            {WINDOWS.map(w => (
              <button
                key={w.key}
                onClick={() => setWindow(w.key)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  window_ === w.key
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Totals ribbon */}
      <div className="grid grid-cols-3 gap-3 mt-3 mb-2">
        <div className="rounded-xl p-3 bg-emerald-50 border border-emerald-100 flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-600"><ShoppingBag size={15} /></div>
          <div>
            <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Total Sales</p>
            <p className="text-sm font-black text-emerald-800">{fmtMoney(totals.sales)}</p>
          </div>
        </div>
        <div className="rounded-xl p-3 bg-rose-50 border border-rose-100 flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-rose-100 text-rose-600"><ShoppingCart size={15} /></div>
          <div>
            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-wide">Total Purchases</p>
            <p className="text-sm font-black text-rose-800">{fmtMoney(totals.purchases)}</p>
          </div>
        </div>
        <div className={`rounded-xl p-3 border flex items-center gap-2.5 ${net >= 0 ? 'bg-indigo-50 border-indigo-100' : 'bg-amber-50 border-amber-100'}`}>
          <div className={`p-1.5 rounded-lg ${net >= 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-amber-100 text-amber-600'}`}><Wallet size={15} /></div>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wide ${net >= 0 ? 'text-indigo-700' : 'text-amber-700'}`}>Net (Sales − Purchases)</p>
            <p className={`text-sm font-black ${net >= 0 ? 'text-indigo-800' : 'text-amber-800'}`}>{fmtMoney(net)}</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1 mb-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Sales
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm bg-rose-400" /> Purchases
        </span>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400 animate-pulse">
          Loading chart…
        </div>
      ) : !hasAnyData ? (
        <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400 gap-2">
          <TrendingUp size={28} className="opacity-30" />
          <p className="text-sm">No sales or purchase bills recorded for this period.</p>
        </div>
      ) : (
        <div className="flex mt-3">
          {/* Y axis */}
          <div className="flex flex-col justify-between h-64 pr-3 text-[11px] text-slate-400 font-medium text-right shrink-0" style={{ width: '44px' }}>
            {ticks.map(t => <span key={t}>{fmtMoney(t)}</span>)}
          </div>

          {/* Bars (horizontally scrollable for month view) */}
          <div className="flex-1 overflow-x-auto">
            <div className="relative h-64 border-l border-b border-slate-200" style={{ minWidth: `${buckets.length * minBarColWidth}px` }}>
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                {ticks.map(t => <div key={t} className="border-t border-slate-100 first:border-t-0" />)}
              </div>

              <div className="absolute inset-0 flex items-end justify-around px-2 gap-1">
                {buckets.map(b => {
                  const salesPct = b.sales > 0 ? Math.max((b.sales / max) * 100, 2) : 0
                  const purchPct = b.purchases > 0 ? Math.max((b.purchases / max) * 100, 2) : 0
                  return (
                    <div key={b.date} className="flex-1 flex items-end justify-center gap-0.5 h-full group">
                      <div
                        className="flex-1 max-w-[16px] rounded-t-sm bg-emerald-500 hover:bg-emerald-600 transition-colors"
                        style={{ height: `${salesPct}%` }}
                        title={`${b.label} — Sales: ${fmtMoney(b.sales)}`}
                      />
                      <div
                        className="flex-1 max-w-[16px] rounded-t-sm bg-rose-400 hover:bg-rose-500 transition-colors"
                        style={{ height: `${purchPct}%` }}
                        title={`${b.label} — Purchases: ${fmtMoney(b.purchases)}`}
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* X axis labels */}
            <div className="flex items-start justify-around px-2 gap-1 mt-1.5">
              {buckets.map(b => (
                <div key={b.date} className="flex-1 text-center">
                  <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap">{b.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
