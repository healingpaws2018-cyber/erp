import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ModuleGuard from './components/ModuleGuard'
import { ROUTE_MODULE_MAP } from './constants/permissions'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClinicSetup from './pages/ClinicSetup'
import Masters from './pages/Masters'
import PetOwners from './pages/PetOwners'
import Pets from './pages/Pets'
import Doctors from './pages/Doctors'
import PetBook from './pages/PetBook'
// Phase 2
import Appointments from './pages/Appointments'
import Consultations from './pages/Consultations'
import ConsultationForm from './pages/ConsultationForm'
import Vaccination from './pages/Vaccination'
// Phase 3
import Medicines from './pages/Medicines'
import ProceduresMaster from './pages/ProceduresMaster'
import Suppliers from './pages/Suppliers'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import SalesBilling from './pages/SalesBill'
import Ledger from './pages/Ledger'
import Agents from './pages/Agents'
import UsersPage from './pages/Users'
import Companies from './pages/Companies'
import AdvancePayments from './pages/AdvancePayments'
import BankArrivals from './pages/BankArrivals'
import ReceiptVoucher from './pages/ReceiptVoucher'
import PaymentVoucher from './pages/PaymentVoucher'
import JournalVoucher from './pages/JournalVoucher'
import CreditNote from './pages/CreditNote'
import DebitNote from './pages/DebitNote'
import GSTReports from './pages/GSTReports'
import AccountsReports from './pages/AccountsReports'

function PrivateRoute({ children }) {
  const token = localStorage.getItem('token')
  return token ? children : <Navigate to="/login" replace />
}

// Wraps a route's element in ModuleGuard, keyed off ROUTE_MODULE_MAP. Routes with no entry
// in the map (e.g. 'dashboard') have module === undefined, and ModuleGuard treats that as
// always-accessible — so it's safe to apply this uniformly to every nested route below
// rather than only the gated ones.
const gated = (path, element) => (
  <ModuleGuard module={ROUTE_MODULE_MAP[path]}>{element}</ModuleGuard>
)

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"    element={<Dashboard />} />
        <Route path="clinic-setup" element={gated('clinic-setup', <ClinicSetup />)} />
        <Route path="masters"      element={gated('masters', <Masters />)} />
        <Route path="owners"       element={gated('owners', <PetOwners />)} />
        <Route path="pets"         element={gated('pets', <Pets />)} />
        <Route path="doctors"      element={gated('doctors', <Doctors />)} />
        {/* Master System */}
        <Route path="companies"    element={gated('companies', <Companies />)} />
        {/* Phase 2 */}
        <Route path="appointments"           element={gated('appointments', <Appointments />)} />
        <Route path="consultations"          element={gated('consultations', <Consultations />)} />
        <Route path="consultations/new"      element={gated('consultations/new', <ConsultationForm />)} />
        <Route path="consultations/:id"      element={gated('consultations/:id', <ConsultationForm />)} />
        <Route path="vaccination"            element={gated('vaccination', <Vaccination />)} />
        <Route path="pet-book"               element={gated('pet-book', <PetBook />)} />
        {/* Phase 3 */}
        <Route path="medicines"             element={gated('medicines', <Medicines />)} />
        <Route path="procedures"            element={gated('procedures', <ProceduresMaster />)} />
        <Route path="suppliers"             element={gated('suppliers', <Suppliers />)} />
        <Route path="inventory"             element={gated('inventory', <Inventory />)} />
        <Route path="purchases"             element={gated('purchases', <Purchases />)} />
        <Route path="sales-billing"         element={gated('sales-billing', <SalesBilling />)} />
        {/* Stage 1 & 2 */}
        <Route path="ledger"               element={gated('ledger', <Ledger />)} />
        <Route path="agents"               element={gated('agents', <Agents />)} />
        <Route path="users"                element={gated('users', <UsersPage />)} />
        <Route path="accounts/advance-payments"    element={gated('accounts/advance-payments', <AdvancePayments />)} />
        <Route path="accounts/bank-arrivals"       element={gated('accounts/bank-arrivals', <BankArrivals />)} />
        <Route path="accounts/receipt-vouchers"   element={gated('accounts/receipt-vouchers', <ReceiptVoucher />)} />
        <Route path="accounts/payment-vouchers"   element={gated('accounts/payment-vouchers', <PaymentVoucher />)} />
        <Route path="accounts/journal-vouchers"   element={gated('accounts/journal-vouchers', <JournalVoucher />)} />
        <Route path="accounts/credit-notes"       element={gated('accounts/credit-notes', <CreditNote />)} />
        <Route path="accounts/debit-notes"        element={gated('accounts/debit-notes', <DebitNote />)} />
        <Route path="reports/gst"                 element={gated('reports/gst', <GSTReports />)} />
        <Route path="reports/accounts"            element={gated('reports/accounts', <AccountsReports />)} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
