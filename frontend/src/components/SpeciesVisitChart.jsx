import { useEffect, useState } from 'react'
import { Dog, Cat, Bird, Rabbit, Fish, Rat, PawPrint, BarChart3 } from 'lucide-react'
import api from '../api'

/**
 * SpeciesVisitChart — Dashboard widget answering "how many dogs/cats/etc visited" over a
 * selectable period (Daily / Weekly / Monthly / Financial Year), backed by
 * GET /appointments/analytics/species-summary. Self-contained: manages its own period/date
 * state and fetches its own data, same pattern as PetBookModal.
 *
 * Custom-built with plain divs (no charting library) — this app has no chart dependency
 * installed (checked package.json: no recharts/chart.js/etc), and adding one would mean the
 * user needs to `npm install` before this renders. A small bar chart doesn't need one.
 *
 * X-axis is dynamic by design (only species with visits in the period appear — if only dogs
 * came in, only a Dog bar shows), matching what the backend endpoint returns.
 */

const PERIODS = [
  { key: 'daily',   label: 'Daily' },
  { key: 'weekly',  label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'fy',      label: 'Financial Year' },
]

// Maps a species_name (free text from the Species master, admin-editable) to a
// representative icon. Falls back to a generic paw print for anything not covered here —
// the master can have any species, this can't enumerate all of them.
const SPECIES_ICONS = {
  dog: Dog, dogs: Dog,
  cat: Cat, cats: Cat,
  bird: Bird, birds: Bird,
  rabbit: Rabbit, rabbits: Rabbit,
  fish: Fish,
  rat: Rat, rats: Rat, hamster: Rat, mouse: Rat,
}
function iconFor(speciesName) {
  const key = (speciesName || '').trim().toLowerCase()
  return SPECIES_ICONS[key] || PawPrint
}

// Rounds a max value up to a "nice" round number for gridlines (e.g. 13 -> 15, 47 -> 50).
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

export default function SpeciesVisitChart() {
  const [period, setPeriod] = useState('daily')
  const [refDate, setRefDate] = useState(todayIso())
  const [rangeLabel, setRangeLabel] = useState('')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get('/appointments/analytics/species-summary', {
      params: { period, ...(period === 'fy' ? {} : { ref_date: refDate }) }
    })
      .then(r => {
        setData(r.data.data || [])
        setRangeLabel(r.data.range_label || '')
      })
      .catch(() => { setData([]); setRangeLabel('') })
      .finally(() => setLoading(false))
  }, [period, refDate])

  const max = niceMax(Math.max(1, ...data.map(d => d.count)))
  const ticks = [1, 0.75, 0.5, 0.25, 0].map(f => Math.round(max * f))

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-primary-50 text-primary-600">
            <BarChart3 size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Species Visit Analytics</h3>
            <p className="text-xs text-slate-400">{rangeLabel || 'Appointments by species'}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {period !== 'fy' && (
            <input
              type="date"
              className="input-field !py-1.5 !text-xs !w-auto"
              value={refDate}
              max={todayIso()}
              onChange={e => setRefDate(e.target.value)}
            />
          )}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  period === p.key
                    ? 'bg-white text-primary-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center text-sm text-slate-400 animate-pulse">
          Loading chart…
        </div>
      ) : data.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400 gap-2">
          <PawPrint size={28} className="opacity-30" />
          <p className="text-sm">No appointment visits recorded for this period.</p>
        </div>
      ) : (
        <div className="flex mt-4">
          {/* Y axis */}
          <div className="flex flex-col justify-between h-64 pr-3 text-[11px] text-slate-400 font-medium text-right">
            {ticks.map(t => <span key={t}>{t}</span>)}
          </div>

          {/* Bars */}
          <div className="flex-1 relative h-64 border-l border-b border-slate-200">
            {/* Gridlines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              {ticks.map(t => <div key={t} className="border-t border-slate-100 first:border-t-0" />)}
            </div>

            <div className="absolute inset-0 flex items-end justify-around px-4 gap-4">
              {data.map(d => {
                const pct = Math.max((d.count / max) * 100, 3)
                return (
                  <div key={d.species_id} className="flex-1 max-w-[96px] flex flex-col items-center justify-end h-full group">
                    <span className="text-xs font-bold text-slate-700 mb-1">{d.count}</span>
                    <div
                      className="w-full rounded-t-lg bg-gradient-to-t from-primary-600 to-primary-400 shadow-sm group-hover:from-primary-700 group-hover:to-primary-500 transition-colors"
                      style={{ height: `${pct}%` }}
                      title={`${d.species_name}: ${d.count} visit${d.count === 1 ? '' : 's'}`}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* X axis labels (icon + species name), aligned under the bars above */}
      {!loading && data.length > 0 && (
        <div className="flex mt-2">
          <div className="pr-3" style={{ width: '28px' }} />
          <div className="flex-1 flex items-start justify-around px-4 gap-4">
            {data.map(d => {
              const Icon = iconFor(d.species_name)
              return (
                <div key={d.species_id} className="flex-1 max-w-[96px] flex flex-col items-center gap-1">
                  <div className="p-1.5 rounded-lg bg-primary-50 text-primary-600">
                    <Icon size={16} />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 text-center leading-tight">{d.species_name}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
