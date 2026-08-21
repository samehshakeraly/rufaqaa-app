import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { ImpactBar } from "@/components/donor/ImpactBar";
import { MyOrphansEmptyState } from "@/components/donor/MyOrphansEmptyState";
import { OrphanCard } from "@/components/donor/OrphanCard";
import { OrphanCardSkeleton } from "@/components/donor/OrphanCardSkeleton";
import { OrphansToolbar } from "@/components/donor/OrphansToolbar";
import type { FilterChip, SortKey } from "@/lib/donorOrphans";
import {
  buildOrphanCards,
  filterCards,
  needsAttention,
  sortCards,
  summarizeImpact,
} from "@/lib/donorOrphans";
import { listDonorMessages } from "@/lib/messages";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

/** PR-D06 — the redesigned donor "My Orphans" page.
 *
 * Container only: fetches the three donor-scoped datasets and hands the
 * merge/priority work to the pure functions in `@/lib/donorOrphans`.
 *
 * Fetch contract: the page renders as soon as SPONSORSHIPS arrive.
 * Reports and messages are progressive enhancements — if either fails,
 * cards render without a relationship line and no error is shown. Only
 * a sponsorships failure blocks the page (alert + retry). */
export function DonorOrphansPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<FilterChip>("all");
  const [sort, setSort] = useState<SortKey>("priority");

  const sponsorshipsQ = useQuery({
    queryKey: ["donor", "me", "portal-sponsorships"],
    queryFn: () => listMySponsorships({ limit: 100 }),
  });
  const reportsQ = useQuery({
    queryKey: ["donor", "me", "reports"],
    queryFn: () => listMyReports({ limit: 100 }),
    retry: false,
  });
  const messagesQ = useQuery({
    queryKey: ["donor", "me", "messages"],
    queryFn: () => listDonorMessages({ limit: 100 }),
    retry: false,
  });

  // A stable "now" per data snapshot keeps sorting deterministic within
  // a render pass.
  const now = useMemo(
    () => new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sponsorshipsQ.data, reportsQ.data, messagesQ.data],
  );

  const cards = useMemo(
    () =>
      buildOrphanCards(
        sponsorshipsQ.data?.items ?? [],
        reportsQ.data?.items ?? [],
        messagesQ.data?.items ?? [],
      ),
    [sponsorshipsQ.data, reportsQ.data, messagesQ.data],
  );

  const impact = useMemo(
    () => summarizeImpact(sponsorshipsQ.data?.items ?? [], now),
    [sponsorshipsQ.data, now],
  );

  const visible = useMemo(
    () => sortCards(filterCards(cards, chip, query), sort, now),
    [cards, chip, query, sort, now],
  );

  const counts = useMemo(
    () => ({
      all: cards.length,
      attention: cards.filter(needsAttention).length,
      active: cards.filter((c) => c.sponsorship.status === "active").length,
      paused: cards.filter((c) => c.sponsorship.status === "paused").length,
    }),
    [cards],
  );

  const filtering = query.trim() !== "" || chip !== "all";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("donor.orphans.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("donor.orphans.subtitle")}
        </p>
      </header>

      {sponsorshipsQ.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <OrphanCardSkeleton />
          <OrphanCardSkeleton />
          <OrphanCardSkeleton />
        </div>
      )}

      {sponsorshipsQ.isError && (
        <div
          role="alert"
          className="card flex flex-col items-start gap-3 border-warning-500/40 p-5"
        >
          <p className="text-sm text-gray-700 dark:text-gray-200">
            {t("common.loadError")}
          </p>
          <button
            type="button"
            onClick={() => sponsorshipsQ.refetch()}
            className="btn-primary min-h-[44px]"
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {sponsorshipsQ.isSuccess && cards.length === 0 && <MyOrphansEmptyState />}

      {sponsorshipsQ.isSuccess && cards.length > 0 && (
        <>
          {impact && <ImpactBar summary={impact} />}

          {cards.length > 1 && (
            <OrphansToolbar
              query={query}
              onQueryChange={setQuery}
              chip={chip}
              onChipChange={setChip}
              sort={sort}
              onSortChange={setSort}
              counts={counts}
            />
          )}

          {visible.length === 0 && filtering ? (
            <div className="card flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("donor.orphans.noResults")}
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setChip("all");
                }}
                className="btn-secondary min-h-[44px]"
              >
                {t("donor.orphans.clearFilters")}
              </button>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((card) => (
                <li key={card.sponsorship.id}>
                  <OrphanCard card={card} now={now} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
