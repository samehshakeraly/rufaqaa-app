/**
 * OA-03 Partner Organisations — rebuilt to pixel-parity with mockup-oa03.html.
 *
 * Data wiring:
 *   GET /partners?search=&page=&page_size=  (via existing listPartners)
 *   Individual partner stats: GET /partners/:id/stats (via getPartnerStats)
 *
 * Preserved from original: react-query key shape, createPartner / archivePartner
 * mutations, role-gating.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { PartnerLogo } from "@/components/PartnerLogo";
import { useRole } from "@/hooks/useRole";
import {
  archivePartner,
  createPartner,
  listPartners,
  type Partner,
  type PartnerCreateInput,
} from "@/lib/partners";

import "./PartnersPage.css";

// ─────────────────────────────────────────────────────────────────
// React-query key — kept identical so cached data is shared.
// ─────────────────────────────────────────────────────────────────
const QK = ["partners", { includeInactive: true }] as const;

// ─────────────────────────────────────────────────────────────────
// Inline SVG icon helper (mirrors DashboardPage pattern)
// ─────────────────────────────────────────────────────────────────
function Icon({
  children,
  className = "oa-p-icon oa-p-icon-sm",
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

const ICONS = {
  partners: (
    <>
      <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  globe: (
    <>
      <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
      <path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  mapPin: (
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
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
  map: (
    <>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </>
  ),
  chevronStart: <polyline points="15 18 9 12 15 6" />,
  chevronDown: <polyline points="6 9 12 15 18 9" />,
  kebab: (
    <>
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </>
  ),
  star: <path d="M12 2l2.39 4.84 5.34.78-3.87 3.77.91 5.32L12 14.27l-4.77 2.51.91-5.32L4.27 7.62l5.34-.78z" />,
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
};

// ─────────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────────
type StatusKey = "active" | "pending" | "suspended";

function statusChipClass(status: string): StatusKey {
  if (status === "active") return "active";
  if (status === "suspended") return "suspended";
  return "pending"; // "archived" → treat as pending in chip; archived is filtered out
}

function cardVariant(status: string): string {
  if (status === "suspended") return "suspended";
  if (status !== "active") return "pending";
  return "";
}

// ─────────────────────────────────────────────────────────────────
// Status tab filter values
// ─────────────────────────────────────────────────────────────────
type TabFilter = "all" | "active" | "pending" | "suspended";

// ─────────────────────────────────────────────────────────────────
// Page size constant
// ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 9;

// ─────────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────────
export function PartnersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin } = useRole();

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "map">("grid");
  const [showForm, setShowForm] = useState(false);

  // ── Data fetch ──────────────────────────────────────────────────
  // The existing listPartners fetches all partners; we filter client-side
  // since the backend doesn't yet expose ?search or ?status params.
  // TODO(backend): pass search + status + page/page_size as query params
  //   once the API supports GET /partners?search=&status=&page=&page_size=
  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listPartners(true),
  });

  const archive = useMutation({
    mutationFn: (id: string) => archivePartner(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  // ── Client-side filtering ───────────────────────────────────────
  const allPartners = data?.items ?? [];

  const filtered = allPartners.filter((p) => {
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "active" && p.status === "active") ||
      (activeTab === "pending" && p.status !== "active" && p.status !== "suspended") ||
      (activeTab === "suspended" && p.status === "suspended");

    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name_ar.toLowerCase().includes(q) ||
      (p.name_en ?? "").toLowerCase().includes(q) ||
      p.country_code.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q);

    return matchesTab && matchesSearch;
  });

  // ── Pagination ──────────────────────────────────────────────────
  const totalFiltered = filtered.length;
  const totalPages = Math.ceil(totalFiltered / PAGE_SIZE);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, totalFiltered);
  const pageItems = filtered.slice(pageStart, pageEnd);

  // ── Stat counts (from full list, not filtered) ──────────────────
  // TODO(backend): stats/summary endpoint doesn't expose per-partner counts
  //   like active_count, pending_count, countries_count, total_orphan_count.
  //   Using derived counts from the partner list; orphan_count per partner
  //   is not in the Partner interface — showing "—" for orphan total.
  const totalCount = allPartners.length;
  const activeCount = allPartners.filter((p) => p.status === "active").length;
  const pendingCount = allPartners.filter(
    (p) => p.status !== "active" && p.status !== "suspended",
  ).length;
  const suspendedCount = allPartners.filter((p) => p.status === "suspended").length;
  const countryCount = new Set(allPartners.map((p) => p.country_code)).size;

  // Reset to page 1 when filter/search changes
  const handleTabChange = (tab: TabFilter) => {
    setActiveTab(tab);
    setPage(1);
  };
  const handleSearch = (q: string) => {
    setSearch(q);
    setPage(1);
  };

  return (
    <div className="oa-partners">
      {/* Single semantic h1 — visually hidden; visible title is h2 in topbar */}
      <h1 className="sr-only">{t("partners.title")}</h1>

      <div className="oa-partners-page">

        {/* ── Topbar ─────────────────────────────────────────────── */}
        <div className="oa-partners-topbar">
          <div className="oa-partners-topbar-title">
            <h2>{t("partners.title")}</h2>
            <p>{t("partners.subtitle")}</p>
          </div>
          <div className="oa-partners-topbar-actions">
            {/* TODO(backend): CSV export endpoint not yet available */}
            <button
              type="button"
              className="oa-btn-secondary"
              aria-label={t("partners.exportCsv")}
              disabled
              title={t("partners.exportComingSoon")}
            >
              <Icon>{ICONS.download}</Icon>
              {t("partners.export")}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="oa-btn-primary"
                onClick={() => setShowForm((v) => !v)}
              >
                <Icon>{ICONS.plus}</Icon>
                {t("partners.addNew")}
              </button>
            )}
          </div>
        </div>

        {/* ── Add partner form (inline, collapsible) ─────────────── */}
        {showForm && (
          <NewPartnerForm
            onCreated={async () => {
              await qc.invalidateQueries({ queryKey: QK });
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        )}

        {/* ── Error ──────────────────────────────────────────────── */}
        {error && (
          <div className="oa-partners-error" role="alert">
            {t("common.loadError")}
          </div>
        )}

        {/* ── Stat strip ─────────────────────────────────────────── */}
        <section
          className="oa-partners-stat-strip"
          aria-label={t("partners.statsSummary")}
        >
          {/* Total partners */}
          <StatCard
            icon={ICONS.partners}
            iconClass=""
            label={t("partners.stats.total")}
            value={isLoading ? "—" : String(totalCount)}
            delta={null}
          />
          {/* Active */}
          <StatCard
            icon={ICONS.check}
            iconClass="green"
            label={t("partners.stats.active")}
            value={isLoading ? "—" : String(activeCount)}
            delta={null}
          />
          {/* Under review */}
          <StatCard
            icon={ICONS.clock}
            iconClass="gold"
            label={t("partners.stats.underReview")}
            value={isLoading ? "—" : String(pendingCount)}
            delta={null}
          />
          {/* Orphans under care — TODO(backend): orphan_count not in Partner
              interface; would need GET /stats/summary or partner list
              enriched with orphan_count. */}
          <StatCard
            icon={ICONS.users}
            iconClass="teal"
            label={t("partners.stats.orphans")}
            value="—"
            delta={null}
          />
          {/* Countries */}
          <StatCard
            icon={ICONS.globe}
            iconClass="purple"
            label={t("partners.stats.countries")}
            value={isLoading ? "—" : String(countryCount)}
            delta={null}
          />
        </section>

        {/* ── Status tabs ────────────────────────────────────────── */}
        <div
          className="oa-partners-status-tabs"
          role="tablist"
          aria-label={t("partners.filterByStatus")}
        >
          <TabButton
            id="tab-all"
            active={activeTab === "all"}
            count={isLoading ? null : totalCount}
            countClass=""
            onClick={() => handleTabChange("all")}
          >
            {t("partners.tabs.all")}
          </TabButton>
          <TabButton
            id="tab-active"
            active={activeTab === "active"}
            count={isLoading ? null : activeCount}
            countClass=""
            onClick={() => handleTabChange("active")}
          >
            {t("partners.tabs.active")}
          </TabButton>
          <TabButton
            id="tab-pending"
            active={activeTab === "pending"}
            count={isLoading ? null : pendingCount}
            countClass={pendingCount > 0 ? "warn" : ""}
            onClick={() => handleTabChange("pending")}
          >
            {t("partners.tabs.underReview")}
          </TabButton>
          <TabButton
            id="tab-suspended"
            active={activeTab === "suspended"}
            count={isLoading ? null : suspendedCount}
            countClass=""
            onClick={() => handleTabChange("suspended")}
          >
            {t("partners.tabs.suspended")}
          </TabButton>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────── */}
        <section
          className="oa-partners-toolbar"
          aria-label={t("partners.toolbarLabel")}
        >
          {/* Search */}
          <label className="oa-partners-search" aria-label={t("partners.searchLabel")}>
            <Icon>{ICONS.search}</Icon>
            <input
              type="search"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder={t("partners.searchPlaceholder")}
              aria-label={t("partners.searchLabel")}
            />
          </label>

          {/* Country filter — TODO(backend): no /partners?country= filter API yet */}
          <button
            type="button"
            className="oa-partners-filter-pill"
            aria-label={t("partners.filterCountry")}
            disabled
            title={t("partners.filterComingSoon")}
          >
            <Icon>{ICONS.mapPin}</Icon>
            {t("partners.countryAll")}
            <Icon>{ICONS.chevronDown}</Icon>
          </button>

          {/* Sort — TODO(backend): no sort param in /partners API yet */}
          <button
            type="button"
            className="oa-partners-filter-pill"
            aria-label={t("partners.sortLabel")}
            disabled
            title={t("partners.filterComingSoon")}
          >
            <Icon>{ICONS.sliders}</Icon>
            {t("partners.sortOrphans")}
            <Icon>{ICONS.chevronDown}</Icon>
          </button>

          {/* View toggle */}
          <div
            className="oa-partners-view-toggle"
            role="tablist"
            aria-label={t("partners.viewToggle")}
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "grid"}
              aria-label={t("partners.viewGrid")}
              className={`oa-partners-view-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => setViewMode("grid")}
            >
              <Icon>{ICONS.grid}</Icon>
              {t("partners.viewGrid")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "list"}
              aria-label={t("partners.viewList")}
              className={`oa-partners-view-btn${viewMode === "list" ? " active" : ""}`}
              onClick={() => setViewMode("list")}
            >
              <Icon>{ICONS.list}</Icon>
              {t("partners.viewList")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "map"}
              aria-label={t("partners.viewMap")}
              className={`oa-partners-view-btn${viewMode === "map" ? " active" : ""}`}
              onClick={() => setViewMode("map")}
            >
              <Icon>{ICONS.map}</Icon>
              {t("partners.viewMap")}
            </button>
          </div>
        </section>

        {/* ── Loading skeleton ───────────────────────────────────── */}
        {isLoading && (
          <div className="oa-partners-skeleton-grid" aria-busy="true" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="oa-partners-skeleton-card">
                <div
                  className="oa-skeleton-line"
                  style={{ blockSize: 52, inlineSize: 52, borderRadius: 12 }}
                />
                <div className="oa-skeleton-line" style={{ blockSize: 18, inlineSize: "70%" }} />
                <div className="oa-skeleton-line" style={{ blockSize: 14, inlineSize: "50%" }} />
                <div className="oa-skeleton-line" style={{ blockSize: 60, inlineSize: "100%" }} />
              </div>
            ))}
          </div>
        )}

        {/* ── Partner cards grid ─────────────────────────────────── */}
        {!isLoading && !error && (
          <>
            {pageItems.length === 0 ? (
              <div className="oa-partners-empty">
                <div className="e-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4" />
                  </svg>
                </div>
                <h4>{t("partners.emptyTitle")}</h4>
                <p>{t("partners.emptyBody")}</p>
              </div>
            ) : (
              <section
                className="oa-partners-grid"
                aria-label={t("partners.gridLabel")}
              >
                {pageItems.map((partner) => (
                  <PartnerCard
                    key={partner.id}
                    partner={partner}
                    isAdmin={isAdmin}
                    onArchive={() => archive.mutate(partner.id)}
                    archivePending={archive.isPending}
                  />
                ))}
              </section>
            )}

            {/* ── Pagination ─────────────────────────────────────── */}
            {totalFiltered > PAGE_SIZE && (
              <div className="oa-partners-pagination" aria-label={t("partners.paginationLabel")}>
                <span>
                  {t("partners.showing")}{" "}
                  <span className="info">{pageStart + 1}–{pageEnd}</span>{" "}
                  {t("partners.of")}{" "}
                  <span className="info">{totalFiltered}</span>{" "}
                  {t("partners.entities")}
                </span>
                <div className="oa-partners-pagination-btns">
                  <button
                    type="button"
                    className="oa-btn-secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label={t("partners.pagePrev")}
                  >
                    {t("partners.pagePrev")}
                  </button>
                  <button
                    type="button"
                    className="oa-btn-secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label={t("partners.pageNext")}
                  >
                    {t("partners.pageNext")}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Stat card (strip)
// ─────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  iconClass,
  label,
  value,
  delta,
}: {
  icon: ReactNode;
  iconClass: string;
  label: string;
  value: string;
  delta: { dir: "up" | "down"; val: string } | null;
}) {
  return (
    <article className="oa-partners-stat">
      <div className={`oa-partners-stat-icon${iconClass ? ` ${iconClass}` : ""}`}>
        <Icon>{icon}</Icon>
      </div>
      <div className="oa-partners-stat-text">
        <div className="lbl">{label}</div>
        <div className="val">
          <span className="latin">{value}</span>
          {delta && (
            <span className={`delta ${delta.dir}`}>
              {delta.dir === "up" ? "+" : "−"}
              <span className="latin">{delta.val}</span>
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────
// Status tab button
// ─────────────────────────────────────────────────────────────────
function TabButton({
  id,
  active,
  count,
  countClass,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  count: number | null;
  countClass: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      className={`oa-partners-status-tab${active ? " active" : ""}`}
      onClick={onClick}
    >
      {children}
      {count !== null && (
        <span className={`count-pill${countClass ? ` ${countClass}` : ""}`}>
          <span className="latin">{count}</span>
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Partner card
// ─────────────────────────────────────────────────────────────────
function PartnerCard({
  partner,
  isAdmin,
  onArchive,
  archivePending,
}: {
  partner: Partner;
  isAdmin: boolean;
  onArchive: () => void;
  archivePending: boolean;
}) {
  const { t, i18n } = useTranslation();

  const displayName =
    i18n.language === "ar" ? partner.name_ar : (partner.name_en ?? partner.name_ar);
  const variant = cardVariant(partner.status);
  const chipClass = statusChipClass(partner.status);

  // Status chip label
  const statusLabel =
    partner.status === "active"
      ? t("partners.statuses.active")
      : partner.status === "suspended"
      ? t("partners.statuses.suspended")
      : t("partners.statuses.pending");

  // TODO(backend): orphan_count, sponsored_count, staff_count are not in the
  //   Partner interface. The GET /partners/:id/stats endpoint exists (getPartnerStats)
  //   but fetching it per-card would cause N+1 requests. The stat strip inside
  //   each card shows "—" until the API either enriches the partner list response
  //   or a dedicated list-stats endpoint is available.
  // TODO(backend): compliance_pct (health bar) is not exposed by any current endpoint.
  // TODO(backend): is_verified badge requires a `is_verified` field on Partner.
  // TODO(backend): alerts (overdue transfers, late reports) have no per-partner
  //   aggregation endpoint.

  const isPending = partner.status !== "active" && partner.status !== "suspended";

  return (
    <article
      className={`oa-partner-card${variant ? ` ${variant}` : ""}`}
      tabIndex={0}
      aria-label={displayName}
    >
      {/* ── Card head ─────────────────────────────────────────── */}
      <header className="oa-partner-head">
        <PartnerLogo name={partner.name_ar} logoUrl={null} size={52} />

        <div className="oa-partner-info">
          <div className="oa-partner-name">
            {displayName}
            {/* TODO(backend): is_verified flag not in Partner interface */}
          </div>
          <div className="oa-partner-meta">
            <span aria-label={t("partners.country")}>{partner.country_code}</span>
            <span className="dot-sep" aria-hidden="true">·</span>
            <span className="oa-partner-slug">{partner.code}</span>
          </div>
        </div>

        <span className={`oa-status-chip ${chipClass}`} aria-label={statusLabel}>
          {statusLabel}
        </span>

        <button
          type="button"
          className="oa-partner-kebab"
          aria-label={t("partners.moreOptions", { name: displayName })}
          aria-haspopup="menu"
          disabled={!isAdmin}
        >
          <Icon>{ICONS.kebab}</Icon>
        </button>
      </header>

      {/* ── Stat row ──────────────────────────────────────────── */}
      <div className="oa-partner-stats" aria-label={t("partners.statsLabel")}>
        <div className="oa-partner-stat">
          <div className="pl">
            {isPending ? t("partners.stat.potentialOrphans") : t("partners.stat.orphans")}
          </div>
          <div className="pv">
            <span className="latin">—</span>
          </div>
        </div>
        <div className="oa-partner-stat">
          <div className="pl">
            {isPending ? t("partners.stat.documents") : t("partners.stat.sponsored")}
          </div>
          <div className="pv">
            <span className="latin">—</span>
          </div>
        </div>
        <div className="oa-partner-stat">
          <div className="pl">
            {isPending ? t("partners.stat.reviewers") : t("partners.stat.staff")}
          </div>
          <div className="pv">
            <span className="latin">—</span>
          </div>
        </div>
      </div>

      {/* ── Card footer ───────────────────────────────────────── */}
      <footer className="oa-partner-foot">
        <div className="oa-partner-health">
          <span>
            {isPending ? t("partners.stat.fileCompletion") : t("partners.stat.compliance")}
          </span>
          {/* TODO(backend): compliance_pct not available — bar hidden */}
          <span className="oa-health-bar" aria-hidden="true">
            <span className="oa-health-bar-fill" style={{ inlineSize: "0%" }} />
          </span>
          <span className="oa-health-pct">—</span>
        </div>

        <button
          type="button"
          className="oa-partner-open-btn"
          aria-label={
            isPending
              ? t("partners.action.review", { name: displayName })
              : t("partners.action.open", { name: displayName })
          }
          onClick={() => {
            // TODO(backend): navigate to partner detail page (OA-04) once built
          }}
        >
          {isPending ? t("partners.action.review") : t("partners.action.open")}
          <Icon>{ICONS.chevronStart}</Icon>
        </button>
      </footer>

      {/* Archive action (admin only, active partners) */}
      {isAdmin && partner.status === "active" && (
        <div style={{ paddingBlockStart: 4 }}>
          <button
            type="button"
            className="oa-btn-ghost"
            onClick={onArchive}
            disabled={archivePending}
            aria-label={t("partners.archive")}
            style={{ fontSize: 11, color: "var(--danger-600)" }}
          >
            {t("partners.archive")}
          </button>
        </div>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────
// New partner inline form (preserved from original, restyled)
// ─────────────────────────────────────────────────────────────────
function NewPartnerForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState<PartnerCreateInput>({
    name_ar: "",
    name_en: "",
    country_code: "KW",
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => createPartner(v),
    onSuccess: () => {
      setV({ name_ar: "", name_en: "", country_code: "KW" });
      onCreated();
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        if (!v.name_ar.trim() || v.country_code.length !== 2) return;
        mut.mutate();
      }}
      style={{
        background: "white",
        border: "1px solid var(--gray-200)",
        borderRadius: "var(--radius-xl)",
        padding: "18px",
        marginBlockEnd: "18px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
      aria-label={t("partners.addNew")}
    >
      <div
        style={{
          display: "grid",
          gap: "12px",
          gridTemplateColumns: "1fr 1fr 1fr",
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gray-800)" }}>
            {t("partners.nameAr")}
          </span>
          <input
            style={{
              padding: "9px 12px",
              border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-md)",
              fontSize: 13.5,
              fontFamily: "inherit",
              color: "var(--gray-900)",
              background: "white",
              outline: "none",
            }}
            value={v.name_ar}
            onChange={(e) => setV({ ...v, name_ar: e.target.value })}
            required
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gray-800)" }}>
            {t("partners.nameEn")}
          </span>
          <input
            dir="ltr"
            style={{
              padding: "9px 12px",
              border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-md)",
              fontSize: 13.5,
              fontFamily: "'IBM Plex Sans', sans-serif",
              color: "var(--gray-900)",
              background: "white",
              outline: "none",
            }}
            value={v.name_en ?? ""}
            onChange={(e) => setV({ ...v, name_en: e.target.value })}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--gray-800)" }}>
            {t("partners.country")}
          </span>
          <input
            dir="ltr"
            maxLength={2}
            style={{
              padding: "9px 12px",
              border: "1px solid var(--gray-200)",
              borderRadius: "var(--radius-md)",
              fontSize: 13.5,
              fontFamily: "'IBM Plex Mono', monospace",
              color: "var(--gray-900)",
              background: "white",
              outline: "none",
              textTransform: "uppercase",
            }}
            value={v.country_code}
            onChange={(e) => setV({ ...v, country_code: e.target.value.toUpperCase() })}
            required
          />
        </label>
      </div>

      {serverError && (
        <div className="oa-partners-error" role="alert">
          {serverError}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="oa-btn-ghost" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="oa-btn-primary" disabled={mut.isPending}>
          {mut.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}
