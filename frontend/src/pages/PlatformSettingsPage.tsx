import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { fetchPlatformSettings, updatePlatformSettings } from "@/lib/platform";
import { toast } from "@/store/toasts";

import "./PlatformSettingsPage.css";

/**
 * SA-04 — Platform Settings.
 *
 * Pixel-parity port of docs/design/screens/super-admin/SA-04-Settings.html.
 * App-shell chrome is provided by PlatformLayout.
 *
 * Wired to existing endpoints:
 *   - GET   /platform/settings   → flat JSONB of system flags
 *   - PATCH /platform/settings   → shallow-merge save
 *
 * The mockup's Payment / SMTP / Storage / Encryption / API cards have no
 * backend source (TODO(backend)); only the real flat flags are editable.
 * Danger-zone operations have no endpoint either and surface a confirm
 * dialog → "coming soon" notice rather than firing anything.
 */

/**
 * Known platform flags rendered even when the backend settings JSONB is
 * empty (the migration seeds `{}`), so the page is usable from a fresh
 * install. Any additional primitive keys the backend returns are rendered
 * too. Values from the backend always win over these defaults.
 */
const KNOWN_FLAGS: Record<string, boolean | string | number> = {
  maintenance_mode: false,
  signups_open: true,
  default_subscription_plan: "free",
};

type Primitive = boolean | string | number;

function isPrimitive(v: unknown): v is Primitive {
  return typeof v === "boolean" || typeof v === "string" || typeof v === "number";
}

// Seed the editable form from known flags + whatever primitives the backend
// returns. Used both on load and to revert unsaved changes.
function buildForm(settings: Record<string, unknown>): Record<string, Primitive> {
  const merged: Record<string, Primitive> = { ...KNOWN_FLAGS };
  for (const [k, v] of Object.entries(settings)) {
    if (isPrimitive(v)) merged[k] = v;
  }
  return merged;
}

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
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
};

export function PlatformSettingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform", "settings"],
    queryFn: fetchPlatformSettings,
  });

  // Editable form state of primitive settings, seeded from known flags +
  // whatever the backend returns. Non-primitive keys are shown read-only.
  const [form, setForm] = useState<Record<string, Primitive>>({});
  const [confirming, setConfirming] = useState<DangerOp | null>(null);

  const readOnlyKeys = useMemo(() => {
    if (!data) return [] as [string, unknown][];
    return Object.entries(data.settings).filter(([, v]) => !isPrimitive(v));
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setForm(buildForm(data.settings));
  }, [data]);

  const save = useMutation({
    mutationFn: () => updatePlatformSettings(form),
    onSuccess: async () => {
      toast.success(t("platform.settings.saved"));
      await qc.invalidateQueries({ queryKey: ["platform", "settings"] });
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError && typeof err.response?.data?.detail === "string"
          ? err.response.data.detail
          : t("common.createError");
      toast.error(msg);
    },
  });

  function setKey(key: string, value: Primitive) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function labelFor(key: string): string {
    return t(`platform.settings.keys.${key}`, key.replace(/_/g, " "));
  }

  const maintenanceOn = form.maintenance_mode === true;

  // Primitive keys other than the maintenance flag (which lives in its own
  // card) are rendered in the General card.
  const generalKeys = Object.keys(form).filter((k) => k !== "maintenance_mode");

  return (
    <div className="sa-settings">
      <h1 className="sr-only">{t("platform.settings.title")}</h1>

      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <div className="sa-topbar">
        <div className="sa-topbar-title">
          <h2>{t("platform.settings.title")}</h2>
          <p>{t("platform.settings.subtitle")}</p>
        </div>
        <div className="sa-topbar-actions">
          <button
            type="button"
            className="sa-btn sa-btn-secondary"
            onClick={() => data && setForm(buildForm(data.settings))}
            disabled={save.isPending || !data}
          >
            {t("platform.settings.cancelChanges")}
          </button>
          <button
            type="button"
            className="sa-btn sa-btn-primary"
            onClick={() => save.mutate()}
            disabled={save.isPending || !data}
          >
            <Icon>{ICONS.check}</Icon>
            {save.isPending ? t("common.saving") : t("platform.settings.saveAll")}
          </button>
        </div>
      </div>

      {isLoading && <div className="sa-skeleton" style={{ height: 280 }} />}
      {error && <div className="sa-state error">{t("common.loadError")}</div>}

      {data && (
        <div className="sa-content">
          {/* ── Inner nav ───────────────────────────────────────────── */}
          <nav className="sa-set-nav" aria-label={t("platform.settings.navLabel")}>
            <a className="sa-set-nav-link" href="#general">
              <Icon>{ICONS.sliders}</Icon>
              {t("platform.settings.general")}
            </a>
            <a className="sa-set-nav-link" href="#maintenance">
              <Icon>{ICONS.wrench}</Icon>
              {t("platform.settings.maintenance.title")}
            </a>
            <a className="sa-set-nav-link" href="#danger">
              <Icon>{ICONS.alert}</Icon>
              {t("platform.settings.dangerZone")}
            </a>
          </nav>

          <div className="sa-settings-list">
            {/* ── General ──────────────────────────────────────────── */}
            <section className="sa-card" id="general">
              <div className="sa-card-head">
                <div className="sa-card-title">
                  <Icon className="sa-icon">{ICONS.sliders}</Icon>
                  {t("platform.settings.general")}
                </div>
                {data.updated_at && (
                  <span className="sa-card-actions-meta">
                    {t("platform.settings.updatedAt", {
                      date: new Date(data.updated_at).toLocaleString(i18n.language),
                    })}
                  </span>
                )}
              </div>
              <div className="sa-card-body">
                {generalKeys.length === 0 && (
                  <p className="sa-card-actions-meta">{t("common.empty")}</p>
                )}
                {generalKeys.map((key) => (
                  <SettingRow
                    key={key}
                    label={labelFor(key)}
                    value={form[key] as Primitive}
                    onChange={(v) => setKey(key, v)}
                  />
                ))}
              </div>
              <div className="sa-card-actions">
                <span className="sa-card-actions-meta">{t("platform.settings.generalHint")}</span>
                <button
                  type="button"
                  className="sa-btn sa-btn-primary"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                >
                  {save.isPending ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </section>

            {/* ── Maintenance ──────────────────────────────────────── */}
            <section className="sa-card" id="maintenance">
              <div className="sa-card-head">
                <div className="sa-card-title">
                  <Icon className="sa-icon">{ICONS.wrench}</Icon>
                  {t("platform.settings.maintenance.title")}
                </div>
                <span className={`sa-card-status ${maintenanceOn ? "warn" : "ok"}`}>
                  <span className="dot" />
                  {maintenanceOn
                    ? t("platform.settings.maintenance.on")
                    : t("platform.settings.maintenance.off")}
                </span>
              </div>
              <div className="sa-card-body">
                <div className="sa-toggle-row">
                  <div className="sa-toggle-row-body">
                    <strong>{t("platform.settings.maintenance.toggleTitle")}</strong>
                    <p>{t("platform.settings.maintenance.toggleBody")}</p>
                  </div>
                  <Toggle
                    checked={maintenanceOn}
                    onChange={(v) => setKey("maintenance_mode", v)}
                    label={t("platform.settings.maintenance.toggleTitle")}
                  />
                </div>
              </div>
              <div className="sa-card-actions">
                <span className="sa-card-actions-meta">{t("platform.settings.maintenance.hint")}</span>
                <button
                  type="button"
                  className="sa-btn sa-btn-primary"
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                >
                  {save.isPending ? t("common.saving") : t("common.save")}
                </button>
              </div>
            </section>

            {/* ── Advanced (read-only complex values) ──────────────── */}
            {readOnlyKeys.length > 0 && (
              <section className="sa-card">
                <div className="sa-card-head">
                  <div className="sa-card-title">{t("platform.settings.advanced")}</div>
                </div>
                <div className="sa-card-body">
                  <p className="sa-card-actions-meta" style={{ marginBottom: 12 }}>
                    {t("platform.settings.advancedHint")}
                  </p>
                  {readOnlyKeys.map(([key, value]) => (
                    <div key={key} className="sa-advanced-key">
                      <p>{labelFor(key)}</p>
                      <pre>{JSON.stringify(value, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Danger zone ──────────────────────────────────────── */}
            <div className="sa-danger-zone" id="danger">
              <h2 className="sa-danger-title">
                <Icon className="sa-icon">{ICONS.alert}</Icon>
                {t("platform.settings.dangerZone")}
              </h2>
              <p className="sa-card-actions-meta" style={{ marginBottom: 8 }}>
                {t("platform.settings.dangerHint")}
              </p>
              {(["backup", "reindex", "restart"] as const).map((op) => (
                <div key={op} className="sa-danger-row">
                  <div>
                    <strong>{t(`platform.settings.danger.${op}.title`)}</strong>
                    <p>{t(`platform.settings.danger.${op}.body`)}</p>
                  </div>
                  <button
                    type="button"
                    className={`sa-btn ${op === "restart" ? "sa-btn-danger" : "sa-btn-secondary"}`}
                    onClick={() => setConfirming(op)}
                  >
                    {t(`platform.settings.danger.${op}.action`)}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          op={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            // TODO(backend): no endpoint for these operations yet.
            toast.info(t("common.comingSoon"));
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}

type DangerOp = "backup" | "reindex" | "restart";

function ConfirmDialog({
  op,
  onClose,
  onConfirm,
}: {
  op: DangerOp;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const destructive = op === "restart";
  return (
    <div
      className="sa-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t(`platform.settings.danger.${op}.title`)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sa-modal">
        <h2>{t(`platform.settings.danger.${op}.title`)}</h2>
        <p>{t(`platform.settings.danger.${op}.confirm`)}</p>
        <div className="sa-modal-actions">
          <button type="button" className="sa-btn sa-btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={`sa-btn ${destructive ? "sa-btn-danger" : "sa-btn-primary"}`}
            onClick={onConfirm}
          >
            {t(`platform.settings.danger.${op}.action`)}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Primitive;
  onChange: (v: Primitive) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <div className="sa-toggle-row">
        <div className="sa-toggle-row-body">
          <strong>{label}</strong>
        </div>
        <Toggle checked={value} onChange={onChange} label={label} />
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="sa-field">
        <span className="sa-label">{label}</span>
        <input
          type="number"
          className="sa-input latin"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <label className="sa-field">
      <span className="sa-label">{label}</span>
      <input
        type="text"
        className="sa-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`sa-toggle${checked ? " on" : ""}`}
    />
  );
}
