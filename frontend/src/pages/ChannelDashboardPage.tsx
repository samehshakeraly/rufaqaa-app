import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Money } from "@/components/Money";
import { Skeleton } from "@/components/Skeleton";
import { fetchChannelProgress, getMarketingChannel } from "@/lib/marketingChannels";
import { listOrphans } from "@/lib/orphans";

export function ChannelDashboardPage() {
  const { t, i18n } = useTranslation();
  const { id = "" } = useParams();

  const { data: channel } = useQuery({
    queryKey: ["marketing-channel", id],
    queryFn: () => getMarketingChannel(id),
    enabled: !!id,
  });
  const { data: progress } = useQuery({
    queryKey: ["marketing-channel", id, "progress"],
    queryFn: () => fetchChannelProgress(id),
    enabled: !!id,
  });
  const { data: orphans } = useQuery({
    queryKey: ["orphans", { channel_id: id, assignment_status: "active" }],
    queryFn: () =>
      listOrphans({ channel_id: id, assignment_status: "active", limit: 100 }),
    enabled: !!id,
  });

  const channelName = channel
    ? i18n.language === "ar"
      ? channel.name_ar
      : channel.name_en ?? channel.name_ar
    : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500">{t("marketing.channel.eyebrow")}</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {channel ? channelName : <Skeleton className="inline-block h-7 w-48" />}
          </h1>
          {channel && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              {channel.channel_type && (
                <span>{t(`marketingChannels.types.${channel.channel_type}`)}</span>
              )}
              <StatusBadge status={channel.status} />
            </div>
          )}
        </div>
        {id && (
          <Link to={`/admin/marketing/channels/${id}/orphans`} className="btn-primary">
            {t("marketing.channel.viewOrphans")}
          </Link>
        )}
      </div>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("marketing.channel.goalProgress")}
          </h2>
          {!progress && <Skeleton className="h-40 w-full" />}
          {progress && (
            <div className="space-y-6">
              <GoalGroup
                title={t("marketing.channel.annual", { year: progress.goal_year })}
                achievedCount={progress.achieved_count}
                goalCount={progress.annual_goal_count}
                pctCount={progress.completion_percentage_count}
                achievedAmount={progress.achieved_amount}
                goalAmount={progress.annual_goal_amount}
                pctAmount={progress.completion_percentage_amount}
                currency={progress.goal_currency}
              />
              <GoalGroup
                title={t("marketing.channel.monthly")}
                achievedCount={progress.monthly_achieved_count}
                goalCount={
                  progress.monthly_goal_count == null
                    ? null
                    : Math.round(progress.monthly_goal_count)
                }
                pctCount={pct(
                  progress.monthly_achieved_count,
                  progress.monthly_goal_count,
                )}
                achievedAmount={progress.monthly_achieved_amount}
                goalAmount={progress.monthly_goal_amount}
                pctAmount={pct(
                  Number(progress.monthly_achieved_amount),
                  progress.monthly_goal_amount == null
                    ? null
                    : Number(progress.monthly_goal_amount),
                )}
                currency={progress.goal_currency}
              />
            </div>
          )}
        </div>

        <div className="card flex flex-col items-center justify-center gap-3">
          <h2 className="self-start text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("marketing.channel.completion")}
          </h2>
          {progress ? (
            <ProgressRing value={progress.completion_percentage_amount} />
          ) : (
            <Skeleton className="h-40 w-40 rounded-full" />
          )}
          {progress && (
            <p className="text-sm text-gray-500">
              {t("marketing.channel.completionAmountLabel")}
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t("marketing.channel.assignedOrphans")}
            </h2>
            {id && (
              <Link
                to={`/admin/marketing/channels/${id}/orphans`}
                className="text-sm text-trust underline"
              >
                {t("marketing.channel.viewAll")}
              </Link>
            )}
          </div>
          {!orphans && <Skeleton className="h-24 w-full" />}
          {orphans && orphans.items.length === 0 && (
            <p className="text-sm text-gray-500">{t("common.empty")}</p>
          )}
          {orphans && orphans.items.length > 0 && (
            <ul className="divide-y divide-sky/40 text-sm dark:divide-gray-700">
              {orphans.items.slice(0, 8).map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <span className="text-gray-900 dark:text-gray-100">
                    {o.first_name} {o.family_name}
                  </span>
                  <span className="font-mono text-xs text-gray-500">{o.code}</span>
                </li>
              ))}
            </ul>
          )}
          {orphans && orphans.total > 8 && (
            <p className="mt-2 text-xs text-gray-500">
              {t("marketing.channel.assignedCount", { n: orphans.total })}
            </p>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("marketing.channel.acquiredDonors")}
          </h2>
          {/* The donors list endpoint does not yet support filtering by
              acquisition channel, so per-channel donor figures aren't
              available without a backend change (out of scope here). */}
          <p className="rounded-lg bg-info-50 px-3 py-2 text-sm text-info-700">
            {t("common.comingSoon")}
          </p>
        </div>
      </section>
    </div>
  );
}

function pct(achieved: number, goal: number | null | undefined): number {
  if (!goal) return 0;
  return Math.round((achieved / goal) * 1000) / 10;
}

function GoalGroup({
  title,
  achievedCount,
  goalCount,
  pctCount,
  achievedAmount,
  goalAmount,
  pctAmount,
  currency,
}: {
  title: string;
  achievedCount: number;
  goalCount: number | null;
  pctCount: number;
  achievedAmount: string;
  goalAmount: string | null;
  pctAmount: number;
  currency: string | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
        {title}
      </h3>
      <ProgressBar
        label={t("marketing.channel.sponsorships")}
        valueText={
          <span className="tabular-nums">
            {achievedCount.toLocaleString()} /{" "}
            {goalCount == null ? "—" : goalCount.toLocaleString()}
          </span>
        }
        pct={pctCount}
      />
      <ProgressBar
        label={t("marketing.channel.amount")}
        valueText={
          <span className="flex items-center gap-1">
            <Money amount={achievedAmount} currency={currency} />
            <span className="text-gray-400">/</span>
            {goalAmount == null ? (
              <span className="tabular-nums">—</span>
            ) : (
              <Money amount={goalAmount} currency={currency} />
            )}
          </span>
        }
        pct={pctAmount}
      />
    </div>
  );
}

function ProgressBar({
  label,
  valueText,
  pct,
}: {
  label: string;
  valueText: React.ReactNode;
  pct: number;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="text-gray-900 dark:text-gray-100">{valueText}</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded bg-snow dark:bg-gray-700"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded bg-trust-500"
          style={{ inlineSize: `${clamped}%` }}
        />
      </div>
      <p className="text-end text-xs text-gray-500 tabular-nums">{pct.toFixed(1)}%</p>
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  const r = 56;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <svg
      viewBox="0 0 140 140"
      className="h-40 w-40"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <circle
        cx={70}
        cy={70}
        r={r}
        className="fill-none stroke-snow dark:stroke-gray-700"
        strokeWidth={12}
      />
      <circle
        cx={70}
        cy={70}
        r={r}
        className="fill-none stroke-trust-500"
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 70 70)"
      />
      <text
        x={70}
        y={76}
        textAnchor="middle"
        className="fill-gray-900 text-xl font-bold tabular-nums dark:fill-gray-100"
      >
        {clamped.toFixed(1)}%
      </text>
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls =
    status === "active"
      ? "bg-success-100 text-success-700"
      : status === "suspended"
        ? "bg-warning-100 text-warning-700"
        : "bg-gray-200 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {t(`marketingChannels.statuses.${status}`, status)}
    </span>
  );
}
