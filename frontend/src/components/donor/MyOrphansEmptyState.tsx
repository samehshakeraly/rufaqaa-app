import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** PR-D06 — the zero-sponsorships welcome. A quiet invitation, not an
 * error: what the page will hold once the first child arrives, and the
 * two obvious first steps. (The minimum-amount line is intentionally
 * absent — no platform setting exposes it to donors, and we never show
 * an invented number.) */
export function MyOrphansEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="card mx-auto flex max-w-xl flex-col items-center gap-4 p-8 text-center">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-tranquil-200 text-trust-600 dark:bg-gray-700 dark:text-tranquil-200"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            d="M12 20s-7-4.35-9.33-8.11C1.06 9.3 2.16 6 5.4 6c2 0 3.2 1.14 3.83 2.2h5.54C15.4 7.14 16.6 6 18.6 6c3.24 0 4.34 3.3 2.73 5.89C19 15.65 12 20 12 20Z"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
        {t("donor.orphans.emptyState.title")}
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t("donor.orphans.emptyState.body")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link to="/orphans" className="btn-primary min-h-[44px]">
          {t("donor.orphans.emptyState.browse")}
        </Link>
        <Link to="/how-it-works" className="btn-secondary min-h-[44px]">
          {t("donor.orphans.emptyState.howItWorks")}
        </Link>
      </div>
      <p className="w-full border-t border-sky-200 pt-4 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {t("donor.orphans.emptyState.reassurance")}
      </p>
    </div>
  );
}
