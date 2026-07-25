import { ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getStoredUser, hasViewAccess } from '../constants/permissions'

/**
 * ModuleGuard — route-level enforcement of the per-user module permissions configured in
 * Users.jsx. Wrap a route's element with <ModuleGuard module="Clinic">...</ModuleGuard> (see
 * App.jsx's ROUTE_MODULE_MAP-driven usage) to block direct navigation — typed URLs,
 * bookmarks, browser back/forward — to a module the logged-in user lacks View access to.
 *
 * This complements Sidebar.jsx's nav filtering: that hides the link, this stops the page
 * from rendering if someone reaches the URL another way. Both are frontend-only — the
 * underlying API endpoints are not restricted by this (see constants/permissions.js).
 */
export default function ModuleGuard({ module, children }) {
  const navigate = useNavigate()
  const user = getStoredUser()

  if (hasViewAccess(module, user)) {
    return children
  }

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mb-4">
        <ShieldAlert size={32} />
      </div>
      <h1 className="text-xl font-bold text-slate-800 mb-2">Access Restricted</h1>
      <p className="text-sm text-slate-500 max-w-sm mb-6">
        You don't have permission to view this module. Contact an administrator if you believe this is a mistake.
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className="btn-primary"
      >
        Back to Dashboard
      </button>
    </div>
  )
}
