import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './store/auth'
import { Toaster } from './store/toast'
import { ConfirmHost } from './components/confirm'
import { Loading } from './components/ui'
import { AppShell } from './shell/AppShell'
import { LoginPage } from './pages/auth/LoginPage'
import { SignupPage } from './pages/auth/SignupPage'
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { PosPage } from './pages/pos/PosPage'
import { OrdersPage } from './pages/OrdersPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { EmployeesPage } from './pages/EmployeesPage'
import { SessionsPage } from './pages/SessionsPage'
import { MenuPage } from './pages/MenuPage'
import { DealsPage } from './pages/DealsPage'
import { ReportsPage } from './pages/ReportsPage'
import { PrinterPage } from './pages/PrinterPage'
import { SettingsPage } from './pages/SettingsPage'
import { AuditPage } from './pages/AuditPage'
import { MySessionPage } from './pages/employee/MySessionPage'
import { MySalesPage } from './pages/employee/MySalesPage'

export function App(): JSX.Element {
  const { user, ready, restore } = useAuth()

  useEffect(() => {
    void restore()
  }, [restore])

  if (!ready) {
    return (
      <div className="boot">
        <div className="boot__brand-ur urdu">ہاشمی کا ڈیرہ</div>
        <div className="boot__brand">HASHMI KA DERA</div>
        <Loading label="Starting up…" />
      </div>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/signup" element={user ? <Navigate to="/" replace /> : <SignupPage />} />
        <Route path="/*" element={<Protected />} />
      </Routes>
      <Toaster />
      <ConfirmHost />
    </>
  )
}

function Protected(): JSX.Element {
  const { user } = useAuth()
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (user.mustChangePassword && loc.pathname !== '/change-password')
    return <Navigate to="/change-password" replace />

  const isAdmin = user.role === 'ADMIN'

  return (
    <Routes>
      <Route path="/change-password" element={<ChangePasswordPage />} />
      <Route element={<AppShell />}>
        <Route index element={isAdmin ? <DashboardPage /> : <Navigate to="/pos" replace />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="my-session" element={<MySessionPage />} />
        <Route path="my-sales" element={<MySalesPage />} />
        <Route path="my-invoices" element={<InvoicesPage scope="mine" />} />
        {isAdmin && <Route path="dashboard" element={<DashboardPage />} />}
        {isAdmin && <Route path="orders" element={<OrdersPage />} />}
        {isAdmin && <Route path="employees" element={<EmployeesPage />} />}
        {isAdmin && <Route path="sessions" element={<SessionsPage />} />}
        {isAdmin && <Route path="menu" element={<MenuPage />} />}
        {isAdmin && <Route path="deals" element={<DealsPage />} />}
        {isAdmin && <Route path="invoices" element={<InvoicesPage scope="all" />} />}
        {isAdmin && <Route path="reports" element={<ReportsPage />} />}
        {isAdmin && <Route path="printer" element={<PrinterPage />} />}
        {isAdmin && <Route path="settings" element={<SettingsPage />} />}
        {isAdmin && <Route path="audit" element={<AuditPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
