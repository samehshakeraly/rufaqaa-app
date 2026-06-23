import { useTranslation } from "react-i18next";

import type { OrphanNameMatch } from "@/lib/orphans";

interface Props {
  /** The non-deleted orphans already sharing this first + family name. */
  matches: OrphanNameMatch[];
  /** Continue the create anyway (the user has confirmed it is not a duplicate). */
  onProceed: () => void;
  /** Close the dialog and return to the form to review. */
  onCancel: () => void;
  /** Disable the actions while the (proceed) create is in flight. */
  isProceeding?: boolean;
}

/**
 * NON-BLOCKING advisory shown on the staff registration form when an orphan is
 * being registered WITHOUT a national_id and one or more existing orphans share
 * the same first + family name. It lists the matches so the user can eyeball
 * whether this is a true duplicate, then either proceed or go back. It never
 * hard-blocks — the server-side composite 409 remains the real guard and is
 * surfaced on the form as before if the user proceeds into an actual duplicate.
 */
export function OrphanDuplicateNameDialog({ matches, onProceed, onCancel, isProceeding }: Props) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("orphans.duplicateName.title")}
      data-testid="duplicate-name-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-warning-700">
          {t("orphans.duplicateName.title")}
        </h2>
        <p className="text-sm text-gray-600">{t("orphans.duplicateName.body")}</p>

        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {matches.map((m) => (
            <li
              key={m.code}
              className="rounded-lg border border-sky bg-tranquil px-3 py-2 text-sm"
              data-testid="duplicate-name-match"
            >
              <p className="font-medium text-gray-800">
                {[m.first_name, m.father_name, m.family_name].filter(Boolean).join(" ")}
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {t("orphans.duplicateName.dobLabel")}: {m.date_of_birth} ·{" "}
                {t("orphans.duplicateName.codeLabel")}: {m.code}
              </p>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-gray-700 hover:bg-tranquil"
            onClick={onCancel}
            disabled={isProceeding}
            data-testid="duplicate-name-cancel"
          >
            {t("orphans.duplicateName.cancel")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onProceed}
            disabled={isProceeding}
            data-testid="duplicate-name-proceed"
          >
            {isProceeding ? t("common.saving") : t("orphans.duplicateName.proceed")}
          </button>
        </div>
      </div>
    </div>
  );
}
