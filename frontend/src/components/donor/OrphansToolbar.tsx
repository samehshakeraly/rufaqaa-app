import { useTranslation } from "react-i18next";

import type { FilterChip, SortKey } from "@/lib/donorOrphans";

const CHIPS: FilterChip[] = ["all", "attention", "active", "paused"];
const SORTS: SortKey[] = ["priority", "name", "newest"];

/** PR-D06 — search + filter chips + sort for the "My Orphans" grid.
 * Only rendered when there are at least two cards; a single child needs
 * no toolbar. All state lives in the page — this is a controlled row. */
export function OrphansToolbar({
  query,
  onQueryChange,
  chip,
  onChipChange,
  sort,
  onSortChange,
  counts,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  chip: FilterChip;
  onChipChange: (value: FilterChip) => void;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  /** Card count per chip, shown inside each chip. */
  counts: Record<FilterChip, number>;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">{t("donor.orphans.toolbar.searchLabel")}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("donor.orphans.toolbar.searchPlaceholder")}
            className="input min-h-[44px]"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <span className="shrink-0">{t("donor.orphans.toolbar.sortLabel")}</span>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="input min-h-[44px] w-auto"
          >
            {SORTS.map((key) => (
              <option key={key} value={key}>
                {t(`donor.orphans.toolbar.sort.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        role="group"
        aria-label={t("donor.orphans.toolbar.filtersLabel")}
        className="flex flex-wrap gap-2"
      >
        {CHIPS.map((key) => {
          const selected = chip === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => onChipChange(key)}
              className={`min-h-[44px] rounded-full px-4 py-1.5 text-sm font-medium transition ${
                selected
                  ? "bg-trust-500 text-white shadow-sm"
                  : "border border-sky-200 bg-white text-gray-700 hover:bg-tranquil-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {t(`donor.orphans.toolbar.filters.${key}`)}
              <span
                className={`ms-1.5 text-xs ${selected ? "text-white/80" : "text-gray-500 dark:text-gray-400"}`}
              >
                {counts[key]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
