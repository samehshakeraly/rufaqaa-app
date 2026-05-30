import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/lib/api";
import { fetchOrganization } from "@/lib/organization";

import "./MarketingChannelsPage.css";

// ── Types ────────────────────────────────────────────────────────────
interface MarketingChannelRow {
  id: string;
  name: string;
  channel_type: string;
  referral_code: string | null;
  orphan_count: number;
  is_active: boolean;
}
interface MarketingChannelsResponse {
  channels: MarketingChannelRow[];
  total: number;
}

// ── Data fetcher ─────────────────────────────────────────────────────
async function fetchMarketingChannels(): Promise<MarketingChannelsResponse> {
  const { data } = await api.get<MarketingChannelsResponse>("/marketing-channels");
  return data;
}

// ── Inline icon primitives ────────────────────────────────────────────
function Icon({
  children,
  className = "oa-icon oa-icon-sm",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

const ICONS = {
  megaphone: (
    <>
      <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />
      <circle cx="12" cy="14" r="2" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  chevronStart: <polyline points="15 18 9 12 15 6" />,
  sliders: (
    <>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  dollar: (
    <>
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  prevYear: <polyline points="9 18 15 12 9 6" />,
  nextYear: <polyline points="15 18 9 12 15 6" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  mail: (
    <>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </>
  ),
  instagram: (
    <>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </>
  ),
  tv: (
    <>
      <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
      <polyline points="17 2 12 7 7 2" />
    </>
  ),
  partner: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  searchIcon: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  events: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  whatsapp: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  ticket: (
    <>
      <polyline points="20.38 3.46 16.15 7.69 14.74 6.27 13.32 7.69 11.91 6.27 10.49 7.69 9.08 6.27 7.66 7.69 6.24 6.27 4.83 7.69 3.42 6.27 2 7.69 6.24 11.92 14.74 11.92 14.74 13.34 16.15 14.75 17.57 13.34 18.98 14.75 20.4 13.34 22 15" />
    </>
  ),
  youtube: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </>
  ),
  banned: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="6" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
};

// ── Channel-type → icon/stripe class mapping ──────────────────────────
function channelIconClass(type: string): string {
  const map: Record<string, string> = {
    social_media: "social",
    digital_marketing: "email",
    email: "email",
    tv: "tv",
    partnership: "partner",
    search: "search",
    events: "events",
    committee: "events",
    branch: "partner",
    referral: "referral",
    influencer: "influencer",
    website: "search",
    other: "email",
  };
  return map[type] ?? "email";
}

function channelIconSvg(type: string): ReactNode {
  const map: Record<string, ReactNode> = {
    social_media: ICONS.whatsapp,
    digital_marketing: ICONS.mail,
    email: ICONS.mail,
    tv: ICONS.tv,
    partnership: ICONS.partner,
    search: ICONS.searchIcon,
    events: ICONS.events,
    committee: ICONS.users,
    branch: ICONS.megaphone,
    referral: ICONS.ticket,
    influencer: ICONS.youtube,
    website: ICONS.searchIcon,
    other: ICONS.megaphone,
  };
  return map[type] ?? ICONS.megaphone;
}

// ── Helper: format number with tabular-nums ───────────────────────────
function useFormatters() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    int: (n: number) => n.toLocaleString(lang, { maximumFractionDigits: 0 }),
  };
}

const PLACEHOLDER = "—";

// ═══════════════════════════════════════════════════════════════════════
// Page Component
// ═══════════════════════════════════════════════════════════════════════
export function MarketingChannelsPage() {
  const { t } = useTranslation();
  const fmt = useFormatters();

  const [view, setView] = useState<"cards" | "table">("cards");
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  // Year nav — UI-only, data scope is all channels from the API.
  // TODO(backend): no year-scoped filter param on GET /marketing-channels.
  const [selectedYear, _setSelectedYear] = useState(1446);
  const YEARS = [1444, 1445, 1446];
  const [selectedType, _setSelectedType] = useState<string>("email");

  const channelsQuery = useQuery({
    queryKey: ["marketing-channels"],
    queryFn: fetchMarketingChannels,
  });

  // TODO(backend): fetchOrganization currency used when money KPIs are available
  useQuery({ queryKey: ["organization"], queryFn: fetchOrganization });

  const channels = channelsQuery.data?.channels ?? [];
  const total = channelsQuery.data?.total ?? 0;

  const activeChannels = channels.filter((c) => c.is_active);
  const pausedChannels = channels.filter((c) => !c.is_active);

  const filteredActive = activeChannels.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.channel_type.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredPaused = pausedChannels.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.channel_type.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="oa-channels">
      {/* Single semantic h1 — visually hidden; visible title lives in the
          app topbar above this component. */}
      <h1 className="sr-only">{t("marketing.title")}</h1>

      {/* ── Topbar actions row ─────────────────────────────────────── */}
      <div className="oa-topbar-actions" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className="oa-btn-secondary"
          aria-label={t("marketing.monthlyReport")}
        >
          <Icon>{ICONS.file}</Icon>
          {t("marketing.monthlyReport")}
        </button>
        <button
          type="button"
          className="oa-btn-primary"
          onClick={() => setShowModal(true)}
          aria-label={t("marketing.createChannel")}
        >
          <Icon>{ICONS.plus}</Icon>
          {t("marketing.createChannel")}
        </button>
      </div>

      {/* ── Page head: performance label + year bar ────────────────── */}
      <div className="oa-channels-head">
        <div className="oa-channels-head-text">
          <div className="lbl">{t("marketing.pageLabel")}</div>
          <div className="val">
            {t("marketing.yearLabel")}{" "}
            <span className="latin">{selectedYear}</span>
          </div>
        </div>
        <div className="oa-year-bar" role="tablist" aria-label={t("marketing.yearLabel")}>
          <button
            className="oa-year-btn"
            aria-label={t("marketing.prevYear")}
            role="tab"
            aria-selected={false}
            type="button"
            /* Year nav is UI-only; real data not scoped per year.
               TODO(backend): add year_hijri param to /marketing-channels */
          >
            <Icon>{ICONS.prevYear}</Icon>
          </button>
          {YEARS.map((y) => (
            <button
              key={y}
              className={`oa-year-btn${y === selectedYear ? " active" : ""}`}
              role="tab"
              aria-selected={y === selectedYear}
              type="button"
            >
              <span className="latin">{y}</span>
            </button>
          ))}
          <button
            className="oa-year-btn"
            aria-label={t("marketing.nextYear")}
            role="tab"
            aria-selected={false}
            type="button"
            disabled
          >
            <Icon>{ICONS.nextYear}</Icon>
          </button>
        </div>
      </div>

      {/* ── Hero summary ───────────────────────────────────────────── */}
      <section className="oa-hero-summary" aria-label={t("marketing.pageLabel")}>
        {/* Main hero tile — aggregate annual totals.
            TODO(backend): GET /marketing-channels does not return year-scoped
            aggregate counts (total_acquired, annual_goal, monthly_acquired).
            Showing "—" per spec. */}
        <div className="oa-summary-main">
          <div className="sm-eyebrow">{t("marketing.kpi.annualTotal")}</div>
          <div className="sm-big">
            <span className="latin">{PLACEHOLDER}</span>
            <span className="ar-unit">{t("marketing.kpi.annualTotalUnit")}</span>
          </div>
          <div className="sm-sub">
            {t("marketing.kpi.annualGoal")}{" "}
            <span className="latin">{PLACEHOLDER}</span>{" "}
            {t("marketing.kpi.annualGoalUnit")}
            <span className="delta">
              {PLACEHOLDER} {t("marketing.kpi.thisMonth")}
            </span>
          </div>
          <div className="sm-progress">
            <div className="sm-track">
              {/* TODO(backend): progress % not available without aggregate endpoint */}
              <div className="sm-fill" style={{ width: "0%" }} />
            </div>
            <div className="sm-progress-meta">
              <span>
                {PLACEHOLDER} {t("marketing.kpi.pctOfGoal")}
              </span>
              <span>
                {PLACEHOLDER} {t("marketing.kpi.monthsRemaining")}
              </span>
            </div>
          </div>
        </div>

        {/* 6 KPI tiles — all TODO(backend) sourced */}
        <div className="oa-summary-grid">
          {/* Tile 1: Active channels — sourced from query */}
          <div className="oa-summary-tile">
            <div className="lbl">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />
                <circle cx="12" cy="14" r="2" />
              </svg>
              {t("marketing.kpi.activeChannels")}
            </div>
            <div className="val">
              <span className="latin">
                {channelsQuery.isLoading ? PLACEHOLDER : fmt.int(activeChannels.length)}
              </span>
              <span className="unit">{t("marketing.kpi.activeChannelsUnit")}</span>
            </div>
            <div className="sub">
              {t("common.total") ?? "من"}{" "}
              <span className="latin">{channelsQuery.isLoading ? PLACEHOLDER : fmt.int(total)}</span>{" "}
              {t("marketing.kpi.activeChannelsUnit")}
            </div>
          </div>

          {/* Tile 2: Orphans assigned — orphan_count sum from API */}
          <div className="oa-summary-tile">
            <div className="lbl">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="7" r="4" />
                <path d="M5 21v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
              </svg>
              {t("marketing.kpi.orphansAssigned")}
            </div>
            <div className="val">
              <span className="latin">
                {channelsQuery.isLoading
                  ? PLACEHOLDER
                  : fmt.int(channels.reduce((s, c) => s + c.orphan_count, 0))}
              </span>
            </div>
            {/* TODO(backend): no "waiting for sponsor" count in /marketing-channels */}
            <div className="sub">
              {PLACEHOLDER} {t("marketing.kpi.waitingForSponsor")}
            </div>
          </div>

          {/* Tile 3: Conversion rate
              TODO(backend): no conversion_rate field in /marketing-channels */}
          <div className="oa-summary-tile">
            <div className="lbl">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
              {t("marketing.kpi.conversionRate")}
            </div>
            <div className="val">
              <span className="latin">{PLACEHOLDER}</span>
              <span className="unit">%</span>
            </div>
            <div className="sub">{t("marketing.kpi.conversionSub")}</div>
            <div className="spark" aria-hidden="true">
              {[30, 42, 38, 55, 50, 62, 70, 65, 82].map((h, i) => (
                <span
                  key={i}
                  className={`b${i === 8 ? " now" : ""}`}
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>

          {/* Tile 4: Avg sponsorship duration
              TODO(backend): no avg_duration_months in /marketing-channels */}
          <div className="oa-summary-tile">
            <div className="lbl">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              {t("marketing.kpi.avgSponsorDuration")}
            </div>
            <div className="val">
              <span className="latin">{PLACEHOLDER}</span>
              <span className="unit">{t("marketing.kpi.avgSponsorDurationUnit")}</span>
            </div>
            {/* TODO(backend): annual_retention_rate not in /marketing-channels */}
            <div className="sub">
              {t("marketing.kpi.yearRetention")}{" "}
              <span className="latin">{PLACEHOLDER}</span>%
            </div>
          </div>

          {/* Tile 5: Avg time to sponsor
              TODO(backend): no avg_minutes_to_sponsor in /marketing-channels */}
          <div className="oa-summary-tile">
            <div className="lbl">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("marketing.kpi.avgTimeToSponsor")}
            </div>
            <div className="val">
              <span className="latin">{PLACEHOLDER}</span>
              <span className="unit">{t("marketing.kpi.avgTimeToSponsorUnit")}</span>
            </div>
            <div className="sub">{t("marketing.kpi.fromOpenToPayment")}</div>
          </div>

          {/* Tile 6: Expired orphan slots
              TODO(backend): no expired_slot_count in /marketing-channels */}
          <div className="oa-summary-tile">
            <div className="lbl">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              {t("marketing.kpi.expiredOrphans")}
            </div>
            <div className="val">
              <span className="latin">{PLACEHOLDER}</span>
            </div>
            <div className="sub">
              <span className="warn">{t("marketing.kpi.expiredOrphansSub")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <section className="oa-channels-toolbar" aria-label={t("marketing.filterStatus")}>
        <div className="oa-search-input">
          <Icon>{ICONS.search}</Icon>
          <input
            type="search"
            placeholder={t("marketing.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("marketing.searchPlaceholder")}
          />
        </div>
        <button type="button" className="oa-filter-pill">
          <Icon>{ICONS.check}</Icon>
          {t("marketing.filterStatus")}
          <Icon>{ICONS.chevronDown}</Icon>
        </button>
        <button type="button" className="oa-filter-pill">
          <Icon>{ICONS.sliders}</Icon>
          {t("marketing.filterSort")}
          <Icon>{ICONS.chevronDown}</Icon>
        </button>
        <div className="oa-view-toggle" role="group" aria-label={t("marketing.viewCards")}>
          <button
            type="button"
            className={`oa-view-btn${view === "cards" ? " active" : ""}`}
            onClick={() => setView("cards")}
            aria-pressed={view === "cards"}
          >
            <Icon>{ICONS.grid}</Icon>
            {t("marketing.viewCards")}
          </button>
          <button
            type="button"
            className={`oa-view-btn${view === "table" ? " active" : ""}`}
            onClick={() => setView("table")}
            aria-pressed={view === "table"}
          >
            <Icon>{ICONS.list}</Icon>
            {t("marketing.viewTable")}
          </button>
        </div>
      </section>

      {/* ── Loading / error states ─────────────────────────────────── */}
      {channelsQuery.isLoading && (
        <div className="oa-channels-loading">{t("marketing.loading")}</div>
      )}
      {channelsQuery.isError && (
        <div className="oa-channels-error" role="alert">
          {t("marketing.loadError")}
        </div>
      )}

      {/* ── Active channels ────────────────────────────────────────── */}
      {!channelsQuery.isLoading && !channelsQuery.isError && (
        <>
          <h2 className="oa-section-h">
            {t("marketing.activeChannels")}
            <span className="count">
              <span className="latin">{fmt.int(filteredActive.length)}</span>
            </span>
          </h2>

          {view === "cards" ? (
            <section
              className="oa-channels-grid"
              aria-label={t("marketing.activeChannels")}
            >
              {filteredActive.map((ch, idx) => (
                <ChannelCard key={ch.id} channel={ch} isTopPerformer={idx === 0} fmt={fmt} />
              ))}

              {/* "Create new" slot card */}
              <button
                type="button"
                className="oa-channel-card create"
                onClick={() => setShowModal(true)}
                aria-label={t("marketing.createNew")}
              >
                <div className="oa-create-icon" aria-hidden="true">
                  <Icon className="oa-icon oa-icon-md">{ICONS.plus}</Icon>
                </div>
                <div className="oa-create-title">{t("marketing.createNew")}</div>
                <div className="oa-create-desc">{t("marketing.createNewDesc")}</div>
              </button>
            </section>
          ) : (
            <ChannelTable channels={filteredActive} fmt={fmt} />
          )}

          {/* ── Paused channels ─────────────────────────────────── */}
          {filteredPaused.length > 0 && (
            <>
              <h2 className="oa-section-h">
                {t("marketing.pausedChannels")}
                <span className="count">
                  <span className="latin">{fmt.int(filteredPaused.length)}</span>
                </span>
              </h2>
              {view === "cards" ? (
                <section
                  className="oa-channels-grid"
                  aria-label={t("marketing.pausedChannels")}
                >
                  {filteredPaused.map((ch) => (
                    <ChannelCard key={ch.id} channel={ch} isTopPerformer={false} fmt={fmt} />
                  ))}
                </section>
              ) : (
                <ChannelTable channels={filteredPaused} fmt={fmt} />
              )}
            </>
          )}

          {/* Empty state when no channels exist */}
          {filteredActive.length === 0 && filteredPaused.length === 0 && (
            <div className="oa-channels-empty">{t("marketing.empty")}</div>
          )}
        </>
      )}

      {/* ── Add channel modal ──────────────────────────────────────── */}
      {showModal && (
        <div
          className="oa-scrim"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            className="oa-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="oa-modal-title"
          >
            <header className="oa-modal-head">
              <div>
                <h2 id="oa-modal-title">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />
                    <circle cx="12" cy="14" r="2" />
                  </svg>
                  {t("marketing.modal.title")}
                </h2>
                <p>{t("marketing.modal.subtitle")}</p>
              </div>
              <button
                type="button"
                className="oa-modal-close"
                aria-label={t("marketing.modal.close")}
                onClick={() => setShowModal(false)}
              >
                <Icon>{ICONS.x}</Icon>
              </button>
            </header>

            <div className="oa-modal-body">
              <div className="oa-form-group">
                <label htmlFor="oa-ch-name" className="oa-form-label">
                  {t("marketing.modal.channelName")}
                </label>
                <input
                  id="oa-ch-name"
                  type="text"
                  className="oa-form-input"
                  placeholder={t("marketing.modal.channelNamePlaceholder")}
                />
                <div className="oa-form-help">{t("marketing.modal.channelNameHelp")}</div>
              </div>

              <div className="oa-form-group">
                <div className="oa-form-label">{t("marketing.modal.channelType")}</div>
                <div className="oa-type-grid">
                  {(
                    [
                      {
                        key: "email",
                        bg: "var(--info-50)",
                        fg: "var(--info-700)",
                        icon: ICONS.mail,
                        desc: t("marketing.types.email"),
                      },
                      {
                        key: "social_media",
                        bg: "var(--pink-50)",
                        fg: "var(--pink-700)",
                        icon: ICONS.instagram,
                        desc: t("marketing.types.social_media"),
                      },
                      {
                        key: "search",
                        bg: "var(--orange-50)",
                        fg: "var(--orange-700)",
                        icon: ICONS.searchIcon,
                        desc: t("marketing.types.search"),
                      },
                      {
                        key: "events",
                        bg: "var(--teal-50)",
                        fg: "var(--teal-700)",
                        icon: ICONS.events,
                        desc: t("marketing.types.events"),
                      },
                    ] as Array<{
                      key: string;
                      bg: string;
                      fg: string;
                      icon: ReactNode;
                      desc: string;
                    }>
                  ).map(({ key, bg, fg, icon, desc }) => (
                    <button
                      key={key}
                      type="button"
                      className={`oa-type-card${selectedType === key ? " selected" : ""}`}
                      onClick={() => _setSelectedType(key)}
                      aria-pressed={selectedType === key}
                    >
                      <div
                        className="oa-type-icon"
                        style={{ background: bg, color: fg }}
                        aria-hidden="true"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          {icon}
                        </svg>
                      </div>
                      <div>
                        <div className="oa-type-name">{desc}</div>
                        <div className="oa-type-desc">
                          {t(`marketing.types.${key}`, desc)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="oa-form-grid-2">
                <div className="oa-form-group">
                  <label htmlFor="oa-ch-goal" className="oa-form-label">
                    {t("marketing.modal.annualGoal")}{" "}
                    <span className="opt">{t("marketing.modal.annualGoalSuffix")}</span>
                  </label>
                  <input
                    id="oa-ch-goal"
                    type="number"
                    className="oa-form-input latin"
                    placeholder={t("marketing.modal.annualGoalPlaceholder")}
                    dir="ltr"
                  />
                </div>
                <div className="oa-form-group">
                  <label htmlFor="oa-ch-owner" className="oa-form-label">
                    {t("marketing.modal.owner")}
                  </label>
                  <select id="oa-ch-owner" className="oa-form-input">
                    <option value="">{t("marketing.modal.ownerPlaceholder")}</option>
                  </select>
                </div>
              </div>

              <div className="oa-form-group">
                <label htmlFor="oa-ch-utm" className="oa-form-label">
                  {t("marketing.modal.utmParams")}{" "}
                  <span className="opt">{t("marketing.modal.utmSuffix")}</span>
                </label>
                <input
                  id="oa-ch-utm"
                  type="text"
                  className="oa-form-input latin"
                  defaultValue="?utm_source=email&utm_medium=newsletter&utm_campaign="
                  dir="ltr"
                  readOnly
                  style={{ background: "var(--gray-50)", color: "var(--gray-600)" }}
                />
                <div className="oa-form-help">{t("marketing.modal.utmHelp")}</div>
              </div>
            </div>

            <footer className="oa-modal-foot">
              <button
                type="button"
                className="oa-btn-ghost"
                onClick={() => setShowModal(false)}
              >
                {t("marketing.modal.cancel")}
              </button>
              <button type="button" className="oa-btn-primary">
                <Icon>{ICONS.check}</Icon>
                {t("marketing.modal.create")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Channel Card
// ═══════════════════════════════════════════════════════════════════════
function ChannelCard({
  channel,
  isTopPerformer,
  fmt,
}: {
  channel: MarketingChannelRow;
  isTopPerformer: boolean;
  fmt: ReturnType<typeof useFormatters>;
}) {
  const { t } = useTranslation();
  const iconCls = channelIconClass(channel.channel_type);

  // Per-channel goal progress not available from the list endpoint.
  // TODO(backend): GET /marketing-channels/{id}/progress exists per
  // ChannelProgress schema, but loading per-card is expensive. A bulk
  // progress endpoint or progress fields in the list response are needed.
  const progressPct: number | null = null;

  // Derive fill class from pct
  function fillClass(pct: number | null): string {
    if (pct === null) return "";
    if (pct >= 90) return "good";
    if (pct >= 60) return "";
    if (pct >= 40) return "warn";
    return "danger";
  }

  return (
    <article
      className={`oa-channel-card${channel.is_active ? "" : " paused"}`}
      aria-label={channel.name}
    >
      {/* Top colour stripe */}
      <span className={`oa-channel-stripe ${iconCls}`} aria-hidden="true" />

      {/* Top-performer ribbon (only first active channel in the list) */}
      {isTopPerformer && channel.is_active && (
        <span className="oa-ribbon" aria-label={t("marketing.topPerformer")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {ICONS.star}
          </svg>
          {t("marketing.topPerformer")}
        </span>
      )}

      {/* Card header */}
      <header className="oa-channel-head">
        <div className={`oa-channel-icon ${iconCls}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {channelIconSvg(channel.channel_type)}
          </svg>
        </div>
        <div className="oa-channel-info">
          <div className="oa-channel-name">{channel.name}</div>
          <div className="oa-channel-meta">
            {/* Channel type badge */}
            <span>
              {t(`marketing.types.${channel.channel_type}`, channel.channel_type)}
            </span>
            {channel.referral_code && (
              <>
                <span className="dot-sep" aria-hidden="true">·</span>
                <code className="oa-referral-code" aria-label={t("marketing.referralCode")}>
                  {channel.referral_code}
                </code>
              </>
            )}
          </div>
        </div>
        <span
          className={`oa-channel-status ${channel.is_active ? "live" : "paused"}`}
          aria-label={
            channel.is_active
              ? t("marketing.statuses.active")
              : t("marketing.statuses.suspended")
          }
        >
          {channel.is_active
            ? t("marketing.statuses.active")
            : t("marketing.statuses.suspended")}
        </span>
      </header>

      {/* Card body */}
      <div className="oa-channel-body">
        {/* Goal progress block.
            TODO(backend): annual_goal_count, achieved_count, completion_percentage_count
            are in GET /marketing-channels/{id}/progress but not in the list
            response. Bulk embed needed. */}
        <div className="oa-goal-block">
          <div className="oa-goal-head">
            <div className="lbl">
              {channel.is_active
                ? t("marketing.card.annualGoal")
                : t("marketing.card.lastPerformance")}{" "}
              <strong>{t("marketing.card.newSponsors")}</strong>
            </div>
            <div className={`pct${progressPct !== null && progressPct < 60 ? " warn" : ""}`}>
              <span className="latin">
                {progressPct !== null ? progressPct : PLACEHOLDER}
              </span>
              {progressPct !== null && "%"}
              <span className="small"> {t("marketing.card.ofGoal")}</span>
            </div>
          </div>
          <div className="oa-goal-track" aria-hidden="true">
            <div
              className={`oa-goal-fill ${fillClass(progressPct)}`}
              style={{ width: progressPct !== null ? `${Math.min(progressPct, 100)}%` : "0%" }}
            />
          </div>
          <div className="oa-goal-numbers">
            <span>
              <strong className="latin">{PLACEHOLDER}</strong> / {PLACEHOLDER}{" "}
              {t("marketing.kpi.annualTotalUnit")}
            </span>
            <span>
              {/* TODO(backend): months_remaining not in channel list */}
              {PLACEHOLDER} {t("marketing.card.remainingMonths")}
            </span>
          </div>
        </div>

        {/* KPI mini-grid */}
        <div className="oa-kpi-grid">
          {/* KPI 1: Conversion rate
              TODO(backend): conversion_rate not in /marketing-channels list */}
          <div className="oa-kpi-tile">
            <div className="pl">{t("marketing.card.conversionRate")}</div>
            <div className="pv">
              <span className="latin">{PLACEHOLDER}</span>
            </div>
          </div>

          {/* KPI 2: Orphans assigned — from API */}
          <div className="oa-kpi-tile">
            <div className="pl">{t("marketing.card.orphansAssigned")}</div>
            <div className="pv">
              <span className="latin">{fmt.int(channel.orphan_count)}</span>
            </div>
          </div>

          {/* KPI 3: Referral code or annual retention
              TODO(backend): annual_retention_rate not in channel list */}
          <div className="oa-kpi-tile">
            <div className="pl">{t("marketing.card.annualRetention")}</div>
            <div className="pv">
              <span className="latin">{PLACEHOLDER}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Card footer */}
      <footer className="oa-channel-foot">
        <span className="last">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {ICONS.clock}
          </svg>
          {/* TODO(backend): last_activity_at not in /marketing-channels */}
          {PLACEHOLDER}
        </span>
        <div className="oa-foot-actions">
          {!channel.is_active && (
            <button type="button" className="oa-foot-btn muted">
              {t("marketing.archiveBtn")}
            </button>
          )}
          <button type="button" className="oa-foot-btn">
            {channel.is_active
              ? t("marketing.openChannel")
              : t("marketing.reactivate")}
            <Icon>{ICONS.chevronStart}</Icon>
          </button>
        </div>
      </footer>
    </article>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Table view (list mode)
// ═══════════════════════════════════════════════════════════════════════
function ChannelTable({
  channels,
  fmt,
}: {
  channels: MarketingChannelRow[];
  fmt: ReturnType<typeof useFormatters>;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ overflowX: "auto", marginBottom: 24 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "white",
          border: "1px solid var(--gray-200)",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          fontSize: 13,
        }}
        aria-label={t("marketing.activeChannels")}
      >
        <thead>
          <tr
            style={{
              background: "var(--gray-50)",
              borderBottom: "1px solid var(--gray-200)",
              fontSize: 11,
              color: "var(--gray-500)",
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            <th style={{ padding: "10px 18px", textAlign: "start" }}>
              {t("marketingChannels.name")}
            </th>
            <th style={{ padding: "10px 18px", textAlign: "start" }}>
              {t("marketingChannels.type")}
            </th>
            <th style={{ padding: "10px 18px", textAlign: "start" }}>
              {t("marketing.referralCode")}
            </th>
            <th style={{ padding: "10px 18px", textAlign: "start" }}>
              {t("marketing.orphanCount")}
            </th>
            <th style={{ padding: "10px 18px", textAlign: "start" }}>
              {t("marketingChannels.status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((ch) => (
            <tr
              key={ch.id}
              style={{ borderBottom: "1px solid var(--gray-100)" }}
            >
              <td style={{ padding: "10px 18px", fontWeight: 600, color: "var(--gray-900)" }}>
                {ch.name}
              </td>
              <td style={{ padding: "10px 18px", color: "var(--gray-600)" }}>
                {t(`marketing.types.${ch.channel_type}`, ch.channel_type)}
              </td>
              <td style={{ padding: "10px 18px" }}>
                {ch.referral_code ? (
                  <code className="oa-referral-code">{ch.referral_code}</code>
                ) : (
                  <span style={{ color: "var(--gray-400)" }}>{t("marketing.noReferralCode")}</span>
                )}
              </td>
              <td
                style={{
                  padding: "10px 18px",
                  fontFamily: "\"IBM Plex Sans\", sans-serif",
                  fontFeatureSettings: "\"tnum\" 1",
                }}
              >
                <span className="latin">{fmt.int(ch.orphan_count)}</span>
              </td>
              <td style={{ padding: "10px 18px" }}>
                <span
                  className={`oa-channel-status ${ch.is_active ? "live" : "paused"}`}
                >
                  {ch.is_active
                    ? t("marketing.statuses.active")
                    : t("marketing.statuses.suspended")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
