import { Navigate, Route, Routes } from "react-router-dom";

import { AdminRoute } from "./components/AdminRoute";
import { ContentRoute } from "./components/ContentRoute";
import { DonorRoute } from "./components/DonorRoute";
import { FinanceRoute } from "./components/FinanceRoute";
import { GuardianRoute } from "./components/GuardianRoute";
import { MarketingRoute } from "./components/MarketingRoute";
import { OrphanRoute } from "./components/OrphanRoute";
import { OrphanageManagerRoute } from "./components/OrphanageManagerRoute";
import { PartnerApproverGate } from "./components/PartnerApproverGate";
import { PartnerRoute } from "./components/PartnerRoute";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { SuperAdminRoute } from "./components/SuperAdminRoute";
import { PublicSiteLayout } from "./components/public/PublicSiteLayout";
import { AppLayout } from "./components/layout/AppLayout";
import { DonorLayout } from "./components/layout/DonorLayout";
import { GuardianLayout } from "./components/layout/GuardianLayout";
import { OrphanLayout } from "./components/layout/OrphanLayout";
import { OrphanageManagerLayout } from "./components/layout/OrphanageManagerLayout";
import { PartnerLayout } from "./components/layout/PartnerLayout";
import { PlatformLayout } from "./components/layout/PlatformLayout";
import { PublicLayout } from "./components/layout/PublicLayout";

// Public marketing pages (W-02..W-06)
import { AboutPage } from "./pages/AboutPage";
import { ContactFAQPage } from "./pages/ContactFAQPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { PublicPartnersPage } from "./pages/PublicPartnersPage";
import { TransparencyPage } from "./pages/TransparencyPage";

// Admin / staff pages (now mounted under /admin/*)
import { AuditPage } from "./pages/AuditPage";
import { BankTransfersPage } from "./pages/BankTransfersPage";
import { BankStatementImportPage } from "./pages/BankStatementImportPage";
import { ChannelDashboardPage } from "./pages/ChannelDashboardPage";
import { ChannelOrphansPage } from "./pages/ChannelOrphansPage";
import { DashboardHome } from "./pages/PartnerStaffDashboardPage";
import { DonorDashboardPage } from "./pages/DonorDashboardPage";
import { DonorMessagesPage } from "./pages/DonorMessagesPage";
import { DonorOrphanDetailPage } from "./pages/DonorOrphanDetailPage";
import { DonorOrphansPage } from "./pages/DonorOrphansPage";
import { DonorProfilePage } from "./pages/DonorProfilePage";
import { DonorSponsorshipsPage } from "./pages/DonorSponsorshipsPage";
import { DonorSponsorshipWizardPage } from "./pages/DonorSponsorshipWizardPage";
import { DonorsPage } from "./pages/DonorsPage";
import { FamiliesPage } from "./pages/FamiliesPage";
import { FamilyDetailPage } from "./pages/FamilyDetailPage";
import { FinanceDashboardPage } from "./pages/FinanceDashboardPage";
import { FinancialReportsPage } from "./pages/FinancialReportsPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { GuardianAddOrphanPage } from "./pages/GuardianAddOrphanPage";
import { GuardianHomePage } from "./pages/GuardianHomePage";
import { GuardianLoginPage } from "./pages/GuardianLoginPage";
import { GuardianMessagesPage } from "./pages/GuardianMessagesPage";
import { GuardianOrphanDetailPage } from "./pages/GuardianOrphanDetailPage";
import { GuardianReportUploadPage } from "./pages/GuardianReportUploadPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { MarketingChannelsPage } from "./pages/MarketingChannelsPage";
import { MediaReviewPage } from "./pages/MediaReviewPage";
import { OrphanAchievementsPage } from "./pages/OrphanAchievementsPage";
import { OrphanDetailPage } from "./pages/OrphanDetailPage";
import { OrphanHomePage } from "./pages/OrphanHomePage";
import { OrphanLoginPage } from "./pages/OrphanLoginPage";
import { OrphanMessagesPage } from "./pages/OrphanMessagesPage";
import { OrphanageManagerHomePage } from "./pages/OrphanageManagerHomePage";
import { OrphanageManagerOrphanDetailPage } from "./pages/OrphanageManagerOrphanDetailPage";
import { OrphanageManagerReportPage } from "./pages/OrphanageManagerReportPage";
import { OrphanagesPage } from "./pages/OrphanagesPage";
import { OrphansPage } from "./pages/OrphansPage";
import { OverdueDonorsPage } from "./pages/OverdueDonorsPage";
// Partner-manager portal (PM-01..PM-04)
import { PartnerApprovalsPage } from "./pages/partner/PartnerApprovalsPage";
import { PartnerStaffPage } from "./pages/partner/PartnerStaffPage";
import { PartnerTransfersPage } from "./pages/partner/PartnerTransfersPage";
import { PartnerPerformancePage } from "./pages/partner/PartnerPerformancePage";
import { RegisterOrphanPage } from "./pages/RegisterOrphanPage";
import { PartnerDetailPage } from "./pages/PartnerDetailPage";
import { PartnersPage } from "./pages/PartnersPage";
import { PlatformAnalyticsPage } from "./pages/PlatformAnalyticsPage";
import { PlatformDashboardPage } from "./pages/PlatformDashboardPage";
import { PlatformOrganizationsPage } from "./pages/PlatformOrganizationsPage";
import { PlatformSettingsPage } from "./pages/PlatformSettingsPage";
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
import { BusinessRulesPage } from "./pages/BusinessRulesPage";
import { VerifyEmailConfirmPage } from "./pages/VerifyEmailConfirmPage";
import { VerifyEmailPendingPage } from "./pages/VerifyEmailPendingPage";
import { WalkInCheckoutPage } from "./pages/WalkInCheckoutPage";

export function App() {
  return (
    <Routes>
      {/* ── Anonymous-safe + auth pages without chrome ─────────── */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/orphan/login" element={<OrphanLoginPage />} />
      <Route path="/guardian/login" element={<GuardianLoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPendingPage />} />
      <Route path="/verify-email/confirm" element={<VerifyEmailConfirmPage />} />
      {/* A-02 is a full-bleed auth page with its own brand row + gradient
          (like /login), so it sits outside the constrained PublicLayout. */}
      <Route path="/signup" element={<SignupPage />} />

      {/* ── Public surface (browse) — centered column ─── */}
      <Route element={<PublicLayout />}>
        <Route path="/orphans" element={<PublicOrphansPage />} />
        <Route path="/orphans/:code" element={<PublicOrphanDetailPage />} />
      </Route>

      {/* ── Public marketing site (W-01..W-06) — full-bleed, no auth ── */}
      <Route element={<PublicSiteLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/transparency" element={<TransparencyPage />} />
        <Route path="/partners" element={<PublicPartnersPage />} />
        <Route path="/contact" element={<ContactFAQPage />} />
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
        <Route path="/donor/orphans" element={<DonorOrphansPage />} />
        <Route path="/donor/orphans/:id" element={<DonorOrphanDetailPage />} />
        <Route path="/donor/messages" element={<DonorMessagesPage />} />
        <Route
          path="/donor/sponsor/:code"
          element={<DonorSponsorshipWizardPage />}
        />
        <Route path="/sponsor/:code/checkout" element={<SponsorCheckoutPage />} />
        <Route path="/payment/success" element={<PaymentSuccessPage />} />
        <Route path="/payment/failure" element={<PaymentFailurePage />} />
      </Route>

      {/* ── Orphan self-portal (12+, role=orphan) ───────────────── */}
      <Route
        element={
          <OrphanRoute>
            <OrphanLayout />
          </OrphanRoute>
        }
      >
        <Route path="/orphan" element={<OrphanHomePage />} />
        <Route path="/orphan/messages" element={<OrphanMessagesPage />} />
        <Route
          path="/orphan/achievements"
          element={<OrphanAchievementsPage />}
        />
      </Route>

      {/* ── Guardian family portal (G-01..G-05, role=guardian) ────
          Distinct GuardianLayout chrome ("بوابة ولي الأمر"). Gated by
          GuardianRoute to role=guardian; staff/donor/orphan are sent to
          their own home. Reads the live /guardian/me* endpoints; report
          UPLOAD + messages have no backend yet and degrade to a clear
          "coming soon" state. */}
      <Route
        element={
          <GuardianRoute>
            <GuardianLayout />
          </GuardianRoute>
        }
      >
        <Route path="/guardian" element={<GuardianHomePage />} />
        <Route path="/guardian/orphans/new" element={<GuardianAddOrphanPage />} />
        <Route
          path="/guardian/orphans/:id"
          element={<GuardianOrphanDetailPage />}
        />
        <Route
          path="/guardian/orphans/:id/report"
          element={<GuardianReportUploadPage />}
        />
        <Route path="/guardian/messages" element={<GuardianMessagesPage />} />
      </Route>

      {/* ── Orphanage-manager portal (role=orphanage_manager) ─────
          Distinct OrphanageManagerLayout chrome ("بوابة دار الأيتام").
          Mirrors the guardian portal: gated by OrphanageManagerRoute to
          role=orphanage_manager; staff/donor/orphan/guardian are sent to
          their own home. Reads the live /orphanage/me* endpoints (dar
          profile, resident orphans, monthly reports) — scoped by
          orphanage_id instead of family_id. */}
      <Route
        element={
          <OrphanageManagerRoute>
            <OrphanageManagerLayout />
          </OrphanageManagerRoute>
        }
      >
        <Route path="/orphanage-manager" element={<OrphanageManagerHomePage />} />
        <Route
          path="/orphanage-manager/orphans/:id"
          element={<OrphanageManagerOrphanDetailPage />}
        />
        <Route
          path="/orphanage-manager/orphans/:id/report"
          element={<OrphanageManagerReportPage />}
        />
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

        {/* Org-admin + partner case-management surfaces. Gated to
            isAdmin || isPartner — finance & marketing roles are redirected
            to their own home so they can't reach these screens. The admin
            still lands on /admin/dashboard (login e2e smoke test). */}
        <Route element={<ContentRoute />}>
          <Route path="dashboard" element={<DashboardHome />} />
          <Route path="orphans" element={<OrphansPage />} />
          <Route path="orphans/new" element={<RegisterOrphanPage />} />
          <Route path="orphans/:id" element={<OrphanDetailPage />} />
          <Route path="donors" element={<DonorsPage />} />
          <Route path="families" element={<FamiliesPage />} />
          <Route path="families/:id" element={<FamilyDetailPage />} />
          <Route path="orphanages" element={<OrphanagesPage />} />
          <Route path="partners" element={<PartnersPage />} />
          <Route path="partners/:id" element={<PartnerDetailPage />} />
          <Route path="sponsorships" element={<SponsorshipsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/:id" element={<ReportDetailPage />} />
        </Route>

        <Route
          path="media-review"
          element={
            <PartnerApproverGate>
              <MediaReviewPage />
            </PartnerApproverGate>
          }
        />
        <Route
          path="marketing-channels"
          element={
            <MarketingRoute>
              <MarketingChannelsPage />
            </MarketingRoute>
          }
        />
        {/* Finance screens (F-01, F-03, F-07) — finance + admin only */}
        <Route
          path="finance"
          element={
            <FinanceRoute>
              <FinanceDashboardPage />
            </FinanceRoute>
          }
        />
        <Route
          path="finance/import"
          element={
            <FinanceRoute>
              <BankStatementImportPage />
            </FinanceRoute>
          }
        />
        <Route
          path="finance/overdue"
          element={
            <FinanceRoute>
              <OverdueDonorsPage />
            </FinanceRoute>
          }
        />
        <Route
          path="finance/reports"
          element={
            <FinanceRoute>
              <FinancialReportsPage />
            </FinanceRoute>
          }
        />
        {/* Marketing channel detail screens (MM-01, MM-03) —
            marketing_manager + admin only */}
        <Route
          path="marketing/channels/:id"
          element={
            <MarketingRoute>
              <ChannelDashboardPage />
            </MarketingRoute>
          }
        />
        <Route
          path="marketing/channels/:id/orphans"
          element={
            <MarketingRoute>
              <ChannelOrphansPage />
            </MarketingRoute>
          }
        />
        {/* Payments + bank transfers — finance + admin only (isFinance). */}
        <Route
          path="payments"
          element={
            <FinanceRoute>
              <PaymentsPage />
            </FinanceRoute>
          }
        />
        <Route
          path="payments/walk-in"
          element={
            <AdminRoute>
              <WalkInCheckoutPage />
            </AdminRoute>
          }
        />
        <Route
          path="payments/:id/receipt"
          element={
            <FinanceRoute>
              <PaymentReceiptPage />
            </FinanceRoute>
          }
        />
        <Route
          path="bank-transfers"
          element={
            <FinanceRoute>
              <BankTransfersPage />
            </FinanceRoute>
          }
        />
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
        <Route
          path="business-rules"
          element={
            <AdminRoute>
              <BusinessRulesPage />
            </AdminRoute>
          }
        />
        <Route
          path="settings"
          element={
            <AdminRoute>
              <SettingsPage />
            </AdminRoute>
          }
        />
      </Route>

      {/* ── Partner-manager portal (PM-01..PM-04) ───────────────────
          Distinct PartnerLayout chrome ("بوابة الجهة الشريكة"). Gated
          to the partner-approver roles (super_admin, org_admin,
          partner_manager) by PartnerRoute; partner_staff is redirected
          home. Reuses the shared orphan/report/bank-transfer endpoints —
          the org-admin /admin/* screens are left untouched. */}
      <Route
        path="/partner"
        element={
          <ProtectedRoute>
            <PartnerRoute>
              <PartnerLayout />
            </PartnerRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="approvals" replace />} />
        <Route path="approvals" element={<PartnerApprovalsPage />} />
        <Route path="staff" element={<PartnerStaffPage />} />
        <Route path="transfers" element={<PartnerTransfersPage />} />
        <Route path="performance" element={<PartnerPerformancePage />} />
      </Route>

      {/* ── Super-admin platform portal (SA-01..SA-04) ──────────────
          Cross-org scope. Gated to role=super_admin ONLY (org_admin is
          redirected home by SuperAdminRoute). Distinct PlatformLayout
          chrome signals "Platform Administration" mode. */}
      <Route
        path="/platform"
        element={
          <ProtectedRoute>
            <SuperAdminRoute>
              <PlatformLayout />
            </SuperAdminRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<PlatformDashboardPage />} />
        <Route path="organizations" element={<PlatformOrganizationsPage />} />
        <Route path="analytics" element={<PlatformAnalyticsPage />} />
        <Route path="settings" element={<PlatformSettingsPage />} />
      </Route>

      {/* Catch-all → landing (anon will see landing, logged-in users
          get dispatched home by LandingPage itself) */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
