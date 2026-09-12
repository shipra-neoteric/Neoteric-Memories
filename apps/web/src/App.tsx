import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './layout/AdminLayout'
import { RequireAuth } from './layout/RequireAuth'
import { LoginPage } from './pages/admin/LoginPage'
import { DashboardPage } from './pages/admin/DashboardPage'
import { SitesPage } from './pages/admin/SitesPage'
import { UsersPage } from './pages/admin/UsersPage'
import { EventsPage } from './pages/admin/EventsPage'
import { EventDetailPage } from './pages/admin/EventDetailPage'
import { ConsentVersionsPage } from './pages/admin/ConsentVersionsPage'
import { RetentionPoliciesPage } from './pages/admin/RetentionPoliciesPage'
import { AuditLogPage } from './pages/admin/AuditLogPage'
import { ReportsPage } from './pages/admin/ReportsPage'
import { GuestFlow } from './guest/GuestFlow'
import { GuestLanding } from './guest/GuestLanding'
import { GuestConsent } from './guest/GuestConsent'
import { GuestSelfie } from './guest/GuestSelfie'
import { GuestResults } from './guest/GuestResults'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="sites" element={<SitesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventDetailPage />} />
        <Route path="consent-versions" element={<ConsentVersionsPage />} />
        <Route path="retention-policies" element={<RetentionPoliciesPage />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>

      <Route path="/e/:token" element={<GuestFlow />}>
        <Route index element={<GuestLanding />} />
        <Route path="consent" element={<GuestConsent />} />
        <Route path="selfie" element={<GuestSelfie />} />
        <Route path="results" element={<GuestResults />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
