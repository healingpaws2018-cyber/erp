/**
 * constants/permissions.js — Shared frontend permission helpers.
 *
 * Backs the "Hide + block in the UI" enforcement of the per-user module permissions
 * configured in Users.jsx (see routes/users.py's PERMISSION_MODULES / UserModulePermission).
 * This is frontend-only enforcement: it hides Sidebar nav items and blocks direct
 * navigation to routes the user lacks View access for. It does NOT restrict the backend
 * API itself — a user who knows an endpoint URL can still call it directly. Real API-level
 * enforcement (wiring routes/auth.py's enforce_module_access, or checking
 * UserModulePermission per-route) is a separate, larger follow-up, deferred on purpose.
 *
 * Mirrors backend/routes/users.py's PERMISSION_MODULES exactly.
 */
export const PERMISSION_MODULES = ["Clinic", "Masters", "Billing", "Pharmacy", "Inventory", "Reports", "Users"]

/**
 * Maps every gated App.jsx route path (relative, as declared in <Route path="...">, no
 * leading slash) to the module code that governs it. A route with no entry here (e.g.
 * 'dashboard') is always accessible to any logged-in user — there's no sensible way to
 * lock someone out of the landing page.
 */
export const ROUTE_MODULE_MAP = {
  'clinic-setup': 'Masters',
  'masters':      'Masters',
  'owners':       'Masters',
  'pets':         'Masters',
  'doctors':      'Masters',
  'agents':       'Masters',
  'suppliers':    'Masters',
  'medicines':    'Masters',

  'appointments':          'Clinic',
  'consultations':         'Clinic',
  'consultations/new':     'Clinic',
  'consultations/:id':     'Clinic',
  'vaccination':           'Clinic',
  'procedures':            'Clinic',
  'pet-book':              'Clinic',

  'sales-billing':                  'Billing',
  'ledger':                         'Billing',
  'accounts/advance-payments':      'Billing',
  'accounts/bank-arrivals':         'Billing',
  'accounts/receipt-vouchers':      'Billing',
  'accounts/payment-vouchers':      'Billing',
  'accounts/journal-vouchers':      'Billing',
  'accounts/credit-notes':          'Billing',
  'accounts/debit-notes':           'Billing',

  'purchases': 'Pharmacy',

  'inventory': 'Inventory',

  'reports/gst':      'Reports',
  'reports/accounts': 'Reports',

  'users':     'Users',
  'companies': 'Users',
}

/** localStorage key holding the cached { modules, has_custom_permissions } payload. */
export const PERMISSIONS_STORAGE_KEY = 'permissions'

export function isAdmin(user) {
  return (user?.role || '').toLowerCase() === 'admin'
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}')
  } catch {
    return {}
  }
}

export function getStoredPermissions() {
  try {
    const raw = localStorage.getItem(PERMISSIONS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Returns true if the current user may VIEW `moduleCode`.
 * - Admins always pass, regardless of saved rows.
 * - If the admin has never configured this user's permissions (has_custom_permissions is
 *   false, or permissions failed to load), access is unrestricted — matches the pre-existing
 *   behavior for every user an admin hasn't touched.
 * - Otherwise, respects the saved can_view flag exactly (Users.jsx always sends all 7
 *   modules on every save, so a saved row set is a complete, authoritative picture).
 */
export function hasViewAccess(moduleCode, user = getStoredUser(), permState = getStoredPermissions()) {
  if (!moduleCode) return true
  if (isAdmin(user)) return true
  if (!permState || !permState.has_custom_permissions) return true
  const row = (permState.modules || []).find(m => m.module_code === moduleCode)
  return !!row?.can_view
}

/** Fetches and caches this user's permissions right after login. Never throws — a failed
 * fetch just leaves permissions uncached, which hasViewAccess treats as unrestricted so a
 * network hiccup at login can't lock someone out of the whole app. */
export async function fetchAndStorePermissions(apiClient, userId) {
  try {
    const res = await apiClient.get(`/users/${userId}/permissions`)
    localStorage.setItem(PERMISSIONS_STORAGE_KEY, JSON.stringify({
      modules: res.data.modules,
      has_custom_permissions: res.data.has_custom_permissions,
    }))
  } catch (err) {
    console.warn('Could not load module permissions — defaulting to unrestricted access', err)
    localStorage.removeItem(PERMISSIONS_STORAGE_KEY)
  }
}
