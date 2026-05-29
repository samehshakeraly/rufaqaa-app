import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  listOrphanAchievements,
  type OrphanAchievement,
} from "@/lib/orphanSelf";

/** O-04 — a warm timeline of the orphan's published achievements.
 *
 * Backend returns only published reports, projected to progress fields.
 * The JSON blobs are free-form, so we flatten them to readable highlight
 * lines defensively (no raw JSON, no technical keys, no financial data). */
export function OrphanAchievementsPage() {
  const { t, i18n } = useTranslation();
  const q = useQuery({
    queryKey: ["orphan", "me", "achievements"],
    queryFn: () => listOrphanAchievements(20),
  });

  const items = q.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("orphan.achievements.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("orphan.achievements.subtitle")}
        </p>
      </header>

      {q.isLoading && <Skeleton className="h-40 w-full" />}

      {q.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
        >
          {t("common.loadError")}
        </p>
      )}

      {q.data && items.length === 0 && (
        <div className="card flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="text-4xl">
            🌱
          </span>
          <p className="text-gray-600 dark:text-gray-300">
            {t("orphan.achievements.empty")}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-4">
          {items.map((a) => (
            <AchievementCard key={a.id} item={a} lang={i18n.language} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AchievementCard({
  item,
  lang,
}: {
  item: OrphanAchievement;
  lang: string;
}) {
  const { t } = useTranslation();

  const groups: { emoji: string; label: string; highlights: string[] }[] = [
    {
      emoji: "📚",
      label: t("orphan.achievements.education"),
      highlights: collectHighlights(item.educational_progress),
    },
    {
      emoji: "🕌",
      label: t("orphan.achievements.quran"),
      highlights: collectHighlights(item.quran_progress),
    },
    {
      emoji: "🎨",
      label: t("orphan.achievements.activities"),
      highlights: collectHighlights(item.activities),
    },
  ].filter((g) => g.highlights.length > 0);

  return (
    <li className="card space-y-4">
      <p className="text-sm font-medium text-trust-600 dark:text-trust-100">
        {formatPeriod(item.period_start, item.period_end, lang)}
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("orphan.achievements.noHighlights")}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                <span aria-hidden="true">{g.emoji}</span>
                {g.label}
              </h3>
              <ul className="space-y-1.5">
                {g.highlights.map((h, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200"
                  >
                    <CheckIcon />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Flatten a free-form progress object into readable highlight lines.
 * Renders scalar leaf values only — never raw keys, nested JSON, or
 * empty values — so unexpected shapes degrade gracefully.
 */
function collectHighlights(
  record: Record<string, unknown> | null | undefined,
): string[] {
  if (!record || typeof record !== "object") return [];
  const out: string[] = [];

  const visit = (value: unknown) => {
    if (value == null) return;
    if (typeof value === "string") {
      const s = value.trim();
      if (s) out.push(s);
    } else if (typeof value === "number") {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === "object") {
      Object.values(value).forEach(visit);
    }
    // booleans and other types are intentionally skipped
  };

  Object.values(record).forEach(visit);
  return out;
}

function formatPeriod(start: string, end: string, lang: string): string {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "long" };
  const s = new Date(start).toLocaleDateString(lang, opts);
  const e = new Date(end).toLocaleDateString(lang, opts);
  return s === e ? s : `${s} – ${e}`;
}

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-success-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
