// TODO(backend): GET /media?moderation_status=pending is not implemented yet.
// Until it lands, partner managers should use the per-photo moderate controls
// on the orphan detail page (PS-04). This page adopts the PS-06 mockup's chrome
// (AI summary banner + privacy strip) but renders a coming-soon empty state
// where the media grid will live — no fabricated queue data.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import "./MediaReviewPage.css";

export function MediaReviewPage() {
  const { t } = useTranslation();
  return (
    <div className="ps-media">
      <div className="ps-media-head">
        <h1>{t("media.review.title")}</h1>
        <p>{t("media.review.description")}</p>
      </div>

      {/* AI summary banner — repurposed as a coming-soon notice until the
          moderation-queue endpoint lands. */}
      <div className="ps-ai-banner">
        <div className="ps-ai-icon" aria-hidden="true">
          <svg className="ps-icon" viewBox="0 0 24 24">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </div>
        <div className="ps-ai-text">
          <strong>{t("media.review.aiTitle")}</strong>
          <span>{t("media.review.aiBody")}</span>
        </div>
      </div>

      {/* Privacy strip — policy reminder, always relevant. */}
      <div className="ps-privacy-strip">
        <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span>
          <strong>{t("media.review.privacyLabel")}</strong> {t("media.review.privacyBody")}
        </span>
      </div>

      {/* Coming-soon empty state where the media grid will render. */}
      <div className="ps-media-empty">
        <div className="ps-media-empty-icon" aria-hidden="true">
          <svg className="ps-icon" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <div className="ps-media-empty-title">{t("media.review.comingSoonTitle")}</div>
        <div className="ps-media-empty-sub">{t("media.review.todoBackend")}</div>
        <Link to="/admin/orphans?status=pending_review" className="ps-media-link">
          <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
          {t("media.review.workaround")}
        </Link>
      </div>
    </div>
  );
}
