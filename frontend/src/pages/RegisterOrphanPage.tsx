import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import { listOrphanages } from "@/lib/orphanages";
import { toast } from "@/store/toasts";

import "./RegisterOrphanPage.css";

// PS-03 — the staff full-page "Register New Orphan" screen. The form itself is
// the shared NewOrphanForm (one orphan form across the whole app — the same
// component the inline add on OrphansPage and the guardian portal wrap); this
// page supplies only the PS-03 chrome (header + back link, privacy note, and
// the panel that frames the form). It is configured for the staff path exactly
// as the inline staff add is: the partner picker shown + required, and the dar
// (orphanage) picker shown. Duplicate (409) handling and pending_review intake
// live in NewOrphanForm, so all three entry points share that behaviour.

const ICON = {
  back: <polyline points="9 18 15 12 9 6" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
};

function Icon({ children, sm = true }: { children: ReactNode; sm?: boolean }) {
  return (
    <svg className={`ps-icon${sm ? " ps-icon-sm" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function RegisterOrphanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // The partner picker is country-filtered, so NewOrphanForm fetches its own
  // partner list (keyed on the selected nationality) — we don't pass one here.

  // Org dars for the staff create picker — NewOrphanForm renders the orphanage
  // select only when this prop is passed (guardians never get it).
  const orphanagesQuery = useQuery({
    queryKey: ["orphanages"],
    queryFn: () => listOrphanages({ limit: 100 }),
  });

  return (
    <div className="ps-register">
      <div className="ps-reg-header">
        <div className="ps-reg-titles">
          <h1>{t("orphans.register.title")}</h1>
          <p>{t("orphans.register.subtitle")}</p>
        </div>
        <Link to="/admin/orphans" className="ps-reg-back">
          <Icon>{ICON.back}</Icon>
          {t("orphans.register.back")}
        </Link>
      </div>

      {/* Privacy reassurance — a new case stays in review and is never shown
          to donors until a manager approves it. */}
      <div className="ps-reg-note">
        <Icon>{ICON.shield}</Icon>
        <span>{t("orphans.register.privacyNote")}</span>
      </div>

      <div className="ps-reg-panel">
        <NewOrphanForm
          audience="staff"
          orphanages={orphanagesQuery.data?.items ?? []}
          onCreated={(created) => {
            toast.success(t("common.save"));
            navigate(`/admin/orphans/${created.id}`);
          }}
          onCancel={() => navigate("/admin/orphans")}
        />
      </div>
    </div>
  );
}
