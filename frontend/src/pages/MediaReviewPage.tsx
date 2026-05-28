// TODO(backend): GET /media?moderation_status=pending is not implemented yet.
// Until it lands, partner managers should use the per-photo moderate controls
// on the orphan detail page (PS-04). See PR #15-equivalent backend work.
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function MediaReviewPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {t("media.review.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {t("media.review.description")}
        </p>
      </div>

      <div className="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">
        {t("media.review.todoBackend")}
      </div>

      <div className="card flex flex-col items-center gap-3 text-center text-gray-500">
        <p>{t("common.empty")}</p>
        <Link
          to="/admin/orphans?status=pending_review"
          className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil"
        >
          {t("media.review.workaround")}
        </Link>
      </div>
    </div>
  );
}
