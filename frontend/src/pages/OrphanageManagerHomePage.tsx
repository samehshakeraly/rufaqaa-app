import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  getOrphanageMe,
  listOrphanageResidents,
  type OrphanageResident,
} from "@/lib/orphanageSelf";
import { ageFromDob } from "@/lib/orphanSelf";

// Mirror the guardian home; reuse its styles (ghm-*).
import "./GuardianHomePage.css";

/** The orphanage manager's home: a warm greeting, the dar profile card, and a
 * card per resident orphan, sourced from GET /orphanage/me and
 * GET /orphanage/me/orphans. Each resident card links into the orphan's detail
 * page and the monthly-report wizard.
 *
 * Only the privacy-safe fields the API returns are shown (name, age, status).
 * Financial figures and donor identity are never rendered. */
export function OrphanageManagerHomePage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useCurrentUser();
  const orphanage = useQuery({
    queryKey: ["orphanage", "me"],
    queryFn: getOrphanageMe,
  });
  const residents = useQuery({
    queryKey: ["orphanage", "me", "orphans"],
    queryFn: listOrphanageResidents,
  });

  const name = me?.first_name?.trim() || t("orphanageManager.layout.fallbackName");
  const list = residents.data ?? [];
  const dar = orphanage.data;
  const darName = dar
    ? (i18n.language === "ar" ? dar.name_ar : dar.name_en) || dar.name_ar
    : "";
  const location = dar
    ? [dar.city, dar.governorate, dar.country_code].filter(Boolean).join("، ")
    : "";

  // A manager whose account isn't yet linked to a dar gets a 404 from
  // /orphanage/me — show a calm "contact the organisation" state rather than a
  // misleading load error.
  if (orphanage.isError) {
    return (
      <div className="ghm-root">
        <section className="ghm-greeting" aria-labelledby="ohm-greeting-title">
          <div className="ghm-greeting-content">
            <p className="ghm-greeting-eyebrow">{t("orphanageManager.home.eyebrow")}</p>
            <h1 className="ghm-greeting-title" id="ohm-greeting-title">
              {t("orphanageManager.home.greeting", { name })}
            </h1>
          </div>
        </section>
        <div className="ghm-state">
          <span className="ghm-state-emoji" aria-hidden="true">
            🏠
          </span>
          <p>{t("orphanageManager.home.noOrphanage")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ghm-root">
      {/* Greeting + dar profile */}
      <section className="ghm-greeting" aria-labelledby="ohm-greeting-title">
        <div className="ghm-greeting-content">
          <p className="ghm-greeting-eyebrow">{t("orphanageManager.home.eyebrow")}</p>
          <h1 className="ghm-greeting-title" id="ohm-greeting-title">
            {t("orphanageManager.home.greeting", { name })}
          </h1>
          <p className="ghm-greeting-sub">{t("orphanageManager.home.subtitle")}</p>

          {orphanage.isLoading && <Skeleton className="h-16 w-full" />}

          {dar && (
            <div className="ghm-greeting-summary">
              <div className="ghm-summary-item">
                <span className="ghm-summary-icon" aria-hidden="true">
                  <svg className="ghm-icon" viewBox="0 0 24 24">
                    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01" />
                  </svg>
                </span>
                <div>
                  <div className="ghm-summary-value">{darName}</div>
                  <div className="ghm-summary-label">
                    {location || dar.code}
                  </div>
                </div>
              </div>
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
                    {t("orphanageManager.home.residentsInCare")}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Residents */}
      <section aria-labelledby="ohm-residents-title">
        <h2 className="ghm-section-title" id="ohm-residents-title">
          <span className="ghm-section-title-text">
            {t("orphanageManager.home.yourResidents")}
            {residents.data && list.length > 0 && (
              <span className="ghm-section-meta">
                {t("orphanageManager.home.residentCount", { count: list.length })}
              </span>
            )}
          </span>
        </h2>

        {residents.isLoading && (
          <div className="ghm-grid">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {residents.isError && (
          <div className="ghm-state ghm-state--error" role="alert">
            {t("orphanageManager.home.loadError")}
          </div>
        )}

        {residents.data && list.length === 0 && (
          <div className="ghm-state">
            <span className="ghm-state-emoji" aria-hidden="true">
              🏠
            </span>
            <p>{t("orphanageManager.home.empty")}</p>
          </div>
        )}

        {list.length > 0 && (
          <div className="ghm-grid">
            {list.map((o) => (
              <ResidentCard key={o.id} orphan={o} />
            ))}
          </div>
        )}
      </section>

      {/* Help */}
      <section className="ghm-help" aria-labelledby="ohm-help-title">
        <span className="ghm-help-icon" aria-hidden="true">
          <svg className="ghm-icon ghm-icon-lg" viewBox="0 0 24 24">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </span>
        <div className="ghm-help-content">
          <h3 id="ohm-help-title">{t("orphanageManager.home.helpTitle")}</h3>
          <p>{t("orphanageManager.home.helpBody")}</p>
        </div>
        <Link to="/contact" className="ghm-help-btn">
          {t("orphanageManager.home.helpFaq")}
        </Link>
      </section>
    </div>
  );
}

function ResidentCard({ orphan }: { orphan: OrphanageResident }) {
  const { t } = useTranslation();
  const fullName = `${orphan.first_name} ${orphan.family_name}`.trim();
  const initials = orphan.first_name.slice(0, 2);
  const age = ageFromDob(orphan.date_of_birth);
  const genderLabel = t(`orphanageManager.gender.${orphan.gender}`, {
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
            <span>{t("orphanageManager.home.ageYears", { count: age })}</span>
            <span className="ghm-meta-dot" aria-hidden="true" />
            <span>{genderLabel}</span>
          </p>
        </div>
      </div>

      <div className="ghm-card-status">
        <span className={`ghm-pill${isActive ? "" : " ghm-pill--muted"}`}>
          <span className="ghm-pill-dot" aria-hidden="true" />
          {t(`orphanageManager.caseStatus.${orphan.case_status}`, {
            defaultValue: orphan.case_status,
          })}
        </span>
      </div>

      <div className="ghm-card-actions">
        <Link
          to={`/orphanage-manager/orphans/${orphan.id}/report`}
          className="ghm-btn ghm-btn--primary"
        >
          <svg className="ghm-icon ghm-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          {t("orphanageManager.home.uploadReport")}
        </Link>
        <Link
          to={`/orphanage-manager/orphans/${orphan.id}`}
          className="ghm-btn ghm-btn--secondary"
        >
          <svg className="ghm-icon ghm-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {t("orphanageManager.home.viewPage", { name: orphan.first_name })}
        </Link>
      </div>
    </article>
  );
}
