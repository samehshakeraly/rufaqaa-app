import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { fetchChannelProgress, getMarketingChannel } from "@/lib/marketingChannels";
import { type Orphan, listOrphans } from "@/lib/orphans";

import "./ChannelDashboardPage.css";

function pct(achieved: number, goal: number | null | undefined): number {
  if (!goal) return 0;
  return Math.round((achieved / goal) * 1000) / 10;
}

/** Days until the assignment deadline (negative when already past). */
function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function initials(o: Orphan): string {
  return `${o.first_name?.[0] ?? ""}${o.family_name?.[0] ?? ""}`;
}

/** MM-01 — channel-scoped overview for a marketing manager. Goal hero,
 * the KPIs we can derive from the channel's own data, an assigned-orphan
 * snapshot, and a deadline-driven "needs attention" list. Cross-channel
 * analytics (funnel / geo / acquired donors) are not yet exposed by the
 * API and render as neutral placeholders — never fabricated data. */
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
      : (channel.name_en ?? channel.name_ar)
    : "";

  const items = orphans?.items ?? [];
  const waiting = items.filter((o) => !o.is_sponsored).length;
  // Orphans whose deadline falls within the next week (or is already past)
  // need the manager's attention first.
  const urgent = items
    .map((o) => ({ o, days: daysUntil(o.assignment_deadline) }))
    .filter((x) => x.days != null && x.days <= 7)
    .sort((a, b) => (a.days as number) - (b.days as number))
    .slice(0, 5);

  const annualPct = progress ? Math.min(100, progress.completion_percentage_count) : 0;
  const annualGoal = progress?.annual_goal_count ?? null;
  const exceeded =
    annualGoal != null && progress != null && progress.achieved_count > annualGoal;

  return (
    <div className="mmd-root">
      <div className="mmd-stack">
        {/* Header */}
        <header className="mmd-head">
          <div>
            <p className="mmd-eyebrow">
              {channel?.channel_type
                ? t(`marketingChannels.types.${channel.channel_type}`)
                : t("marketing.channel.eyebrow")}
              {channel && (
                <span className={`mmd-status ${channel.status}`}>
                  {t(`marketingChannels.statuses.${channel.status}`, channel.status)}
                </span>
              )}
            </p>
            <h1 className="mmd-title">
              {channel ? channelName : <Skeleton className="inline-block h-7 w-48" />}
            </h1>
          </div>
          {id && (
            <div className="mmd-actions">
              <Link
                to={`/admin/marketing/channels/${id}/orphans`}
                className="mmd-btn"
              >
                {t("marketing.channel.viewOrphans")}
              </Link>
            </div>
          )}
        </header>

        {/* Hero — goal progress */}
        <section className="mmd-hero" aria-label={t("marketing.channel.goalProgress")}>
          {!progress && <Skeleton className="h-40 w-full" />}
          {progress && (
            <div className="mmd-hero-row">
              <div className="mmd-hero-left">
                <div className="mmd-hero-label">
                  {t("marketing.channel.annualGoalLabel")}
                </div>
                <div className="mmd-hero-num">
                  <span className="mmd-num">
                    {progress.achieved_count.toLocaleString()}
                  </span>{" "}
                  <span className="mmd-of">
                    / <span className="mmd-num">
                      {annualGoal == null ? "—" : annualGoal.toLocaleString()}
                    </span>
                  </span>
                </div>
                <div className="mmd-hero-sub">
                  {t("marketing.channel.newSponsors")}
                  {exceeded && annualGoal != null && (
                    <span className="mmd-hero-delta mmd-num">
                      +{(progress.achieved_count - annualGoal).toLocaleString()}
                    </span>
                  )}
                </div>
                <div
                  className="mmd-progress"
                  role="progressbar"
                  aria-valuenow={Math.round(annualPct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="mmd-progress-track">
                    <div
                      className="mmd-progress-fill"
                      style={{ inlineSize: `${annualPct}%` }}
                    />
                  </div>
                  <div className="mmd-progress-meta">
                    <span>
                      <strong className="mmd-num">
                        {progress.completion_percentage_count.toFixed(0)}%
                      </strong>{" "}
                      {t("marketing.channel.ofGoal")}
                    </span>
                    <span>{t("marketing.channel.annual", { year: progress.goal_year })}</span>
                  </div>
                </div>
              </div>

              {/* Monthly snapshot — single month the API exposes */}
              <div className="mmd-hero-right">
                <div className="mmd-hero-label">
                  {t("marketing.channel.monthlySnapshot")}
                </div>
                <div className="mmd-hero-num" style={{ fontSize: "34px" }}>
                  <span className="mmd-num">
                    {progress.monthly_achieved_count.toLocaleString()}
                  </span>{" "}
                  <span className="mmd-of">
                    /{" "}
                    <span className="mmd-num">
                      {progress.monthly_goal_count == null
                        ? "—"
                        : Math.round(progress.monthly_goal_count).toLocaleString()}
                    </span>
                  </span>
                </div>
                <div
                  className="mmd-progress"
                  style={{ marginTop: 4 }}
                  role="progressbar"
                  aria-valuenow={Math.round(
                    Math.min(
                      100,
                      pct(progress.monthly_achieved_count, progress.monthly_goal_count),
                    ),
                  )}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="mmd-progress-track">
                    <div
                      className="mmd-progress-fill"
                      style={{
                        inlineSize: `${Math.min(
                          100,
                          pct(
                            progress.monthly_achieved_count,
                            progress.monthly_goal_count,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                  <div className="mmd-progress-meta">
                    <span>{t("marketing.channel.monthly")}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* KPI strip — derived from the channel's own data only */}
        <section className="mmd-kpi-strip" aria-label={t("marketing.channel.goalProgress")}>
          <Kpi
            label={t("marketing.channel.assignedOrphans")}
            value={orphans ? orphans.total.toLocaleString() : "—"}
            foot={t("marketing.channel.activeAssignments")}
            icon={<UsersIcon />}
          />
          <Kpi
            label={t("marketing.channel.waiting")}
            value={orphans ? waiting.toLocaleString() : "—"}
            foot={
              orphans
                ? t("marketing.channel.ofLoaded", { n: items.length })
                : ""
            }
            icon={<HeartIcon />}
          />
          <Kpi
            label={t("marketing.modal.annualGoal")}
            value={annualGoal == null ? "—" : annualGoal.toLocaleString()}
            unit={t("marketing.kpi.annualGoalUnit")}
            foot={
              progress
                ? t("marketing.channel.annual", { year: progress.goal_year })
                : ""
            }
            icon={<TargetIcon />}
          />
          <Kpi
            label={t("marketing.channel.completion")}
            value={progress ? progress.completion_percentage_count.toFixed(0) : "—"}
            unit="%"
            foot={t("marketing.channel.byCount")}
            icon={<TrendIcon />}
          />
        </section>

        {/* Assigned orphans + needs attention */}
        <section className="mmd-grid">
          <div className="mmd-card">
            <header className="mmd-card-head">
              <div>
                <h2 className="mmd-card-title">
                  {t("marketing.channel.assignedOrphans")}
                  {orphans && (
                    <span className="mmd-count-pill mmd-num">{orphans.total}</span>
                  )}
                </h2>
              </div>
              {id && (
                <Link
                  to={`/admin/marketing/channels/${id}/orphans`}
                  className="mmd-head-link"
                >
                  {t("marketing.channel.viewAll")}
                </Link>
              )}
            </header>
            <div className="mmd-card-body">
              {!orphans && <Skeleton className="h-24 w-full" />}
              {orphans && items.length === 0 && (
                <p className="mmd-empty">{t("common.empty")}</p>
              )}
              {orphans && items.length > 0 && (
                <ul className="mmd-list">
                  {items.slice(0, 6).map((o) => (
                    <li key={o.id} className="mmd-row">
                      <span className="mmd-avatar" aria-hidden="true">
                        {initials(o)}
                      </span>
                      <span className="mmd-info">
                        <span className="mmd-name">
                          {o.first_name} {o.family_name}
                        </span>
                        <span className="mmd-meta">
                          <span className="mmd-code">{o.code}</span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="mmd-action-card">
            <div className="mmd-action-top">
              <span className="mmd-action-ic" aria-hidden="true">
                <ClockIcon />
              </span>
              <div>
                <div className="mmd-action-ttl">
                  {t("marketing.channel.needsAttention")}
                </div>
                <div className="mmd-action-sub">
                  {t("marketing.channel.openTasks", { n: urgent.length })}
                </div>
              </div>
            </div>
            {!orphans && <Skeleton className="h-20 w-full" />}
            {orphans && urgent.length === 0 && (
              <p className="mmd-action-empty">{t("marketing.channel.noUrgent")}</p>
            )}
            {orphans && urgent.length > 0 && (
              <ul className="mmd-action-list">
                {urgent.map(({ o, days }) => (
                  <li
                    key={o.id}
                    className={`mmd-action-row ${(days as number) <= 3 ? "danger" : ""}`}
                  >
                    <span className="mmd-action-at">
                      {t("marketing.channel.deadlineFor", {
                        name: `${o.first_name} ${o.family_name}`,
                      })}
                    </span>
                    <span
                      className={`mmd-deadline ${(days as number) <= 3 ? "urgent" : ""}`}
                    >
                      {(days as number) <= 0
                        ? t("marketing.channel.urgent")
                        : t("marketing.channel.daysLeft", { n: days })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Acquired donors — not yet exposed per-channel by the API */}
        <section className="mmd-card">
          <header className="mmd-card-head">
            <div>
              <h2 className="mmd-card-title">
                {t("marketing.channel.acquiredDonors")}
              </h2>
              <p>{t("marketing.channel.acquiredDonorsSub")}</p>
            </div>
          </header>
          <div className="mmd-card-body">
            {/* TODO(backend): the donors list endpoint cannot yet be filtered
                by acquisition channel, and the acquisition funnel / geo /
                send-time analytics in the MM-01 design are not exposed.
                Render a neutral placeholder rather than fabricating figures. */}
            <p className="mmd-coming">
              <InfoIcon />
              <span>
                <strong>{t("marketing.comingSoonTitle")}</strong>{" "}
                {t("marketing.channel.acquiredDonorsBody")}
              </span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  foot,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  foot?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="mmd-kpi">
      <div className="mmd-kpi-head">
        <span aria-hidden="true">{icon}</span>
        {label}
      </div>
      <div className="mmd-kpi-val mmd-num">
        {value}
        {unit && <span className="mmd-unit">{unit}</span>}
      </div>
      {foot && <div className="mmd-kpi-foot">{foot}</div>}
    </div>
  );
}

function UsersIcon() {
  return (
    <svg className="mmd-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
    </svg>
  );
}
function HeartIcon() {
  return (
    <svg className="mmd-icon" viewBox="0 0 24 24">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg className="mmd-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg className="mmd-icon" viewBox="0 0 24 24">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="mmd-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function InfoIcon() {
  return (
    <svg className="mmd-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
