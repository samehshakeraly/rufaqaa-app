import { Navigate, Route, Routes } from "react-router-dom";

import { AdminRoute } from "./components/AdminRoute";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { AuditPage } from "./pages/AuditPage";
import { BankTransfersPage } from "./pages/BankTransfersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DonorsPage } from "./pages/DonorsPage";
import { FamiliesPage } from "./pages/FamiliesPage";
import { FamilyDetailPage } from "./pages/FamilyDetailPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { MarketingChannelsPage } from "./pages/MarketingChannelsPage";
import { MyPortalPage } from "./pages/MyPortalPage";
import { OrphanDetailPage } from "./pages/OrphanDetailPage";
import { OrphansPage } from "./pages/OrphansPage";
import { PartnerDetailPage } from "./pages/PartnerDetailPage";
import { PartnersPage } from "./pages/PartnersPage";
import { PaymentReceiptPage } from "./pages/PaymentReceiptPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SponsorshipsPage } from "./pages/SponsorshipsPage";
import { UsersPage } from "./pages/UsersPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/orphans" element={<OrphansPage />} />
        <Route path="/orphans/:id" element={<OrphanDetailPage />} />
        <Route path="/donors" element={<DonorsPage />} />
        <Route path="/families" element={<FamiliesPage />} />
        <Route path="/families/:id" element={<FamilyDetailPage />} />
        <Route path="/partners" element={<PartnersPage />} />
        <Route path="/partners/:id" element={<PartnerDetailPage />} />
        <Route
          path="/marketing-channels"
          element={
            <AdminRoute>
              <MarketingChannelsPage />
            </AdminRoute>
          }
        />
        <Route path="/sponsorships" element={<SponsorshipsPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/payments/:id/receipt" element={<PaymentReceiptPage />} />
        <Route
          path="/bank-transfers"
          element={
            <AdminRoute>
              <BankTransfersPage />
            </AdminRoute>
          }
        />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:id" element={<ReportDetailPage />} />
        <Route
          path="/audit"
          element={
            <AdminRoute>
              <AuditPage />
            </AdminRoute>
          }
        />
        <Route
          path="/users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
        <Route path="/me" element={<MyPortalPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
