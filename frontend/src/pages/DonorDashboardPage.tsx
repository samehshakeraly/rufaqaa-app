import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { AttentionBar, CalmBar } from "@/components/donor/AttentionBar";
import { ChildrenFeed } from "@/components/donor/ChildrenFeed";
import { DashboardImpact } from "@/components/donor/DashboardImpact";
import { DashboardSkeleton } from "@/components/donor/DashboardSkeleton";
import { DashboardWelcome } from "@/components/donor/DashboardWelcome";
import { NextPaymentCard } from "@/components/donor/NextPaymentCard";
import { PortalGates } from "@/components/donor/PortalGates";
import { QuickActions } from "@/components/donor/QuickActions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import {
  buildNewsFeed,
  nextScheduledPayment,
  summarizeAttention,
  summarizeYearToDate,
} from "@/lib/donorDashboard";
import { buildOrphanCards, summarizeImpact } from "@/lib/donorOrphans";
import { buildPaymentRows, rowsInYear } from "@/lib/donorPayments";
import { listDonorMessages } from "@/lib/messages";
import { listMyPayments } from "@/lib/payments";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

/** PR-D01 — the dashboard as the donor's "today" screen.
 *
 * After PR-D06 (My Orphans) and PR-D08 (My Payments) the old dashboard
 * duplicated both. Its job now: what needs the donor's attention right
 * NOW, and what reached them about their children — it points at the
 * two pages, it never copies them.
 *
 * Container only: fetches the four donor-scoped datasets the app
 * already has and hands all merge/ordering work to the pure functions
 * in `@/lib/donorDashboard` + `@/lib/donorOrphans`. No /donor/me call:
 * every number it gave is derivable from the loaded sponsorships, and
 * its single-total aggregate can't express mixed currencies.
 *
 * Fetch contract: the page renders as soon as SPONSORSHIPS arrive.
 * - reports/messages failing → the timeline hides, NO alert;
 * - payments failing → the "this year" cell shows "—";
 * - only a sponsorships failure blocks the page (alert + retry). */
export function DonorDashboardPage() {
  const { t } = useTranslation();
  const { data: me } = useCurrentUser();
  // Donor self-service endpoints 403 for any non-donor role. DonorRoute
  // already redirects staff away, but gate the queries on role too so a
  // donor-scoped request can never fire during a role transition (e.g.
  // an org_admin briefly mounting this tree).
  const { isDonor } = useRole();

  const sponsorshipsQ = useQuery({
    queryKey: ["donor", "me", "portal-sponsorships"],
    queryFn: () => listMySponsorships({ limit: 100 }),
    enabled: isDonor,
  });
  const reportsQ = useQuery({
    queryKey: ["donor", "me", "reports"],
    queryFn: () => listMyReports({ limit: 100 }),
    enabled: isDonor,
    retry: false,
  });
  const messagesQ = useQuery({
    queryKey: ["donor", "me", "messages"],
    queryFn: () => listDonorMessages({ limit: 100 }),
    enabled: isDonor,
    retry: false,
  });
  const paymentsQ = useQuery({
    queryKey: ["donor", "me", "payments", { surface: "dashboard" }],
    queryFn: () => listMyPayments({ limit: 100 }),
    enabled: isDonor,
    retry: false,
  });

  // A stable "now" per data snapshot keeps every window and ordering
  // deterministic within a render pass.
  const now = useMemo(
    () => new Date(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sponsorshipsQ.data, reportsQ.data, messagesQ.data, paymentsQ.data],
  );

  const sponsorships = useMemo(
    () => sponsorshipsQ.data?.items ?? [],
    [sponsorshipsQ.data],
  );

  const cards = useMemo(
    () =>
      buildOrphanCards(
        sponsorships,
        reportsQ.data?.items ?? [],
        messagesQ.data?.items ?? [],
      ),
    [sponsorships, reportsQ.data, messagesQ.data],
  );

  const attention = useMemo(() => summarizeAttention(cards), [cards]);
  const impact = useMemo(
    () => summarizeImpact(sponsorships, now),
    [sponsorships, now],
  );
  const feed = useMemo(() => buildNewsFeed(cards, now), [cards, now]);
  const nextPayment = useMemo(
    () => nextScheduledPayment(sponsorships, now),
    [sponsorships, now],
  );
  const ytd = useMemo(
    () =>
      paymentsQ.data ? summarizeYearToDate(paymentsQ.data.items, now) : null,
    [paymentsQ.data, now],
  );
  const statementRows = useMemo(
    () =>
      paymentsQ.data
        ? rowsInYear(
            buildPaymentRows(paymentsQ.data.items, sponsorships),
            now.getFullYear(),
          )
        : null,
    [paymentsQ.data, sponsorships, now],
  );

  const activeCount = useMemo(
    () => sponsorships.filter((s) => s.status === "active").length,
    [sponsorships],
  );

  // The timeline is a progressive enhancement over BOTH feeds; if either
  // fetch failed it hides entirely — never a partial "news" list.
  const showFeed =
    reportsQ.isSuccess && messagesQ.isSuccess && feed.length > 0;

  return (
    <div className="space-y-6">
      {/* PR-W01 — the greeting and the two portal gates share the header
          row. The gates live HERE, not in the content, so they render in
          every page state: loading, error, and zero sponsorships. */}
      <header className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {me?.first_name
              ? t("donor.dashboard.greeting.named", { name: me.first_name })
              : t("donor.dashboard.greeting.plain")}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {t("donor.dashboard.greeting.subtitle")}
          </p>
        </div>
        <PortalGates />
      </header>

      {sponsorshipsQ.isLoading && <DashboardSkeleton />}

      {sponsorshipsQ.isError && (
        <div
          role="alert"
          className="card flex flex-col items-start gap-3 border-warning-500/40 p-5"
        >
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("donor.dashboard.error.title")}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {t("donor.dashboard.error.body")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => sponsorshipsQ.refetch()}
              className="btn-primary min-h-[44px]"
            >
              {t("common.retry")}
            </button>
            <Link
              to="/donor/orphans"
              className="text-sm font-medium text-trust-600 underline dark:text-trust-100"
            >
              {t("donor.dashboard.error.openOrphans")}
            </Link>
          </div>
        </div>
      )}

      {sponsorshipsQ.isSuccess && cards.length === 0 && <DashboardWelcome />}

      {sponsorshipsQ.isSuccess && cards.length > 0 && (
        <>
          {attention.signals === 0 ? (
            <CalmBar />
          ) : (
            <AttentionBar attention={attention} now={now} />
          )}

          <div className="grid items-start gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {impact && (
                <DashboardImpact
                  summary={impact}
                  activeCount={activeCount}
                  ytd={ytd}
                  year={now.getFullYear()}
                  statementRows={statementRows}
                />
              )}
              {showFeed && <ChildrenFeed items={feed} now={now} />}
            </div>
            <div className="space-y-6">
              <NextPaymentCard sponsorship={nextPayment} now={now} />
              <QuickActions unreadTotal={attention.unreadTotal} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
