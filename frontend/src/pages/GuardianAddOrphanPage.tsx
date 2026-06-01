import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import { createMyOrphan } from "@/lib/guardianSelf";
import { toast } from "@/store/toasts";

import "./GuardianAddOrphanPage.css";

/** G-06 — a guardian registers a new orphan in their OWN family.
 *
 * Reuses the staff `NewOrphanForm` (same fields/UX) but hides the partner
 * picker: the partner organisation, family and org are derived server-side
 * from the guardian (POST /guardian/me/orphans), so a guardian can never
 * register a child for another family. The orphan lands in `pending_review`
 * and rides the same supervisor approval queue — the guardian then sees it on
 * the home page with a "قيد المراجعة" badge.
 *
 * A duplicate, or a family not yet linked to a partner organisation, comes
 * back from the API as a clear 409 message which the form surfaces inline. */
export function GuardianAddOrphanPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  return (
    <div className="gao-root">
      <header className="gao-header">
        <Link to="/guardian" className="gao-back">
          <svg className="gao-icon gao-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{t("guardian.addOrphan.back")}</span>
        </Link>
        <div className="gao-title-area">
          <h1>{t("guardian.addOrphan.title")}</h1>
          <p>{t("guardian.addOrphan.subtitle")}</p>
        </div>
      </header>

      <div className="gao-note" role="note">
        <svg className="gao-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>{t("guardian.addOrphan.pendingNote")}</span>
      </div>

      <div className="gao-panel">
        <NewOrphanForm
          showPartnerSelect={false}
          submitFn={createMyOrphan}
          duplicateHref={() => null}
          onCreated={async (created) => {
            await qc.invalidateQueries({ queryKey: ["guardian", "me", "orphans"] });
            toast.success(t("guardian.addOrphan.success", { name: created.first_name }));
            navigate("/guardian");
          }}
          onCancel={() => navigate("/guardian")}
        />
      </div>
    </div>
  );
}
