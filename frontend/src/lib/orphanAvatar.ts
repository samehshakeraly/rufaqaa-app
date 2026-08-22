/** Deterministic child-avatar building blocks, shared by every donor
 * surface (OrphanCard, the dashboard feed, the next-payment card).
 *
 * Extracted verbatim from OrphanCard.tsx (PR-D01). They live in lib/ —
 * not next to a component — because `react-refresh/only-export-components`
 * warns on a component file that also exports constants/functions, and
 * lint runs with `--max-warnings 0`. */

/** Deterministic avatar palette — bg/text utility pairs hand-picked from
 * the design-system ramps for ≥ 4.5:1 contrast in BOTH light and dark
 * mode. Index = stable hash of orphan_id, so a child keeps their color
 * across visits. Never random HSL, never a real child photo. */
export const AVATAR_PALETTE = [
  "bg-trust-100 text-trust-700 dark:bg-trust-800 dark:text-trust-100",
  "bg-tranquil-200 text-trust-700 dark:bg-gray-700 dark:text-tranquil-200",
  "bg-success-100 text-success-700 dark:bg-success-700 dark:text-success-50",
  "bg-warning-100 text-warning-700 dark:bg-warning-700 dark:text-warning-50",
  "bg-info-100 text-info-700 dark:bg-info-700 dark:text-info-50",
  "bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-100",
] as const;

/** With `noUncheckedIndexedAccess` an indexed read is `string | undefined`
 * — this is the `??` fallback, never a non-null assertion. */
export const AVATAR_FALLBACK_CLASS: string = AVATAR_PALETTE[0];

/** Two-character monogram: initials of the first two words, or the first
 * two letters of a single-word name. */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "•";
  const second = words[1];
  if (!second) return first.slice(0, 2);
  return `${first.charAt(0)}${second.charAt(0)}`;
}
