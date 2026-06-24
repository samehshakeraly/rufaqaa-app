/** Shared date/duration formatting for the donor portal.
 *
 * Extracted verbatim from DonorOrphanDetailPage so the "My Orphans" list
 * (D-06) and the child-journey detail (D-07) phrase time identically —
 * one source of truth for "since" lines and dates. No behaviour change. */

export function formatDate(value: string, lang: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export interface Duration {
  years: number;
  months: number;
}

/** Whole years + remaining months between `start` and now. Returns null
 * for an unparseable or future date. */
export function humanDuration(start: string): Duration | null {
  const from = new Date(start);
  if (Number.isNaN(from.getTime())) return null;
  const now = new Date();
  let months =
    (now.getFullYear() - from.getFullYear()) * 12 +
    (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  if (months < 0) return null;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function formatDuration(
  d: Duration,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (d.years > 0 && d.months > 0)
    return t("donorTimeline.durationYearsMonths", {
      years: d.years,
      months: d.months,
    });
  if (d.years > 0) return t("donorTimeline.durationYears", { years: d.years });
  if (d.months > 0)
    return t("donorTimeline.durationMonths", { months: d.months });
  return t("donorTimeline.durationNew");
}
