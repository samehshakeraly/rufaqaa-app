import { Navigate, Route, Routes } from "react-router-dom";

import { AdminRoute } from "./components/AdminRoute";
import { DonorRoute } from "./components/DonorRoute";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { DonorLayout } from "./components/layout/DonorLayout";
import { PublicLayout } from "./components/layout/PublicLayout";

// Admin / staff pages (now mounted under /admin/*)
import { AuditPage } from "./pages/AuditPage";
import { BankTransfersPage } from "./pages/BankTransfersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DonorDashboardPage } from "./pages/DonorDashboardPage";
import { DonorProfilePage } from "./pages/DonorProfilePage";
import { DonorSponsorshipsPage } from "./pages/DonorSponsorshipsPage";
import { DonorsPage } from "./pages/DonorsPage";
import { FamiliesPage } from "./pages/FamiliesPage";
import { FamilyDetailPage } from "./pages/FamilyDetailPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { MarketingChannelsPage } from "./pages/MarketingChannelsPage";
import { MyPortalPage } from "./pages/MyPortalPage";
import { OrphanDetailPage } from "./pages/OrphanDetailPage";
import { OrphansPage } from "./pages/OrphansPage";
import { PartnerDetailPage } from "./pages/PartnerDetailPage";
import { PartnersPage } from "./pages/PartnersPage";
import { PaymentFailurePage } from "./pages/PaymentFailurePage";
import { PaymentReceiptPage } from "./pages/PaymentReceiptPage";
import { PaymentSuccessPage } from "./pages/PaymentSuccessPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { PublicOrphanDetailPage } from "./pages/PublicOrphanDetailPage";
import { PublicOrphansPage } from "./pages/PublicOrphansPage";
import { ReportDetailPage } from "./pages/ReportDetailPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignupPage } from "./pages/SignupPage";
import { SponsorCheckoutPage } from "./pages/SponsorCheckoutPage";
import { SponsorshipsPage } from "./pages/SponsorshipsPage";
import { UsersPage } from "./pages/UsersPage";
import { VerifyEmailConfirmPage } from "./pages/VerifyEmailConfirmPage";
import { VerifyEmailPendingPage } from "./pages/VerifyEmailPendingPage";
import { WalkInCheckoutPage } from "./pages/WalkInCheckoutPage";

export function App() {
  return (
    <Routes>
      {/* ── Anonymous-safe + auth pages without chrome ─────────── */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPendingPage />} />
      <Route path="/verify-email/confirm" element={<VerifyEmailConfirmPage />} />

      {/* ── Public surface (landing + browse + signup) ─────────── */}
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="/orphans" element={<PublicOrphansPage />} />
        <Route path="/orphans/:code" element={<PublicOrphanDetailPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      {/* ── Donor authenticated area ────────────────────────────── */}
      <Route
        element={
          <DonorRoute>
            <DonorLayout />
          </DonorRoute>
        }
      >
        <Route path="/donor/dashboard" element={<DonorDashboardPage />} />
        <Route path="/donor/profile" element={<DonorProfilePage />} />
        <Route path="/donor/sponsorships" element={<DonorSponsorshipsPage />} />
        <Route path="/sponsor/:code/checkout" element={<SponsorCheckoutPage />} />
        <Route path="/payment/success" element={<PaymentSuccessPage />} />
        <Route path="/payment/failure" element={<PaymentFailurePage />} />
      </Route>

      {/* ── Admin / staff area ──────────────────────────────────── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="orphans" element={<OrphansPage />} />
        <Route path="orphans/:id" element={<OrphanDetailPage />} />
        <Route path="donors" element={<DonorsPage />} />
        <Route path="families" element={<FamiliesPage />} />
        <Route path="families/:id" element={<FamilyDetailPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="partners/:id" element={<PartnerDetailPage />} />
        <Route
          path="marketing-channels"
          element={
            <AdminRoute>
              <MarketingChannelsPage />
            </AdminRoute>
          }
        />
        <Route path="sponsorships" element={<SponsorshipsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route
          path="payments/walk-in"
          element={
            <AdminRoute>
              <WalkInCheckoutPage />
            </AdminRoute>
          }
        />
        <Route path="payments/:id/receipt" element={<PaymentReceiptPage />} />
        <Route
          path="bank-transfers"
          element={
            <AdminRoute>
              <BankTransfersPage />
            </AdminRoute>
          }
        />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route
          path="audit"
          element={
            <AdminRoute>
              <AuditPage />
            </AdminRoute>
          }
        />
        <Route
          path="users"
          element={
            <AdminRoute>
              <UsersPage />
            </AdminRoute>
          }
        />
        <Route path="me" element={<MyPortalPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      {/* Catch-all → landing (anon will see landing, logged-in users
          get dispatched home by LandingPage itself) */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
