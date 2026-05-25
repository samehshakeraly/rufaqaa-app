import { Navigate, Route, Routes } from "react-router-dom";

import { ProtectedRoute } from "./components/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { DonorsPage } from "./pages/DonorsPage";
import { LoginPage } from "./pages/LoginPage";
import { OrphansPage } from "./pages/OrphansPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { SponsorshipsPage } from "./pages/SponsorshipsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="/donors" element={<DonorsPage />} />
        <Route path="/sponsorships" element={<SponsorshipsPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
