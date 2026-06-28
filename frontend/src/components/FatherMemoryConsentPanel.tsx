import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import { getFatherMemoryConsent, setFatherMemoryConsent } from "@/lib/fatherMemory";
import { getProfileVisibility, type ProfileVisibilityRegistry } from "@/lib/profileVisibility";

const consentKey = (orphanId: string) => ["orphan", orphanId, "father-memory-consent"];
// Same key ProfileVisibilityPanel uses, so the two share one cache entry and the
// double-gate status here updates the moment the visibility toggle is saved.
const visibilityKey = (orphanId: string) => ["orphan", orphanId, "profile-visibility"];

/** Is the `father_memory` element currently visible to donors per the saved
 * registry? An element is visible UNLESS explicitly reported hidden; a key the
 * registry omits defaults to visible (the product default). */
function fatherMemoryVisible(registry: ProfileVisibilityRegistry): boolean {
  const el = registry.elements.find((e) => e.key === "father_memory");
  return el ? el.visible : true;
}

/** Guardian-consent gate for "ذكرى الأب" (the father's memory). This is the
 * FIRST of the two gates that disclose the father's name + year of death to a
 * donor; the SECOND is the `father_memory` visibility toggle in the panel
 * below. The block reaches the donor ONLY when BOTH are on — this control makes
 * that double gate legible by showing both states and the resulting outcome.
 *
 * Consent defaults to off (hidden) until a supervisor records it here, and the
 * change is enforced server-side (the donor composition omits the block unless
 * both gates pass — not cosmetic). */
export function FatherMemoryConsentPanel({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const consentQ = useQuery({
    queryKey: consentKey(orphanId),
    queryFn: () => getFatherMemoryConsent(orphanId),
    enabled: Boolean(orphanId),
  });
  const visibilityQ = useQuery({
    queryKey: visibilityKey(orphanId),
    queryFn: () => getProfileVisibility(orphanId),
    enabled: Boolean(orphanId),
  });

  const save = useMutation({
    mutationFn: (next: boolean) => setFatherMemoryConsent(orphanId, next),
    onSuccess: (state) => qc.setQueryData(consentKey(orphanId), state),
  });

  if (consentQ.isLoading || visibilityQ.isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (consentQ.isError || visibilityQ.isError || !consentQ.data || !visibilityQ.data) {
    return (
      <div
        className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-600/20 dark:text-danger-100"
        role="alert"
      >
        {t("fatherMemoryConsent.loadError")}
      </div>
    );
  }

  // Optimistic mid-flight value so the toggle and gate feel instant.
  const consent = save.isPending ? (save.variables as boolean) : consentQ.data.consent;
  const visible = fatherMemoryVisible(visibilityQ.data);
  const reachesDonor = consent && visible;

  return (
    <section
      className="space-y-4 rounded-xl border border-trust-200 bg-trust-100 p-4 dark:border-trust-700 dark:bg-trust-900/30"
      aria-label={t("fatherMemoryConsent.title")}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-trust-900 dark:text-trust-100">
          {t("fatherMemoryConsent.title")}
        </h3>
        <p className="text-xs text-trust-700 dark:text-trust-200">
          {t("fatherMemoryConsent.help")}
        </p>
      </div>

      {/* Gate 1 — guardian consent (this control). */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-sky-200 bg-snow-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/40">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {t("fatherMemoryConsent.consentLabel")}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("fatherMemoryConsent.consentHint")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={consent}
          aria-label={
            consent
              ? t("fatherMemoryConsent.revokeAction")
              : t("fatherMemoryConsent.grantAction")
          }
          disabled={save.isPending}
          onClick={() => save.mutate(!consent)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400 focus-visible:ring-offset-2 disabled:opacity-60 dark:focus-visible:ring-offset-gray-900 ${
            consent ? "bg-trust-500" : "bg-gray-300 dark:bg-gray-600"
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
              consent ? "translate-x-1 rtl:-translate-x-1" : "translate-x-6 rtl:-translate-x-6"
            }`}
          />
        </button>
      </div>

      {/* Gate 2 — supervisor visibility (mirrors the toggle in the panel below;
          read-only here so both gates are legible side by side). */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-sky-200 bg-snow-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/40">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {t("fatherMemoryConsent.visibilityLabel")}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("fatherMemoryConsent.visibilityHint")}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium ${
            visible
              ? "bg-trust-200 text-trust-800 dark:bg-trust-500/20 dark:text-tranquil-100"
              : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-200"
          }`}
        >
          {visible ? t("fatherMemoryConsent.gateOn") : t("fatherMemoryConsent.gateOff")}
        </span>
      </div>

      {/* The resulting double-gate outcome — the single source of truth for what
          the donor actually sees. */}
      <p
        className={`rounded-lg px-4 py-3 text-sm font-medium ${
          reachesDonor
            ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-100"
            : "bg-tranquil-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300"
        }`}
        aria-live="polite"
      >
        {reachesDonor
          ? t("fatherMemoryConsent.shownToDonor")
          : t("fatherMemoryConsent.hiddenFromDonor")}
      </p>

      {save.isError && (
        <p className="text-sm font-medium text-danger-700" role="alert">
          {t("fatherMemoryConsent.saveError")}
        </p>
      )}
    </section>
  );
}
