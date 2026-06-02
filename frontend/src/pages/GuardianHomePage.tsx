import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  listGuardianOrphans,
  type GuardianOrphan,
} from "@/lib/guardianSelf";
import { ageFromDob } from "@/lib/orphanSelf";

import "./GuardianHomePage.css";

/** G-02 — the guardian's home: a warm greeting and a card per orphan in
 * their family, sourced from GET /guardian/me/orphans. Each card links into
 * the orphan's detail page and the monthly-report wizard.
 *
 * CHILD-DATA SENSITIVITY: only the privacy-safe fields the API returns are
 * shown (name, age, status). Financial figures and donor identity are never
 * rendered — the API omits them unless the org explicitly opts in. */
export function GuardianHomePage() {
  const { t } = useTranslation();
  const { data: me } = useCurrentUser();
  const orphans = useQuery({
    queryKey: ["guardian", "me", "orphans"],
    queryFn: listGuardianOrphans,
  });

  const name = me?.first_name?.trim() || t("guardian.layout.fallbackName");
  const list = orphans.data ?? [];

  return (
    <div className="ghm-root">
      {/* Greeting */}
      <section className="ghm-greeting" aria-labelledby="ghm-greeting-title">
        <div className="ghm-greeting-content">
          <p className="ghm-greeting-eyebrow">{t("guardian.home.eyebrow")}</p>
          <h1 className="ghm-greeting-title" id="ghm-greeting-title">
            {t("guardian.home.greeting", { name })}
          </h1>
          <p className="ghm-greeting-sub">{t("guardian.home.subtitle")}</p>

          {orphans.data && list.length > 0 && (
            <div className="ghm-greeting-summary">
              <div className="ghm-summary-item">
                <span className="ghm-summary-icon" aria-hidden="true">
                  <svg className="ghm-icon" viewBox="0 0 24 24">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <div>
                  <div className="ghm-summary-value">{list.length}</div>
                  <div className="ghm-summary-label">
                    {t("guardian.home.orphansInCare")}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Orphans */}
      <section aria-labelledby="ghm-orphans-title">
        <h2 className="ghm-section-title" id="ghm-orphans-title">
          <span className="ghm-section-title-text">
            {t("guardian.home.yourOrphans")}
            {orphans.data && list.length > 0 && (
              <span className="ghm-section-meta">
                {t("guardian.home.orphanCount", { count: list.length })}
              </span>
            )}
          </span>
          <Link to="/guardian/orphans/new" className="ghm-btn ghm-btn--primary ghm-add-btn">
            <svg className="ghm-icon ghm-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("guardian.home.addOrphan")}
          </Link>
        </h2>

        {orphans.isLoading && (
          <div className="ghm-grid">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {orphans.isError && (
          <div className="ghm-state ghm-state--error" role="alert">
            {t("guardian.home.loadError")}
          </div>
        )}

        {orphans.data && list.length === 0 && (
          <div className="ghm-state">
            <span className="ghm-state-emoji" aria-hidden="true">
              🌱
            </span>
            <p>{t("guardian.home.empty")}</p>
            <Link to="/guardian/orphans/new" className="ghm-btn ghm-btn--primary ghm-state-cta">
              <svg className="ghm-icon ghm-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("guardian.home.addOrphan")}
            </Link>
          </div>
        )}

        {list.length > 0 && (
          <div className="ghm-grid">
            {list.map((o) => (
              <OrphanCard key={o.id} orphan={o} />
            ))}
          </div>
        )}
      </section>

      {/* Help */}
      <section className="ghm-help" aria-labelledby="ghm-help-title">
        <span className="ghm-help-icon" aria-hidden="true">
          <svg className="ghm-icon ghm-icon-lg" viewBox="0 0 24 24">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </span>
        <div className="ghm-help-content">
          <h3 id="ghm-help-title">{t("guardian.home.helpTitle")}</h3>
          <p>{t("guardian.home.helpBody")}</p>
        </div>
        <Link to="/contact" className="ghm-help-btn">
          {t("guardian.home.helpFaq")}
        </Link>
      </section>
    </div>
  );
}

function OrphanCard({ orphan }: { orphan: GuardianOrphan }) {
  const { t } = useTranslation();
  const fullName = `${orphan.first_name} ${orphan.family_name}`.trim();
  const initials = orphan.first_name.slice(0, 2);
  const age = ageFromDob(orphan.date_of_birth);
  const genderLabel = t(`guardian.gender.${orphan.gender}`, {
    defaultValue: orphan.gender,
  });
  const isActive = orphan.case_status === "active";

  return (
    <article className="ghm-card">
      <div className="ghm-card-header">
        <span className="ghm-avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="ghm-card-identity">
          <h3 className="ghm-card-name">{fullName}</h3>
          <p className="ghm-card-meta">
            <span>{t("guardian.home.ageYears", { count: age })}</span>
            <span className="ghm-meta-dot" aria-hidden="true" />
            <span>{genderLabel}</span>
          </p>
        </div>
      </div>

      <div className="ghm-card-status">
        <span className={`ghm-pill${isActive ? "" : " ghm-pill--muted"}`}>
          <span className="ghm-pill-dot" aria-hidden="true" />
          {t(`guardian.caseStatus.${orphan.case_status}`, {
            defaultValue: orphan.case_status,
          })}
        </span>
      </div>

      <div className="ghm-card-actions">
        <Link
          to={`/guardian/orphans/${orphan.id}/report`}
          className="ghm-btn ghm-btn--primary"
        >
          <svg className="ghm-icon ghm-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          {t("guardian.home.uploadReport")}
        </Link>
        <Link
          to={`/guardian/orphans/${orphan.id}`}
          className="ghm-btn ghm-btn--secondary"
        >
          <svg className="ghm-icon ghm-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {t("guardian.home.viewPage", { name: orphan.first_name })}
        </Link>
      </div>
    </article>
  );
}
