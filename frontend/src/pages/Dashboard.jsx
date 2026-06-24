import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, PawPrint, Stethoscope, UserCheck, TrendingUp, Calendar } from 'lucide-react'
import api from '../api'

function StatCard({ icon: Icon, label, value, color, sub, onClick }) {
  return (
    <div className={`stat-card cursor-pointer hover:shadow-md transition-shadow duration-150 active:scale-[0.98]`} onClick={onClick}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value ?? '—'}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color.replace('text-', 'bg-').replace('-700', '-100').replace('-600', '-100')}`}>
          <Icon size={20} className={color} />
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [counts, setCounts] = useState({ owners: 0, pets: 0, doctors: 0, staff: 0 })
  const [loading, setLoading] = useState(true)
  const [clinicName, setClinicName] = useState('')
  const user = JSON.parse(localStorage.getItem('user') || '{}')
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [owners, pets, doctors, staff] = await Promise.all([
          api.get('/owners').catch(() => ({ data: [] })),
          api.get('/pets').catch(() => ({ data: [] })),
          api.get('/doctors').catch(() => ({ data: [] })),
          api.get('/staff').catch(() => ({ data: [] })),
        ])
        setCounts({
          owners:  owners.data.length,
          pets:    pets.data.length,
          doctors: doctors.data.length,
          staff:   staff.data.length,
        })
      } finally {
        setLoading(false)
      }
    }
    fetchCounts()
    api.get('/clinic/setup')
      .then(r => setClinicName(r.data?.clinic_name || ''))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">{clinicName || user.company_name || 'Animal Clinic'}</h1>
            <p className="text-primary-100 text-base font-medium mt-1">Welcome back, {user.full_name?.split(' ')[0] || 'Admin'} 👋</p>
            <p className="text-primary-200 text-sm mt-1">{today}</p>
          </div>
          <div className="text-6xl opacity-20">🐾</div>
        </div>
      </div>

      {/* Stats */}
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Overview</h3>
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="stat-card animate-pulse">
                <div className="h-4 bg-slate-100 rounded w-3/4 mb-3" />
                <div className="h-8 bg-slate-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Users}       label="Pet Owners"  value={counts.owners}  color="text-primary-600"       sub="Registered owners" onClick={() => navigate('/owners')} />
            <StatCard icon={PawPrint}    label="Pets"        value={counts.pets}    color="text-clinic-green"      sub="Active patients" onClick={() => navigate('/pets')} />
            <StatCard icon={Stethoscope} label="Doctors"     value={counts.doctors} color="text-clinic-purple"     sub="Veterinarians" onClick={() => navigate('/doctors')} />
            <StatCard icon={UserCheck}   label="Staff"       value={counts.staff}   color="text-clinic-amber"      sub="Team members" onClick={() => navigate('/doctors')} />
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Add Pet Owner',  href: '/owners',  icon: '👤', color: 'bg-blue-50 hover:bg-blue-100 text-blue-700' },
            { label: 'Register Pet',   href: '/pets',    icon: '🐾', color: 'bg-green-50 hover:bg-green-100 text-green-700' },
            { label: 'Add Doctor',     href: '/doctors', icon: '👨‍⚕️', color: 'bg-purple-50 hover:bg-purple-100 text-purple-700' },
            { label: 'Clinic Setup',   href: '/clinic-setup', icon: '🏥', color: 'bg-orange-50 hover:bg-orange-100 text-orange-700' },
            { label: 'Manage Masters', href: '/masters', icon: '📋', color: 'bg-teal-50 hover:bg-teal-100 text-teal-700' },
            { label: 'Pet Health Book', href: '/pets',    icon: '📖', color: 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700' },
          ].map(({ label, href, icon, color }) => (
            <a
              key={label}
              href={href}
              className={`flex items-center gap-3 p-4 rounded-xl border border-transparent transition-all duration-150 font-medium text-sm ${color}`}
            >
              <span className="text-xl">{icon}</span>
              {label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
