import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  activatePlatformOrganization,
  createPlatformOrganization,
  DEPLOYMENT_MODES,
  ORG_STATUSES,
  ORG_TYPES,
  suspendPlatformOrganization,
  updatePlatformOrganization,
  type DeploymentMode,
  type OrgStatus,
  type OrgType,
  type PlatformOrgSummary,
  listPlatformOrganizations,
} from "@/lib/platform";
import { toast } from "@/store/toasts";

import "./PlatformOrganizationsPage.css";

/**
 * SA-02 — Organizations Management.
 *
 * Pixel-parity port of docs/design/screens/super-admin/SA-02-Organizations.html.
 * The app-shell chrome is provided by PlatformLayout; this renders the
 * content area only. All cross-org reads/writes go through the existing
 * super-admin-gated `/platform/*` endpoints.
 *
 * Inert / not-yet-sourced (TODO(backend)):
 *   - Export, advanced filter / columns / sort toolbar buttons
 *   - "Monthly donations" column (no per-org donations field) → donors used
 */

function Icon({
  children,
  className = "sa-icon sa-icon-sm",
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
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>
  ),
  filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
  columns: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  sort: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  edit: (
    <>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="10" y1="9" x2="10" y2="15" />
      <line x1="14" y1="9" x2="14" y2="15" />
    </>
  ),
  play: <polyline points="20 6 9 17 4 12" />,
  chevronStart: <polyline points="15 18 9 12 15 6" />,
  chevronEnd: <polyline points="9 18 15 12 9 6" />,
};

// All statuses plus the synthetic "all" tab.
const TABS = ["all", ...ORG_STATUSES] as const;
type Tab = (typeof TABS)[number];

// ISO-3166 alpha-2 → regional-indicator flag emoji (derived from the
// stored country_code; no external data).
function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0] ?? "") + (parts[1]![0] ?? "");
  return name.slice(0, 2);
}

export function PlatformOrganizationsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isAr = i18n.language.startsWith("ar");

  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<PlatformOrgSummary | null>(null);
  const [suspending, setSuspending] = useState<PlatformOrgSummary | null>(null);
  const [activating, setActivating] = useState<PlatformOrgSummary | null>(null);

  const params = { ...(search.trim() ? { search: search.trim() } : {}) };

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform", "organizations", params],
    queryFn: () => listPlatformOrganizations(params),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["platform"], exact: false });

  const nfmt = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const dfmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  // Counts per tab — derived from the search-scoped result set so the chips
  // always reflect what the table can show.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.length ?? 0 };
    for (const s of ORG_STATUSES) c[s] = 0;
    for (const org of data ?? []) c[org.status] = (c[org.status] ?? 0) + 1;
    return c;
  }, [data]);

  const rows = useMemo(
    () => (data ?? []).filter((o) => tab === "all" || o.status === tab),
    [data, tab],
  );

  const activeCount = counts.active ?? 0;
  const pendingCount = counts.pending_approval ?? 0;
  const suspendedCount = counts.suspended ?? 0;

  return (
    <div className="sa-orgs">
      <h1 className="sr-only">{t("platform.orgs.title")}</h1>

      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <div className="sa-topbar">
        <div className="sa-topbar-title">
          <h2>{t("platform.orgs.title")}</h2>
          <p>
            {t("platform.orgs.summaryLine", {
              total: counts.all,
              active: activeCount,
              pending: pendingCount,
              suspended: suspendedCount,
            })}
          </p>
        </div>
        <div className="sa-topbar-actions">
          {/* TODO(backend): no organizations export endpoint. */}
          <button type="button" className="sa-btn sa-btn-secondary" disabled aria-disabled="true">
            <Icon>{ICONS.download}</Icon>
            {t("platform.orgs.export")}
          </button>
          <button type="button" className="sa-btn sa-btn-primary" onClick={() => setShowCreate(true)}>
            <Icon>{ICONS.plus}</Icon>
            {t("platform.orgs.add")}
          </button>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <div className="sa-tabs" role="tablist" aria-label={t("platform.orgs.filters.status")}>
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            role="tab"
            aria-selected={tab === tb}
            className={`sa-tab${tab === tb ? " active" : ""}`}
            onClick={() => setTab(tb)}
          >
            {tb === "all" ? t("platform.orgs.tabs.all") : t(`platform.orgStatus.${tb}`, tb)}
            <span className="count latin">{nfmt.format(counts[tb] ?? 0)}</span>
          </button>
        ))}
      </div>

      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="sa-toolbar">
        <div className="sa-search">
          <Icon>{ICONS.search}</Icon>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("platform.orgs.searchPlaceholder")}
            aria-label={t("platform.orgs.filters.search")}
          />
        </div>
        {/* TODO(backend): advanced filter / columns / sort have no API source. */}
        <button type="button" className="sa-filter-btn" disabled aria-disabled="true">
          <Icon>{ICONS.filter}</Icon>
          {t("platform.orgs.toolbar.filter")}
        </button>
        <button type="button" className="sa-filter-btn" disabled aria-disabled="true">
          <Icon>{ICONS.sort}</Icon>
          {t("platform.orgs.toolbar.sort")}
        </button>
      </div>

      {/* ── Table ──────────────────────────────────────────────────── */}
      {isLoading && <div className="sa-state">{t("common.loading")}</div>}
      {error && <div className="sa-state error">{t("common.loadError")}</div>}
      {data && rows.length === 0 && <div className="sa-state">{t("common.empty")}</div>}

      {data && rows.length > 0 && (
        <div className="sa-table-wrap">
          <div className="sa-table-scroll">
            <table className="sa-table">
              <caption>{t("platform.orgs.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("platform.orgs.cols.organization")}</th>
                  <th scope="col">{t("platform.orgs.cols.country")}</th>
                  <th scope="col">{t("platform.orgs.cols.plan")}</th>
                  <th scope="col">{t("platform.orgs.cols.status")}</th>
                  <th scope="col">{t("platform.orgs.cols.orphans")}</th>
                  <th scope="col">{t("platform.orgs.cols.donors")}</th>
                  <th scope="col">{t("platform.orgs.cols.createdAt")}</th>
                  <th scope="col" className="sa-th-end">
                    {t("platform.orgs.cols.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((org) => {
                  const name = isAr ? org.name_ar : org.name_en;
                  return (
                    <tr key={org.id}>
                      <td>
                        <div className="sa-cell-org">
                          <div className="sa-cell-org-logo" aria-hidden="true">
                            {initials(name)}
                          </div>
                          <div>
                            <div className="sa-cell-org-name">{name}</div>
                            <div className="sa-cell-org-meta">
                              <span className="mono latin">{org.code}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span aria-hidden="true">{flagEmoji(org.country_code)} </span>
                        <span className="latin">{org.country_code}</span>
                      </td>
                      <td>
                        {org.subscription_plan ? (
                          <span className="sa-badge tier-pro">{org.subscription_plan}</span>
                        ) : (
                          <span className="sa-badge tier-free">
                            {t("platform.orgs.planFree")}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`sa-badge status-${org.status}`}>
                          <span className="dot" />
                          {t(`platform.orgStatus.${org.status}`, org.status)}
                        </span>
                      </td>
                      <td>
                        <span className="sa-cell-num latin">{nfmt.format(org.total_orphans)}</span>
                      </td>
                      <td>
                        <span className="sa-cell-num latin">{nfmt.format(org.total_donors)}</span>
                      </td>
                      <td>
                        <span className="sa-cell-last latin">
                          {dfmt.format(new Date(org.created_at))}
                        </span>
                      </td>
                      <td>
                        <div className="sa-actions-cell">
                          <button
                            type="button"
                            className="sa-action-btn"
                            aria-label={t("platform.orgs.edit")}
                            onClick={() => setEditing(org)}
                          >
                            <Icon>{ICONS.edit}</Icon>
                          </button>
                          {org.status === "suspended" ? (
                            <button
                              type="button"
                              className="sa-action-btn ok"
                              aria-label={t("platform.orgs.activate")}
                              onClick={() => setActivating(org)}
                            >
                              <Icon>{ICONS.play}</Icon>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="sa-action-btn danger"
                              aria-label={t("platform.orgs.suspend")}
                              onClick={() => setSuspending(org)}
                            >
                              <Icon>{ICONS.pause}</Icon>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sa-table-footer">
            <span>
              {t("platform.orgs.footerCount", { count: rows.length })}
            </span>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrgModal
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            await invalidate();
            setShowCreate(false);
          }}
        />
      )}
      {editing && (
        <EditOrgModal
          org={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await invalidate();
            setEditing(null);
          }}
        />
      )}
      {suspending && (
        <SuspendDialog
          org={suspending}
          onClose={() => setSuspending(null)}
          onDone={async () => {
            await invalidate();
            setSuspending(null);
          }}
        />
      )}
      {activating && (
        <ActivateDialog
          org={activating}
          onClose={() => setActivating(null)}
          onDone={async () => {
            await invalidate();
            setActivating(null);
          }}
        />
      )}
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="sa-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sa-modal">
        <div className="sa-modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="sa-modal-close"
            aria-label={title}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const d = err.response?.data?.detail;
    if (typeof d === "string") return d;
  }
  return fallback;
}

// ── Create org ───────────────────────────────────────────────────────

function CreateOrgModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [countryCode, setCountryCode] = useState("KW");
  const [currency, setCurrency] = useState("KWD");
  const [orgType, setOrgType] = useState<OrgType>("standalone");
  const [deployment, setDeployment] = useState<DeploymentMode>("self_hosted");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminFirst, setAdminFirst] = useState("Org");
  const [adminLast, setAdminLast] = useState("Admin");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      createPlatformOrganization({
        code: code.trim(),
        name_ar: nameAr.trim(),
        name_en: nameEn.trim(),
        country_code: countryCode.trim(),
        default_currency: currency.trim(),
        org_type: orgType,
        deployment_mode: deployment,
        admin_email: adminEmail.trim(),
        admin_password: adminPassword,
        admin_first_name: adminFirst.trim(),
        admin_last_name: adminLast.trim(),
      }),
    onSuccess: async (res) => {
      toast.success(t("platform.orgs.create.created", { email: res.admin_user.email }));
      await onCreated();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("platform.orgs.create.title")} onClose={onClose}>
      <form
        className="sa-form"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
      >
        <div className="sa-grid-2">
          <Field label={t("platform.orgs.create.code")}>
            <input
              required
              minLength={2}
              maxLength={20}
              className="sa-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label={t("platform.orgs.create.country")}>
            <input
              required
              maxLength={2}
              className="sa-input"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t("platform.orgs.create.nameAr")}>
            <input required className="sa-input" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </Field>
          <Field label={t("platform.orgs.create.nameEn")}>
            <input required className="sa-input" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
          <Field label={t("platform.orgs.create.currency")}>
            <input
              required
              maxLength={3}
              className="sa-input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t("platform.orgs.create.orgType")}>
            <select className="sa-select" value={orgType} onChange={(e) => setOrgType(e.target.value as OrgType)}>
              {ORG_TYPES.map((o) => (
                <option key={o} value={o}>
                  {t(`platform.orgType.${o}`, o)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("platform.orgs.create.deployment")}>
            <select
              className="sa-select"
              value={deployment}
              onChange={(e) => setDeployment(e.target.value as DeploymentMode)}
            >
              {DEPLOYMENT_MODES.map((d) => (
                <option key={d} value={d}>
                  {t(`platform.deployment.${d}`, d)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="sa-fieldset">
          <legend>{t("platform.orgs.create.adminLegend")}</legend>
          <div className="sa-grid-2">
            <Field label={t("platform.orgs.create.adminEmail")}>
              <input
                type="email"
                required
                className="sa-input"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
              />
            </Field>
            <Field label={t("platform.orgs.create.adminPassword")}>
              <input
                type="password"
                required
                minLength={8}
                className="sa-input"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </Field>
            <Field label={t("platform.orgs.create.adminFirst")}>
              <input required className="sa-input" value={adminFirst} onChange={(e) => setAdminFirst(e.target.value)} />
            </Field>
            <Field label={t("platform.orgs.create.adminLast")}>
              <input required className="sa-input" value={adminLast} onChange={(e) => setAdminLast(e.target.value)} />
            </Field>
          </div>
        </fieldset>

        {serverError && <p className="sa-modal-error">{serverError}</p>}

        <div className="sa-modal-actions">
          <button type="button" className="sa-btn sa-btn-secondary" onClick={onClose} disabled={mut.isPending}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="sa-btn sa-btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("platform.orgs.create.submit")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Edit org ─────────────────────────────────────────────────────────

function EditOrgModal({
  org,
  onClose,
  onSaved,
}: {
  org: PlatformOrgSummary;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [status, setStatus] = useState<OrgStatus>(org.status as OrgStatus);
  const [plan, setPlan] = useState(org.subscription_plan ?? "");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      updatePlatformOrganization(org.id, {
        status,
        subscription_plan: plan.trim() ? plan.trim() : null,
      }),
    onSuccess: async () => {
      toast.success(t("platform.orgs.editSaved"));
      await onSaved();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell
      title={`${t("platform.orgs.edit")} — ${isAr ? org.name_ar : org.name_en}`}
      onClose={onClose}
    >
      <form
        className="sa-form"
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
      >
        <dl className="sa-dl">
          <dt>{t("platform.orgs.cols.code")}</dt>
          <dd className="mono latin">{org.code}</dd>
          <dt>{t("platform.orgs.cols.country")}</dt>
          <dd className="latin">{org.country_code}</dd>
        </dl>

        <Field label={t("platform.orgs.cols.status")}>
          <select className="sa-select" value={status} onChange={(e) => setStatus(e.target.value as OrgStatus)}>
            {ORG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`platform.orgStatus.${s}`, s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("platform.orgs.cols.plan")}>
          <input
            className="sa-input"
            value={plan}
            placeholder={t("platform.orgs.editPlanPlaceholder")}
            onChange={(e) => setPlan(e.target.value)}
          />
        </Field>

        {serverError && <p className="sa-modal-error">{serverError}</p>}

        <div className="sa-modal-actions">
          <button type="button" className="sa-btn sa-btn-secondary" onClick={onClose} disabled={mut.isPending}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="sa-btn sa-btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Suspend (destructive — requires reason + confirm) ────────────────

function SuspendDialog({
  org,
  onClose,
  onDone,
}: {
  org: PlatformOrgSummary;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => suspendPlatformOrganization(org.id, reason.trim()),
    onSuccess: async () => {
      toast.success(t("platform.orgs.suspendDialog.done"));
      await onDone();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("platform.orgs.suspendDialog.title")} onClose={onClose}>
      <p className="sa-modal-text">
        {t("platform.orgs.suspendDialog.body", { name: isAr ? org.name_ar : org.name_en })}
      </p>
      <div className="sa-field" style={{ marginBlock: "14px" }}>
        <span>{t("platform.orgs.suspendDialog.reason")}</span>
        <textarea
          required
          rows={3}
          className="sa-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {serverError && <p className="sa-modal-error">{serverError}</p>}
      <div className="sa-modal-actions">
        <button type="button" className="sa-btn sa-btn-secondary" onClick={onClose} disabled={mut.isPending}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="sa-btn sa-btn-danger"
          onClick={() => {
            setServerError(null);
            if (reason.trim()) mut.mutate();
          }}
          disabled={mut.isPending || !reason.trim()}
        >
          {mut.isPending ? t("common.saving") : t("platform.orgs.suspend")}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Activate (confirm) ───────────────────────────────────────────────

function ActivateDialog({
  org,
  onClose,
  onDone,
}: {
  org: PlatformOrgSummary;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => activatePlatformOrganization(org.id),
    onSuccess: async () => {
      toast.success(t("platform.orgs.activateDialog.done"));
      await onDone();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("platform.orgs.activateDialog.title")} onClose={onClose}>
      <p className="sa-modal-text">
        {t("platform.orgs.activateDialog.body", { name: isAr ? org.name_ar : org.name_en })}
      </p>
      {serverError && <p className="sa-modal-error">{serverError}</p>}
      <div className="sa-modal-actions" style={{ marginBlockStart: "14px" }}>
        <button type="button" className="sa-btn sa-btn-secondary" onClick={onClose} disabled={mut.isPending}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="sa-btn sa-btn-primary"
          onClick={() => {
            setServerError(null);
            mut.mutate();
          }}
          disabled={mut.isPending}
        >
          {mut.isPending ? t("common.saving") : t("platform.orgs.activate")}
        </button>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="sa-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
