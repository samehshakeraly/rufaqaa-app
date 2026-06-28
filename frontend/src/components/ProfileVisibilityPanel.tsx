import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  getProfileVisibility,
  PROFILE_ELEMENTS,
  setProfileVisibility,
  type ProfileElement,
  type ProfileVisibilityRegistry,
} from "@/lib/profileVisibility";

type VisibilityMap = Record<ProfileElement, boolean>;

/** Build the full visibility map (one entry per PROFILE_ELEMENTS key) from a
 * registry. An element is visible to the donor UNLESS the registry reports it
 * hidden; any key the registry omits defaults to visible (the product default). */
function toMap(registry: ProfileVisibilityRegistry): VisibilityMap {
  const map = {} as VisibilityMap;
  for (const key of PROFILE_ELEMENTS) map[key] = true;
  for (const el of registry.elements) map[el.key] = el.visible;
  return map;
}

function isDirty(draft: VisibilityMap, base: VisibilityMap): boolean {
  return PROFILE_ELEMENTS.some((key) => draft[key] !== base[key]);
}

const queryKey = (orphanId: string) => ["orphan", orphanId, "profile-visibility"];

/** Supervisor/manager control to show or hide each element of the donor-facing
 * child profile. Mirrors the report `section_visibility` model: an element is
 * shown to donors unless it is explicitly hidden, and hiding is enforced
 * server-side (a hidden element never reaches the donor — not cosmetic).
 *
 * The identity/header block is implicit and always shown; it is not a
 * ProfileElement and is rendered as a locked, non-interactive row. Per-item /
 * media sub-toggles are out of scope (a later PR) — only the eight
 * section-level elements exist today. */
export function ProfileVisibilityPanel({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const registry = useQuery({
    queryKey: queryKey(orphanId),
    queryFn: () => getProfileVisibility(orphanId),
    enabled: Boolean(orphanId),
  });

  // Local draft of the toggles; (re)synced from the server whenever a fresh
  // registry lands (initial load and after a successful save). Edits between
  // syncs live only here, so they survive until saved or rolled back.
  const [draft, setDraft] = useState<VisibilityMap | null>(null);
  const [feedback, setFeedback] = useState<"idle" | "saved" | "error">("idle");

  const serverMap = useMemo(() => (registry.data ? toMap(registry.data) : null), [registry.data]);

  useEffect(() => {
    if (serverMap) setDraft(serverMap);
  }, [serverMap]);

  const save = useMutation({
    mutationFn: (next: VisibilityMap) => setProfileVisibility(orphanId, next),
    onSuccess: (reg) => {
      // Trust the server's recomputed registry as the new source of truth.
      qc.setQueryData(queryKey(orphanId), reg);
      setDraft(toMap(reg));
      setFeedback("saved");
    },
    onError: () => {
      // Roll the optimistic toggles back to the last server-confirmed state.
      if (serverMap) setDraft(serverMap);
      setFeedback("error");
    },
  });

  function toggle(key: ProfileElement) {
    setDraft((d) => (d ? { ...d, [key]: !d[key] } : d));
    setFeedback("idle");
  }

  if (registry.isLoading || !draft || !serverMap) {
    return (
      <div className="space-y-3" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (registry.isError) {
    return (
      <div
        className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-600/20 dark:text-danger-100"
        role="alert"
      >
        {t("profileVisibility.loadError")}
      </div>
    );
  }

  const visibleKeys = PROFILE_ELEMENTS.filter((key) => draft[key]);
  const hiddenKeys = PROFILE_ELEMENTS.filter((key) => !draft[key]);
  const dirty = isDirty(draft, serverMap);

  return (
    <div className="space-y-6">
      {/* Security banner — hiding is real and server-enforced. */}
      <div
        className="flex items-start gap-3 rounded-xl border border-trust-200 bg-trust-100 px-4 py-3 text-sm text-trust-800 dark:border-trust-700 dark:bg-trust-900/30 dark:text-trust-100"
        role="note"
      >
        <ShieldIcon />
        <div className="space-y-1">
          <p className="font-medium">{t("profileVisibility.bannerTitle")}</p>
          <p className="text-trust-700 dark:text-trust-200">{t("profileVisibility.bannerBody")}</p>
        </div>
      </div>

      {/* Live counter. */}
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200" aria-live="polite">
        {t("profileVisibility.counter", {
          visible: visibleKeys.length,
          hidden: hiddenKeys.length,
        })}
      </p>

      <ul className="space-y-2">
        {/* Locked identity/header row — implicit, always shown, never a toggle. */}
        <li className="flex items-center justify-between gap-4 rounded-xl border border-sky-200 bg-tranquil-100 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/60">
          <div className="min-w-0">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {t("profileVisibility.identity.label")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("profileVisibility.identity.help")}
            </p>
          </div>
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200"
            aria-label={t("profileVisibility.identity.locked")}
          >
            <LockIcon />
            {t("profileVisibility.alwaysShown")}
          </span>
        </li>

        {/* One row per toggleable element. */}
        {PROFILE_ELEMENTS.map((key) => (
          <ElementRow key={key} element={key} visible={draft[key]} onToggle={() => toggle(key)} />
        ))}
      </ul>

      {/* Preview as donor — derived purely from the current toggles. A full
          visual render of the composed donor page is intentionally NOT done
          here: the assembled profile is only available via the donor-scoped
          endpoint, and a staff visual-preview endpoint is a later PR.
          TODO(profile-visual-preview): mount the read-only donor render here
          once the staff preview endpoint ships. */}
      <section
        className="rounded-xl border border-sky-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-800/40"
        aria-labelledby="pvp-preview-title"
      >
        <h3
          id="pvp-preview-title"
          className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("profileVisibility.previewTitle")}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <PreviewColumn
            title={t("profileVisibility.previewVisible", {
              n: visibleKeys.length,
            })}
            tone="visible"
            keys={visibleKeys}
            emptyLabel={t("profileVisibility.previewNoneVisible")}
          />
          <PreviewColumn
            title={t("profileVisibility.previewHidden", {
              n: hiddenKeys.length,
            })}
            tone="hidden"
            keys={hiddenKeys}
            emptyLabel={t("profileVisibility.previewNoneHidden")}
          />
        </div>
      </section>

      {/* Save + status. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setFeedback("idle");
            save.mutate(draft);
          }}
        >
          {save.isPending ? t("profileVisibility.saving") : t("profileVisibility.save")}
        </button>
        {feedback === "saved" && !dirty && (
          <span className="text-sm font-medium text-success-700" role="status">
            {t("profileVisibility.saved")}
          </span>
        )}
        {feedback === "error" && (
          <span className="text-sm font-medium text-danger-700" role="alert">
            {t("profileVisibility.saveError")}
          </span>
        )}
      </div>
    </div>
  );
}

/** A single element row: label + one-line helper + an accessible switch that
 * reflects whether the donor will see it. */
function ElementRow({
  element,
  visible,
  onToggle,
}: {
  element: ProfileElement;
  visible: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = t(`profileVisibility.elements.${element}.label`);
  return (
    <li className="flex items-center justify-between gap-4 rounded-xl border border-sky-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-0">
        <p className="font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(`profileVisibility.elements.${element}.help`)}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={visible}
        aria-label={
          visible
            ? t("profileVisibility.hideAction", { name: label })
            : t("profileVisibility.showAction", { name: label })
        }
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 ${
          visible ? "bg-trust-500" : "bg-gray-300 dark:bg-gray-600"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            visible ? "translate-x-1 rtl:-translate-x-1" : "translate-x-6 rtl:-translate-x-6"
          }`}
        />
      </button>
    </li>
  );
}

function PreviewColumn({
  title,
  tone,
  keys,
  emptyLabel,
}: {
  title: string;
  tone: "visible" | "hidden";
  keys: readonly ProfileElement[];
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <p
        className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
          tone === "visible" ? "text-success-700" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {title}
      </p>
      {keys.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1">
          {keys.map((key) => (
            <li
              key={key}
              className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
            >
              {tone === "visible" ? <EyeIcon /> : <EyeOffIcon />}
              {t(`profileVisibility.elements.${key}.label`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 8 10 8a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
