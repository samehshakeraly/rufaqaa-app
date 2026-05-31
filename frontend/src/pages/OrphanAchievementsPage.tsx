import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  getOrphanMe,
  listOrphanAchievements,
  type OrphanAchievement,
} from "@/lib/orphanSelf";

import "./OrphanAchievementsPage.css";

/** O-04 — a warm timeline of the orphan's published achievements.
 *
 * Backend returns only published reports, projected to progress fields.
 * The JSON blobs are free-form, so we flatten them to readable highlight
 * lines defensively (no raw JSON, technical keys, or financial data) and
 * present them in the O-04 visual language. */
export function OrphanAchievementsPage() {
  const { t, i18n } = useTranslation();
  const profile = useQuery({ queryKey: ["orphan", "me"], queryFn: getOrphanMe });
  const q = useQuery({
    queryKey: ["orphan", "me", "achievements"],
    queryFn: () => listOrphanAchievements(20),
  });

  const items = q.data ?? [];
  const name = profile.data?.first_name ?? "";

  return (
    <div className="oach-root">
      <div className="oach-stack">
        <header className="oach-header">
          <span className="oach-emoji" aria-hidden="true">
            🌟
          </span>
          <h1 className="oach-title">
            {t("orphan.achievements.headerTitle")}{" "}
            {name && <span className="oach-name">{name}</span>}
          </h1>
          <p className="oach-sub">{t("orphan.achievements.subtitle")}</p>
        </header>

        {q.isLoading && <Skeleton className="h-40 w-full" />}

        {q.error && (
          <p className="oach-error" role="alert">
            {t("common.loadError")}
          </p>
        )}

        {q.data && items.length === 0 && (
          <div className="oach-empty">
            <span className="oach-empty-emoji" aria-hidden="true">
              🌱
            </span>
            <p>{t("orphan.achievements.empty")}</p>
          </div>
        )}

        {items.map((a) => (
          <AchievementReport key={a.id} item={a} lang={i18n.language} />
        ))}

        {items.length > 0 && (
          <div className="oach-celebrate">
            <div className="oach-celebrate-emoji" aria-hidden="true">
              🎉
            </div>
            <h2 className="oach-celebrate-title">
              {t("orphan.achievements.celebrateTitle")}
            </h2>
            <p className="oach-celebrate-text">
              {t("orphan.achievements.celebrateBody")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AchievementReport({
  item,
  lang,
}: {
  item: OrphanAchievement;
  lang: string;
}) {
  const { t } = useTranslation();

  const groups: {
    key: "education" | "quran" | "activities";
    label: string;
    icon: React.ReactNode;
    highlights: string[];
  }[] = [
    {
      key: "education" as const,
      label: t("orphan.achievements.education"),
      icon: <SchoolIcon />,
      highlights: collectHighlights(item.educational_progress),
    },
    {
      key: "quran" as const,
      label: t("orphan.achievements.quran"),
      icon: <QuranIcon />,
      highlights: collectHighlights(item.quran_progress),
    },
    {
      key: "activities" as const,
      label: t("orphan.achievements.activities"),
      icon: <ActivityIcon />,
      highlights: collectHighlights(item.activities),
    },
  ].filter((g) => g.highlights.length > 0);

  return (
    <div className="oach-report">
      <p className="oach-period">
        {formatPeriod(item.period_start, item.period_end, lang)}
      </p>

      {groups.length === 0 ? (
        <p className="oach-none">{t("orphan.achievements.noHighlights")}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} aria-labelledby={`oach-${item.id}-${g.key}`}>
            <div className="oach-section-head">
              <span className={`oach-section-icon ${g.key}`} aria-hidden="true">
                {g.icon}
              </span>
              <h2 className="oach-section-title" id={`oach-${item.id}-${g.key}`}>
                {g.label}
              </h2>
            </div>
            <div className={`oach-card ${g.key}`}>
              <ul className="oach-list">
                {g.highlights.map((h, i) => (
                  <li key={i} className="oach-item">
                    <span className="oach-check" aria-hidden="true">
                      <svg className="oach-icon" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="oach-text">{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))
      )}
    </div>
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

function SchoolIcon() {
  return (
    <svg className="oach-icon" viewBox="0 0 24 24">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}
function QuranIcon() {
  return (
    <svg className="oach-icon" viewBox="0 0 24 24">
      <path d="M3 21h18M5 21V7l7-4 7 4v14" />
      <path d="M9 21V12h6v9" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg className="oach-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
