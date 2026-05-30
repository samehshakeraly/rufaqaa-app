/* ═══════════════════════════════════════════════════════════════
   OA-06 Organization Settings
   Ported 1:1 from /tmp/mockup-oa06.html (mockup by design).
   • Organization sections: General / Regional / Integrations /
     Webhooks / API keys / Danger zone — wired to /organization
     PATCH via OrganizationSettingsCard pattern.
   • My Account section (below) preserves existing change-password,
     2FA, and notification-preferences functionality unchanged.
   ═══════════════════════════════════════════════════════════════ */

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { type ReactNode, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { api } from "@/lib/api";
import {
  type NotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/auth";
import {
  fetchOrganization,
  updateOrganization,
  type OrganizationUpdateInput,
} from "@/lib/organization";
import { disable2FA, enroll2FA, verify2FA } from "@/lib/twofa";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useRole } from "@/hooks/useRole";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toasts";

import "./SettingsPage.css";

// ── Inline SVG helper ──────────────────────────────────────────
function Icon({
  children,
  className = "oa-s-icon oa-s-icon-sm",
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

// Icon path defs
const I = {
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </>
  ),
  pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  webhook: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
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
  check: <polyline points="20 6 9 17 4 12" />,
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  retry: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  revoke: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  mail: (
    <>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </>
  ),
  box: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </>
  ),
  aiBox: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
};

type TabKey = "general" | "regional" | "integrations" | "webhooks" | "api" | "danger";

// ════════════════════════════════════════════════════════════════
// Root page
// ════════════════════════════════════════════════════════════════
export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>("general");

  const tabs: Array<{ key: TabKey; icon: ReactNode }> = [
    { key: "general", icon: I.settings },
    { key: "regional", icon: I.globe },
    { key: "integrations", icon: I.pulse },
    { key: "webhooks", icon: I.webhook },
    { key: "api", icon: I.lock },
    { key: "danger", icon: I.alert },
  ];

  return (
    <div className="oa-settings">
      {/* Single h1 — screen-reader anchor; visible title in app topbar */}
      <h1 className="sr-only">{t("settings.title")}</h1>

      {/* ── Tab bar ──────────────────────────────────────────── */}
      <nav
        className="oa-s-tabs"
        role="tablist"
        aria-label={t("settings.title")}
      >
        {tabs.map(({ key, icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            aria-controls={`pane-${key}`}
            id={`tab-${key}`}
            className={`oa-s-tab${activeTab === key ? " active" : ""}`}
            onClick={() => {
              setActiveTab(key);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <Icon>{icon}</Icon>
            {t(`settings.tabs.${key}`)}
          </button>
        ))}
      </nav>

      {/* ── Panes ────────────────────────────────────────────── */}
      <div
        id="pane-general"
        role="tabpanel"
        aria-labelledby="tab-general"
        className={`oa-s-pane${activeTab === "general" ? " active" : ""}`}
      >
        <IdentityCard />
        <AboutCard />
      </div>

      <div
        id="pane-regional"
        role="tabpanel"
        aria-labelledby="tab-regional"
        className={`oa-s-pane${activeTab === "regional" ? " active" : ""}`}
      >
        <RegionalCard />
      </div>

      <div
        id="pane-integrations"
        role="tabpanel"
        aria-labelledby="tab-integrations"
        className={`oa-s-pane${activeTab === "integrations" ? " active" : ""}`}
      >
        <IntegrationsCard />
      </div>

      <div
        id="pane-webhooks"
        role="tabpanel"
        aria-labelledby="tab-webhooks"
        className={`oa-s-pane${activeTab === "webhooks" ? " active" : ""}`}
      >
        <WebhooksCard />
      </div>

      <div
        id="pane-api"
        role="tabpanel"
        aria-labelledby="tab-api"
        className={`oa-s-pane${activeTab === "api" ? " active" : ""}`}
      >
        <ApiKeysCard />
      </div>

      <div
        id="pane-danger"
        role="tabpanel"
        aria-labelledby="tab-danger"
        className={`oa-s-pane${activeTab === "danger" ? " active" : ""}`}
      >
        <DangerZoneCard />
      </div>

      {/* ── My Account (always visible, below org tabs) ────── */}
      <MyAccountSection />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// General → Identity card (wired to PATCH /organization)
// ════════════════════════════════════════════════════════════════
function IdentityCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin } = useRole();

  const { data, isLoading } = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
  });

  const [form, setForm] = useState<OrganizationUpdateInput>({});
  const [selectedColor, setSelectedColor] = useState(0);

  useEffect(() => {
    if (data) {
      setForm({
        name_ar: data.name_ar,
        name_en: data.name_en,
        default_currency: data.default_currency,
        primary_color: data.primary_color,
      });
    }
  }, [data]);

  const mut = useMutation({
    mutationFn: (payload: OrganizationUpdateInput) => updateOrganization(payload),
    onSuccess: (next) => {
      qc.setQueryData(["organization"], next);
      toast.success(t("settings.organizationSaved"));
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        const d = err.response?.data?.detail;
        toast.error(typeof d === "string" ? d : t("common.createError"));
      } else {
        toast.error(t("common.createError"));
      }
    },
  });

  const disabled = !isAdmin || isLoading;

  const swatches = [
    { label: t("settings.identity.colorTrust"), hex: "#5b85b8", bg: "var(--trust-400)" },
    { label: t("settings.identity.colorSerenity"), hex: "#14b8a6", bg: "#14b8a6" },
    { label: t("settings.identity.colorSakina"), hex: "#855e08", bg: "#855e08" },
    { label: t("settings.identity.colorWaqar"), hex: "#6d28d9", bg: "#6d28d9" },
  ];

  return (
    <section
      className="oa-s-card"
      aria-labelledby="identity-heading"
    >
      <header className="oa-s-card-head">
        <div>
          <h3 id="identity-heading">{t("settings.identity.title")}</h3>
          <p>{t("settings.identity.description")}</p>
        </div>
      </header>

      <form
        className="oa-s-card-body"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate(form);
        }}
      >
        <div className="oa-s-form-grid">

          {/* Official name */}
          <label className="oa-s-label" htmlFor="id-name-ar">
            {t("settings.identity.officialName")}
          </label>
          <div className="oa-s-field">
            <input
              id="id-name-ar"
              className="oa-s-input"
              value={form.name_ar ?? ""}
              disabled={disabled}
              aria-label={t("settings.identity.namePlaceholderAr")}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            />
            <div className="oa-s-row-2" style={{ marginTop: 10 }}>
              <input
                className="oa-s-input latin"
                dir="ltr"
                value={form.name_en ?? ""}
                disabled={disabled}
                placeholder={t("settings.identity.namePlaceholderEn")}
                aria-label={t("settings.identity.namePlaceholderEn")}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
              />
              {/* TODO(backend): short_name / display_name field not in Organization type */}
              <input
                className="oa-s-input"
                disabled
                placeholder={t("settings.identity.namePlaceholderShort")}
                aria-label={t("settings.identity.namePlaceholderShort")}
                title="— TODO(backend): short_name not in /organization"
              />
            </div>
            <div className="oa-s-hint">{t("settings.identity.officialNameHint")}</div>
          </div>

          {/* Logo */}
          <span className="oa-s-label">
            {t("settings.identity.logo")}
            <span className="opt">{t("settings.identity.logoHint")}</span>
          </span>
          <div className="oa-s-field">
            {/* TODO(backend): logo_url upload endpoint not exposed; logo_url is settable
                via PATCH /organization but no multipart upload endpoint exists */}
            <div className="oa-s-logo-uploader">
              <div className="oa-s-logo-preview" aria-hidden="true">
                {data?.name_ar?.charAt(0) ?? "و"}
              </div>
              <div className="oa-s-logo-info">
                {data?.logo_url ? (
                  <div className="nm">{data.logo_url}</div>
                ) : (
                  <div className="nm" style={{ color: "var(--gray-400)", fontStyle: "italic" }}>
                    —{/* TODO(backend): no logo uploaded */}
                  </div>
                )}
                <div className="sub">{t("settings.identity.logoHint")}</div>
                <div className="btns">
                  <button
                    type="button"
                    className="oa-s-btn-secondary"
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    disabled={disabled}
                  >
                    {t("settings.identity.logoReplace")}
                  </button>
                  <button
                    type="button"
                    className="oa-s-btn-ghost"
                    style={{ color: "var(--danger-600)" }}
                    disabled={disabled}
                  >
                    {t("settings.identity.logoDelete")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Primary colour */}
          <label className="oa-s-label">
            {t("settings.identity.primaryColor")}
          </label>
          <div className="oa-s-field">
            <div className="oa-s-color-row" role="radiogroup" aria-label={t("settings.identity.primaryColor")}>
              {swatches.map((sw, i) => (
                <button
                  key={sw.hex}
                  type="button"
                  role="radio"
                  aria-checked={selectedColor === i}
                  className={`oa-s-swatch${selectedColor === i ? " selected" : ""}`}
                  onClick={() => {
                    setSelectedColor(i);
                    setForm({ ...form, primary_color: sw.hex });
                  }}
                  disabled={disabled}
                >
                  <div className="sw" style={{ background: sw.bg }} />
                  <div className="sn">{sw.label}</div>
                  <div className="sh latin">{sw.hex}</div>
                </button>
              ))}
              <button
                type="button"
                className="oa-s-btn-ghost add-dashed"
                disabled={disabled}
                aria-label={t("settings.identity.colorCustom")}
              >
                <Icon>{I.plus}</Icon>
                {t("settings.identity.colorCustom")}
              </button>
            </div>
            <div className="oa-s-hint">{t("settings.identity.primaryColorHint")}</div>
          </div>

          {/* Tagline */}
          {/* TODO(backend): tagline / slogan not in Organization type */}
          <label className="oa-s-label" htmlFor="id-tagline">
            {t("settings.identity.tagline")}
            <span className="opt">{t("settings.identity.taglineHint")}</span>
          </label>
          <div className="oa-s-field">
            <input
              id="id-tagline"
              className="oa-s-input"
              disabled
              placeholder={t("settings.identity.taglinePlaceholder")}
              title="— TODO(backend): tagline not in /organization"
            />
          </div>

          {/* Contact details */}
          <label className="oa-s-label">
            {t("settings.identity.contactDetails")}
          </label>
          <div className="oa-s-field">
            {/* TODO(backend): contact_email / contact_phone / website / address
                not in Organization or OrganizationUpdateInput types */}
            <div className="oa-s-row-2">
              <input
                className="oa-s-input latin"
                dir="ltr"
                disabled
                placeholder={t("settings.identity.contactEmail")}
                title="— TODO(backend): contact_email not in /organization"
              />
              <input
                className="oa-s-input mono"
                dir="ltr"
                disabled
                placeholder={t("settings.identity.contactPhone")}
                title="— TODO(backend): contact_phone not in /organization"
              />
            </div>
            <div className="oa-s-row-2" style={{ marginTop: 8 }}>
              <input
                className="oa-s-input latin"
                dir="ltr"
                disabled
                placeholder={t("settings.identity.website")}
                title="— TODO(backend): website not in /organization"
              />
              <input
                className="oa-s-input"
                disabled
                placeholder={t("settings.identity.address")}
                title="— TODO(backend): address not in /organization"
              />
            </div>
          </div>

        </div>
      </form>

      <footer className="oa-s-card-foot">
        <span className="oa-s-last-saved">
          <Icon>{I.check}</Icon>
        </span>
        <button
          type="button"
          className="oa-s-btn-ghost"
          onClick={() => {
            if (data) {
              setForm({
                name_ar: data.name_ar,
                name_en: data.name_en,
                primary_color: data.primary_color,
              });
            }
          }}
          disabled={disabled}
        >
          {t("settings.cardFoot.revert")}
        </button>
        <button
          type="button"
          className="oa-s-btn-primary"
          disabled={mut.isPending || disabled}
          onClick={() => mut.mutate(form)}
        >
          {mut.isPending ? t("common.saving") : t("settings.cardFoot.saveChanges")}
        </button>
      </footer>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// General → About card
// TODO(backend): bio_ar / bio_en not in Organization type
// ════════════════════════════════════════════════════════════════
function AboutCard() {
  const { t } = useTranslation();

  return (
    <section className="oa-s-card" aria-labelledby="about-heading">
      <header className="oa-s-card-head">
        <div>
          <h3 id="about-heading">{t("settings.about.title")}</h3>
          <p>{t("settings.about.description")}</p>
        </div>
      </header>
      <div className="oa-s-card-body">
        <div className="oa-s-form-grid">
          <label className="oa-s-label" htmlFor="about-ar">
            {t("settings.about.bioAr")}
          </label>
          <div className="oa-s-field">
            {/* TODO(backend): bio_ar not in /organization type */}
            <textarea
              id="about-ar"
              className="oa-s-textarea"
              rows={4}
              disabled
              placeholder="—"
              title="— TODO(backend): bio_ar not in /organization"
            />
            <div className="oa-s-hint latin" dir="ltr">— / 600</div>
          </div>
          <label className="oa-s-label" htmlFor="about-en">
            {t("settings.about.bioEn")}
          </label>
          <div className="oa-s-field">
            {/* TODO(backend): bio_en not in /organization type */}
            <textarea
              id="about-en"
              className="oa-s-textarea latin"
              rows={4}
              dir="ltr"
              disabled
              placeholder="—"
              title="— TODO(backend): bio_en not in /organization"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// Regional card — wired to PATCH /organization for currency/
// language/timezone; other fields are TODO(backend)
// ════════════════════════════════════════════════════════════════
function RegionalCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin } = useRole();

  const { data, isLoading } = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
  });

  const [form, setForm] = useState<OrganizationUpdateInput>({});

  useEffect(() => {
    if (data) {
      setForm({
        default_language: data.default_language,
        default_currency: data.default_currency,
        timezone: data.timezone,
      });
    }
  }, [data]);

  const mut = useMutation({
    mutationFn: (p: OrganizationUpdateInput) => updateOrganization(p),
    onSuccess: (next) => {
      qc.setQueryData(["organization"], next);
      toast.success(t("settings.organizationSaved"));
    },
    onError: () => toast.error(t("common.createError")),
  });

  const disabled = !isAdmin || isLoading;

  // Calendar display state — TODO(backend): calendar preference not in type
  const [cal, setCal] = useState<"hijri" | "gregorian" | "both">("hijri");
  // Number format state — TODO(backend): number_format not in type
  const [numFmt, setNumFmt] = useState<"western" | "arabic" | "eu">("western");
  // First day of week — TODO(backend): week_start not in type
  const [weekStart, setWeekStart] = useState<"sun" | "sat" | "mon">("sun");

  return (
    <section className="oa-s-card" aria-labelledby="regional-heading">
      <header className="oa-s-card-head">
        <div>
          <h3 id="regional-heading">{t("settings.regional.title")}</h3>
          <p>{t("settings.regional.description")}</p>
        </div>
      </header>

      <div className="oa-s-card-body">
        <div className="oa-s-form-grid">

          {/* Default language */}
          <label className="oa-s-label" htmlFor="reg-lang">
            {t("settings.regional.defaultLanguage")}
          </label>
          <div className="oa-s-field">
            <select
              id="reg-lang"
              className="oa-s-select"
              value={form.default_language ?? "ar"}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, default_language: e.target.value })}
            >
              <option value="ar">{t("settings.regional.langAr")}</option>
              <option value="en">{t("settings.regional.langEn")}</option>
            </select>
            <div className="oa-s-hint">{t("settings.regional.defaultLanguageHint")}</div>
          </div>

          {/* Supported languages — TODO(backend): multi-language list not in type */}
          <span className="oa-s-label">{t("settings.regional.supportedLanguages")}</span>
          <div className="oa-s-lang-list" role="list" aria-label={t("settings.regional.supportedLanguages")}>
            <span className="oa-s-lang-pill" role="listitem">
              {t("settings.regional.langAr")}
              <button
                type="button"
                aria-label={`${t("common.cancel")} ${t("settings.regional.langAr")}`}
                disabled={disabled}
              >
                ×
              </button>
            </span>
            <span className="oa-s-lang-pill" role="listitem">
              <span className="latin">{t("settings.regional.langEn")}</span>
              <button
                type="button"
                aria-label={`${t("common.cancel")} ${t("settings.regional.langEn")}`}
                disabled={disabled}
              >
                ×
              </button>
            </span>
            {/* TODO(backend): supported_languages list not in /organization type */}
            <button type="button" className="oa-s-btn-ghost add-dashed" disabled={disabled}>
              <Icon>{I.plus}</Icon>
              {t("settings.regional.addLanguage")}
            </button>
          </div>

          {/* Timezone */}
          <label className="oa-s-label" htmlFor="reg-tz">
            {t("settings.regional.timezone")}
          </label>
          <div className="oa-s-field">
            <select
              id="reg-tz"
              className="oa-s-select"
              value={form.timezone ?? ""}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            >
              <option value="Asia/Kuwait">توقيت الكويت (UTC+3)</option>
              <option value="Asia/Riyadh">توقيت الرياض (UTC+3)</option>
              <option value="Africa/Cairo">توقيت القاهرة (UTC+2)</option>
              <option value="Asia/Dubai">توقيت دبي (UTC+4)</option>
            </select>
          </div>

          {/* Calendar — TODO(backend): calendar_preference not in type */}
          <span className="oa-s-label">{t("settings.regional.calendar")}</span>
          <div className="oa-s-btn-group" role="group" aria-label={t("settings.regional.calendar")}>
            {(["hijri", "gregorian", "both"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`oa-s-btn-secondary${cal === v ? " active" : ""}`}
                onClick={() => setCal(v)}
                disabled={disabled}
                title="— TODO(backend): calendar_preference not in /organization"
              >
                {t(`settings.regional.cal${v.charAt(0).toUpperCase() + v.slice(1).replace("ian", "ian")}Primary` as never) ??
                  (v === "hijri" ? t("settings.regional.calHijriPrimary") : v === "gregorian" ? t("settings.regional.calGregorianPrimary") : t("settings.regional.calBoth"))}
              </button>
            ))}
          </div>

          {/* Default currency */}
          <label className="oa-s-label" htmlFor="reg-cur">
            {t("settings.regional.currency")}
            <span className="opt">{t("settings.regional.currencyHint")}</span>
          </label>
          <div className="oa-s-field">
            <select
              id="reg-cur"
              className="oa-s-select"
              value={form.default_currency ?? ""}
              disabled={disabled}
              onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
            >
              <option value="KWD">دينار كويتي (KWD)</option>
              <option value="SAR">ريال سعودي (SAR)</option>
              <option value="AED">درهم إماراتي (AED)</option>
              <option value="USD">دولار أمريكي (USD)</option>
            </select>
          </div>

          {/* Number format — TODO(backend): number_format not in type */}
          <span className="oa-s-label">{t("settings.regional.numberFormat")}</span>
          <div className="oa-s-btn-group" role="group" aria-label={t("settings.regional.numberFormat")}>
            {(["western", "arabic", "eu"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`oa-s-btn-secondary${numFmt === v ? " active" : ""}`}
                onClick={() => setNumFmt(v)}
                disabled={disabled}
                title="— TODO(backend): number_format not in /organization"
              >
                <span className="latin num">
                  {v === "western" ? "12,500.50" : v === "arabic" ? "١٢٬٥٠٠٫٥٠" : "12.500,50"}
                </span>
              </button>
            ))}
          </div>

          {/* First day of week — TODO(backend): week_start not in type */}
          <span className="oa-s-label">{t("settings.regional.firstDayOfWeek")}</span>
          <div className="oa-s-btn-group" role="group" aria-label={t("settings.regional.firstDayOfWeek")}>
            {(["sun", "sat", "mon"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`oa-s-btn-secondary${weekStart === v ? " active" : ""}`}
                onClick={() => setWeekStart(v)}
                disabled={disabled}
                title="— TODO(backend): week_start not in /organization"
              >
                {v === "sun"
                  ? t("settings.regional.daySunday")
                  : v === "sat"
                  ? t("settings.regional.daySaturday")
                  : t("settings.regional.dayMonday")}
              </button>
            ))}
          </div>

        </div>
      </div>

      <footer className="oa-s-card-foot">
        <button type="button" className="oa-s-btn-ghost" disabled={disabled}>
          {t("settings.cardFoot.revert")}
        </button>
        <button
          type="button"
          className="oa-s-btn-primary"
          disabled={mut.isPending || disabled}
          onClick={() => mut.mutate(form)}
        >
          {mut.isPending ? t("common.saving") : t("settings.cardFoot.saveChanges")}
        </button>
      </footer>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// Integrations card
// TODO(backend): integrations list/status not in /organization type.
// All integration tiles are static display from mockup.
// ════════════════════════════════════════════════════════════════
function IntegrationsCard() {
  const { t } = useTranslation();

  const integrations = [
    {
      id: "myfatoorah",
      logoClass: "payment",
      logoIcon: I.creditCard,
      name: "MyFatoorah",
      sub: "بوّابة الدفع الإلكتروني",
      status: "live" as const,
      statusLabel: t("settings.integrations.connected"),
      desc: "كلّ مدفوعات الكفلاء تمرّ عبر MyFatoorah — K-Net، فيزا، Apple Pay، STC Pay.",
      meta: <span>{t("settings.integrations.since", { n: 8 })}</span>,
      metaLink: t("settings.integrations.manageSettings"),
    },
    {
      id: "whatsapp",
      logoClass: "whatsapp",
      logoIcon: I.message,
      name: "WhatsApp Business",
      sub: "تذكيرات ورسائل الكفلاء",
      status: "live" as const,
      statusLabel: t("settings.integrations.connected"),
      desc: (
        <>
          <span className="latin num">12,400</span> رسالة في آخر ٣٠ يوماً · معدّل التسليم{" "}
          <span className="latin num">98.4</span>%
        </>
      ),
      meta: <span>{t("settings.integrations.officialApi")}</span>,
      metaLink: t("settings.integrations.manageSettings"),
    },
    {
      id: "sendgrid",
      logoClass: "email",
      logoIcon: I.mail,
      name: "SendGrid",
      sub: "البريد الإلكتروني الإجرائي",
      status: "live" as const,
      statusLabel: t("settings.integrations.connected"),
      desc: (
        <>
          إيصالات + تذكيرات + نشرة شهريّة. النطاق الموثَّق:{" "}
          <code
            style={{
              background: "var(--gray-100)",
              padding: "1px 5px",
              borderRadius: 3,
              fontFamily: "IBM Plex Mono, monospace",
              fontSize: 11,
            }}
          >
            mail.rufaqaa.app
          </code>
        </>
      ),
      meta: <span>SPF · DKIM موثَّقان</span>,
      metaLink: t("settings.integrations.manageSettings"),
    },
    {
      id: "twilio",
      logoClass: "sms",
      logoIcon: I.message,
      name: "Twilio SMS",
      sub: "رسائل الـ SMS",
      status: "warn" as const,
      statusLabel: t("settings.integrations.warning"),
      desc: (
        <>
          <span className="latin num">8,200</span> /{" "}
          <span className="latin num">10,000</span> رسالة هذا الشهر
        </>
      ),
      meta: <span>تجديد في ٢٨ ذو القعدة</span>,
      metaLink: t("settings.integrations.upgradePackage"),
    },
    {
      id: "s3",
      logoClass: "storage",
      logoIcon: I.box,
      name: "AWS S3",
      sub: "تخزين الصور والملفّات",
      status: "live" as const,
      statusLabel: t("settings.integrations.connected"),
      desc: (
        <>
          <span className="latin num">242</span> غيغابايت مستخدمة · CloudFront CDN مفعَّل
        </>
      ),
      meta: <span>منطقة: me-south-1</span>,
      metaLink: t("settings.integrations.manageSettings"),
    },
    {
      id: "claude",
      logoClass: "ai",
      logoIcon: I.aiBox,
      name: "Anthropic — Claude",
      sub: "مراجعة AI للوسائط",
      status: "live" as const,
      statusLabel: t("settings.integrations.connected"),
      desc: (
        <>
          مراجعة الصور والتقارير ورسائل المتبرّعين قبل النشر —{" "}
          <span className="latin num">99.2</span>% دقّة
        </>
      ),
      meta: <span>Sonnet 4</span>,
      metaLink: t("settings.integrations.manageSettings"),
    },
  ];

  return (
    <section className="oa-s-card" aria-labelledby="integ-heading">
      <header className="oa-s-card-head">
        <div>
          <h3 id="integ-heading">{t("settings.integrations.title")}</h3>
          <p>{t("settings.integrations.description")}</p>
        </div>
        <button type="button" className="oa-s-btn-secondary">
          <Icon>{I.globe}</Icon>
          {t("settings.integrations.browseAll")}
        </button>
      </header>
      <div className="oa-s-card-body">
        {/* TODO(backend): integration status/details not exposed via /organization.
            All tiles are static display — connect when an /integrations endpoint is available. */}
        <div className="oa-s-integ-grid">
          {integrations.map((integ) => (
            <article key={integ.id} className="oa-s-integ-card">
              <div className="oa-s-integ-head">
                <div className={`oa-s-integ-logo ${integ.logoClass}`} aria-hidden="true">
                  <Icon className="oa-s-icon">{integ.logoIcon}</Icon>
                </div>
                <div className="oa-s-integ-info">
                  <div className="nm">{integ.name}</div>
                  <div className="sub">{integ.sub}</div>
                </div>
                <span className={`oa-s-status ${integ.status}`} aria-label={integ.statusLabel}>
                  {integ.statusLabel}
                </span>
              </div>
              <div className="oa-s-integ-desc">{integ.desc}</div>
              <div className="oa-s-integ-meta">
                {integ.meta}
                <a href="#" onClick={(e) => e.preventDefault()}>
                  {integ.metaLink}
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// Webhooks card
// TODO(backend): webhooks CRUD not in /organization type.
// Static display from mockup.
// ════════════════════════════════════════════════════════════════
function WebhooksCard() {
  const { t } = useTranslation();

  const webhooks = [
    {
      id: "najat",
      url: "https://crm.najat.org.kw/rufaqaa/webhook",
      label: "CRM جمعية النجاة",
      events: ["sponsorship.created", "payment.succeeded"],
      extraCount: 3,
      status: "healthy" as const,
      lastCall: "قبل 4 د",
    },
    {
      id: "orman",
      url: "https://orman.org/api/v2/sponsorships/sync",
      label: "جمعية الأورمان — مزامنة",
      events: ["orphan.report.approved", "media.approved"],
      extraCount: 0,
      status: "healthy" as const,
      lastCall: "قبل 22 د",
    },
    {
      id: "zapier",
      url: "https://hooks.zapier.com/hooks/catch/8421/k7xn4...",
      label: "Zapier — Slack notifications",
      events: ["donor.signup", "milestone.reached"],
      extraCount: 0,
      status: "failing" as const,
      lastCall: "قبل ساعتين",
    },
    {
      id: "internal",
      url: "https://internal.rufaqaa.app/analytics/events",
      label: "مستودع بيانات داخلي",
      events: ["all events"],
      extraCount: 0,
      status: "healthy" as const,
      lastCall: "قبل ثانية",
    },
  ];

  return (
    <section className="oa-s-card" aria-labelledby="wh-heading">
      <header className="oa-s-card-head">
        <div>
          <h3 id="wh-heading">{t("settings.webhooks.title")}</h3>
          <p>{t("settings.webhooks.description")}</p>
        </div>
        {/* TODO(backend): webhook creation endpoint not available */}
        <button type="button" className="oa-s-btn-primary" disabled title="— TODO(backend)">
          <Icon>{I.plus}</Icon>
          {t("settings.webhooks.addWebhook")}
        </button>
      </header>
      <div className="oa-s-card-body" style={{ padding: 0 }}>
        {/* TODO(backend): webhook list not exposed; static mock data shown */}
        <div className="oa-s-tbl-wrap">
          <table className="oa-s-tbl" aria-label={t("settings.webhooks.title")}>
            <thead>
              <tr>
                <th scope="col">{t("settings.webhooks.colUrl")}</th>
                <th scope="col">{t("settings.webhooks.colEvents")}</th>
                <th scope="col">{t("settings.webhooks.colStatus")}</th>
                <th scope="col">{t("settings.webhooks.colLastCall")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {webhooks.map((wh) => (
                <tr key={wh.id}>
                  <td>
                    <span className="oa-s-wh-url latin">{wh.url}</span>
                    <div className="oa-s-wh-sub">{wh.label}</div>
                  </td>
                  <td>
                    {wh.events.map((ev) => (
                      <span key={ev} className="oa-s-wh-pill latin">
                        {ev}
                      </span>
                    ))}
                    {wh.extraCount > 0 && (
                      <span className="oa-s-wh-pill">
                        +<span className="latin">{wh.extraCount}</span>
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`oa-s-wh-status ${wh.status}`}>
                      {wh.status === "healthy"
                        ? t("settings.webhooks.statusHealthy")
                        : t("settings.webhooks.statusFailing", { n: 3 })}
                    </span>
                  </td>
                  <td
                    style={
                      wh.status === "failing" ? { color: "var(--danger-600)", fontWeight: 600 } : undefined
                    }
                  >
                    <span className="latin">{wh.lastCall}</span>
                  </td>
                  <td>
                    <div className="oa-s-tbl-actions">
                      <button
                        type="button"
                        className="oa-s-icon-btn"
                        aria-label={t("settings.webhooks.actionView")}
                      >
                        <Icon>{I.eye}</Icon>
                      </button>
                      <button
                        type="button"
                        className="oa-s-icon-btn"
                        aria-label={t("settings.webhooks.actionRetry")}
                      >
                        <Icon>{I.retry}</Icon>
                      </button>
                      <button
                        type="button"
                        className="oa-s-icon-btn danger"
                        aria-label={t("settings.webhooks.actionDelete")}
                      >
                        <Icon>{I.trash}</Icon>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// API keys card
// TODO(backend): API key CRUD not in /organization type.
// Static display from mockup.
// ════════════════════════════════════════════════════════════════
function ApiKeysCard() {
  const { t } = useTranslation();

  const keys = [
    {
      id: "prod",
      iconBg: undefined as string | undefined,
      iconColor: undefined as string | undefined,
      icon: I.lock,
      name: "مفتاح إنتاج رئيسي",
      scopes: [
        { label: t("settings.api.scopeRead"), cls: "" },
        { label: t("settings.api.scopeWrite"), cls: "write" },
      ],
      meta: "أُنشئ في ربيع الأوّل ١٤٤٦ · آخر استخدام قبل ٣ دقائق · أنشأه سامح ع.",
      secret: "rfqa_live_•••••••••••••••••••••",
      secretSuffix: "a92F",
    },
    {
      id: "mcp",
      iconBg: "var(--info-50)",
      iconColor: "var(--info-700)",
      icon: I.aiBox,
      name: "MCP Server — Claude",
      scopes: [{ label: t("settings.api.scopeRead"), cls: "" }],
      meta: "للأتمتة عبر Claude · مقروء فقط · آخر استخدام قبل ١٢ دقيقة",
      secret: "rfqa_mcp_•••••••••••••••••••••",
      secretSuffix: "b14X",
    },
    {
      id: "dev",
      iconBg: "var(--warning-50)",
      iconColor: "var(--warning-700)",
      icon: I.alert,
      name: "مفتاح تطوير — الفريق الفنّي",
      scopes: [{ label: t("settings.api.scopeTestOnly"), cls: "test" }],
      meta: "للبيئة التجريبيّة · ينتهي في ١٥ ذو الحجّة ١٤٤٦",
      secret: "rfqa_test_•••••••••••••••••••••",
      secretSuffix: "c44Z",
    },
  ];

  return (
    <section className="oa-s-card" aria-labelledby="api-heading">
      <header className="oa-s-card-head">
        <div>
          <h3 id="api-heading">{t("settings.api.title")}</h3>
          <p>{t("settings.api.description")}</p>
        </div>
        {/* TODO(backend): API key creation endpoint not available */}
        <button type="button" className="oa-s-btn-primary" disabled title="— TODO(backend)">
          <Icon>{I.plus}</Icon>
          {t("settings.api.createKey")}
        </button>
      </header>
      <div className="oa-s-card-body">
        {/* TODO(backend): API key list not exposed; static mock data shown */}
        <div className="oa-s-key-list">
          {keys.map((k) => (
            <article key={k.id} className="oa-s-key-row">
              <div
                className="oa-s-key-icon"
                style={
                  k.iconBg
                    ? { background: k.iconBg, color: k.iconColor }
                    : undefined
                }
                aria-hidden="true"
              >
                <Icon className="oa-s-icon">{k.icon}</Icon>
              </div>
              <div className="oa-s-key-info">
                <div className="nm">
                  {k.name}
                  {k.scopes.map((s) => (
                    <span key={s.label} className={`oa-s-scope-chip ${s.cls}`}>
                      {s.label}
                    </span>
                  ))}
                </div>
                <div className="meta">{k.meta}</div>
              </div>
              <div className="oa-s-key-secret" aria-label="API key (masked)">
                {k.secret}
                <span>{k.secretSuffix}</span>
              </div>
              <div className="oa-s-key-actions">
                <button
                  type="button"
                  className="oa-s-icon-btn"
                  aria-label={t("settings.api.actionCopy")}
                >
                  <Icon>{I.copy}</Icon>
                </button>
                <button
                  type="button"
                  className="oa-s-icon-btn"
                  aria-label={t("settings.api.actionView")}
                >
                  <Icon>{I.eye}</Icon>
                </button>
                <button
                  type="button"
                  className="oa-s-icon-btn danger"
                  aria-label={t("settings.api.actionRevoke")}
                >
                  <Icon>{I.revoke}</Icon>
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// Danger zone card
// TODO(backend): freeze/transfer/delete/export endpoints not exposed
// ════════════════════════════════════════════════════════════════
function DangerZoneCard() {
  const { t } = useTranslation();

  return (
    <section className="oa-s-danger-card" aria-labelledby="danger-heading">
      <header className="oa-s-card-head">
        <div>
          <h3 id="danger-heading">{t("settings.danger.title")}</h3>
          <p>{t("settings.danger.description")}</p>
        </div>
      </header>
      <div className="oa-s-card-body">

        {/* Export — TODO(backend): data export endpoint not available */}
        <div className="oa-s-danger-action">
          <div className="oa-s-da-text">
            <div className="nm">{t("settings.danger.exportTitle")}</div>
            <div className="sub">{t("settings.danger.exportDesc")}</div>
          </div>
          <button type="button" className="oa-s-btn-secondary" disabled title="— TODO(backend)">
            {t("settings.danger.exportAction")}
          </button>
        </div>

        {/* Freeze — TODO(backend): org freeze endpoint not available */}
        <div className="oa-s-danger-action">
          <div className="oa-s-da-text">
            <div className="nm">{t("settings.danger.freezeTitle")}</div>
            <div className="sub">{t("settings.danger.freezeDesc")}</div>
          </div>
          <button type="button" className="oa-s-btn-warn" disabled title="— TODO(backend)">
            {t("settings.danger.freezeAction")}
          </button>
        </div>

        {/* Transfer — TODO(backend): org transfer endpoint not available */}
        <div className="oa-s-danger-action">
          <div className="oa-s-da-text">
            <div className="nm">{t("settings.danger.transferTitle")}</div>
            <div className="sub">{t("settings.danger.transferDesc")}</div>
          </div>
          <button type="button" className="oa-s-btn-warn" disabled title="— TODO(backend)">
            {t("settings.danger.transferAction")}
          </button>
        </div>

        {/* Delete — TODO(backend): org delete endpoint not available */}
        <div className="oa-s-danger-action">
          <div className="oa-s-da-text">
            <div className="nm">{t("settings.danger.deleteTitle")}</div>
            <div className="sub">{t("settings.danger.deleteDesc", { n: 7 })}</div>
          </div>
          <button type="button" className="oa-s-btn-danger" disabled title="— TODO(backend)">
            {t("settings.danger.deleteAction")}
          </button>
        </div>

      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════
// My Account section — preserves all existing functionality
// ════════════════════════════════════════════════════════════════
function MyAccountSection() {
  const { t } = useTranslation();
  return (
    <div className="oa-s-account-section">
      <div className="oa-s-account-section-head">
        <h2>{t("settings.myAccount.title")}</h2>
        <p>{t("settings.myAccount.subtitle")}</p>
      </div>
      <ChangePasswordCard />
      <TwoFACard />
      <NotificationPreferencesCard />
    </div>
  );
}

// ── Change password ────────────────────────────────────────────
function buildSchema(t: (k: string) => string) {
  return z
    .object({
      current_password: z.string().min(1, t("common.required")),
      new_password: z.string().min(8, t("auth.passwordTooShort")),
      confirm_password: z.string().min(1, t("common.required")),
    })
    .refine((v) => v.new_password === v.confirm_password, {
      path: ["confirm_password"],
      message: "passwords do not match",
    });
}

type PwFormValues = z.infer<ReturnType<typeof buildSchema>>;

function ChangePasswordCard() {
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PwFormValues>({ resolver: zodResolver(buildSchema(t)) });

  const mut = useMutation({
    mutationFn: (v: PwFormValues) =>
      api.post("/auth/change-password", {
        current_password: v.current_password,
        new_password: v.new_password,
      }),
    onSuccess: () => {
      setSuccess(true);
      setServerError(null);
      reset();
      setTimeout(() => clear(), 1500);
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
    <div className="oa-s-account-card">
      <h3>{t("settings.changePassword")}</h3>
      <form
        onSubmit={handleSubmit((v) => {
          setSuccess(false);
          mut.mutate(v);
        })}
      >
        <PwField
          label={t("settings.currentPassword")}
          id="pw-current"
          error={errors.current_password?.message}
        >
          <input
            id="pw-current"
            type="password"
            className="oa-s-input"
            autoComplete="current-password"
            {...register("current_password")}
          />
        </PwField>
        <PwField
          label={t("settings.newPassword")}
          id="pw-new"
          error={errors.new_password?.message}
        >
          <input
            id="pw-new"
            type="password"
            className="oa-s-input"
            autoComplete="new-password"
            {...register("new_password")}
          />
        </PwField>
        <PwField
          label={t("settings.confirmPassword")}
          id="pw-confirm"
          error={errors.confirm_password?.message}
        >
          <input
            id="pw-confirm"
            type="password"
            className="oa-s-input"
            autoComplete="new-password"
            {...register("confirm_password")}
          />
        </PwField>

        {serverError && (
          <div className="oa-s-alert-error" role="alert">
            {serverError}
          </div>
        )}
        {success && (
          <div className="oa-s-alert-success" role="status">
            {t("settings.changedSuccess")}
          </div>
        )}

        <button type="submit" className="oa-s-btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </div>
  );
}

function PwField({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="oa-s-pw-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

// ── 2FA ────────────────────────────────────────────────────────
function TwoFACard() {
  const { t } = useTranslation();
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const enroll = useMutation({
    mutationFn: enroll2FA,
    onSuccess: (data) =>
      setEnrollment({ secret: data.secret, uri: data.otpauth_uri }),
    onError: (err) => {
      if (err instanceof AxiosError)
        toast.error(err.response?.data?.detail ?? "2FA failed");
    },
  });
  const verify = useMutation({
    mutationFn: (c: string) => verify2FA(c),
    onSuccess: (data) => {
      setBackupCodes(data.backup_codes);
      setEnrollment(null);
      setCode("");
      toast.success(t("settings.twofaEnabled"));
    },
    onError: () => toast.error(t("settings.twofaInvalidCode")),
  });
  const disable = useMutation({
    mutationFn: (c: string) => disable2FA(c),
    onSuccess: () => {
      setBackupCodes(null);
      setCode("");
      toast.success(t("settings.twofaDisabled"));
    },
    onError: () => toast.error(t("settings.twofaInvalidCode")),
  });

  return (
    <div className="oa-s-account-card">
      <h3>{t("settings.twofa")}</h3>

      {!enrollment && !backupCodes && (
        <>
          <p className="desc">{t("settings.twofaDescription")}</p>
          <button
            type="button"
            className="oa-s-btn-primary"
            onClick={() => enroll.mutate()}
            disabled={enroll.isPending}
          >
            {t("settings.twofaEnroll")}
          </button>
        </>
      )}

      {enrollment && (
        <div>
          <p className="desc">{t("settings.twofaScanInstruction")}</p>
          <pre className="oa-s-mono-block">{enrollment.uri}</pre>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            {t("settings.twofaSecret")}:{" "}
            <code className="oa-s-mono-block" style={{ display: "inline", padding: "2px 6px" }}>
              {enrollment.secret}
            </code>
          </p>
          <div className="oa-s-inline-form">
            <input
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
              aria-label="TOTP code"
            />
            <button
              type="button"
              className="oa-s-btn-primary"
              onClick={() => verify.mutate(code)}
              disabled={code.length < 6 || verify.isPending}
            >
              {t("settings.twofaVerify")}
            </button>
          </div>
        </div>
      )}

      {backupCodes && (
        <div>
          <div className="oa-s-alert-warn" role="alert">
            {t("settings.twofaBackupWarning")}
          </div>
          <pre className="oa-s-mono-block">
            <div className="oa-s-backup-grid">
              {backupCodes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
          </pre>
          <div className="oa-s-inline-form">
            <input
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              maxLength={8}
              aria-label="TOTP code"
            />
            <button
              type="button"
              className="oa-s-btn-secondary"
              onClick={() => disable.mutate(code)}
              disabled={code.length < 6 || disable.isPending}
            >
              {t("settings.twofaDisable")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Notification preferences ───────────────────────────────────
function NotificationPreferencesCard() {
  const { t } = useTranslation();
  const { data: user } = useCurrentUser();
  const prefs = user?.notification_preferences;

  const mut = useMutation({
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      updateNotificationPreferences(patch),
    onSuccess: () => toast.success(t("settings.notificationsSaved")),
    onError: () => toast.error(t("common.createError")),
  });

  if (!prefs) {
    return (
      <div className="oa-s-account-card">
        <h3>{t("settings.notifications")}</h3>
        <p className="desc">{t("common.loading")}</p>
      </div>
    );
  }

  const channels: Array<keyof NotificationPreferences> = [
    "email",
    "sms",
    "whatsapp",
    "weekly_digest",
    "marketing",
  ];

  return (
    <div className="oa-s-account-card">
      <h3>{t("settings.notifications")}</h3>
      <p className="desc">{t("settings.notificationsDescription")}</p>
      <div>
        {channels.map((c) => (
          <div key={c} className="oa-s-notif-row">
            <span>{t(`settings.channels.${c}`)}</span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs[c]}
              className={`oa-s-toggle${prefs[c] ? " on" : ""}`}
              disabled={mut.isPending}
              onClick={() => mut.mutate({ [c]: !prefs[c] })}
              aria-label={t(`settings.channels.${c}`)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
