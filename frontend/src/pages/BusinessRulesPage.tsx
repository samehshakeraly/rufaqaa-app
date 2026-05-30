/**
 * OA-05 Business Rules
 * Pixel-parity port of /tmp/mockup-oa05.html.
 *
 * Data wiring:
 *  - `default_currency` sourced from /organization via organization.ts.
 *  - Everything else is presentational (no business-rules API exists yet).
 *    Each unsourced control is rendered read-only / disabled and marked
 *    with a TODO(backend) comment.
 *
 * i18n: uses the single `translation` namespace with `businessRules.*` keys.
 *   New keys to merge into en.json/ar.json are in /tmp/i18n/businessRules.{en,ar}.json.
 */

import { useState, useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fetchOrganization } from "@/lib/organization";

import "./BusinessRulesPage.css";

// ── Inline icon primitives ───────────────────────────────────────────
function Icon({
  children,
  className = "oa-rules-icon",
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
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
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
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  house: (
    <>
      <path d="M3 11l9-8 9 8M5 9.5V21h14V9.5" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M5 21v-1a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v1" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  code: (
    <>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>
  ),
  pencil: (
    <>
      <path d="M14 9 19 4 22 7 17 12" />
      <path d="M5 16l-2 2 4 4 2-2" />
      <line x1="9" y1="14" x2="14" y2="9" />
    </>
  ),
} as const;

// ── Toggle component ─────────────────────────────────────────────────
function Toggle({
  pressed,
  onChange,
  label,
  disabled = false,
}: {
  pressed: boolean;
  onChange?: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      className={`oa-rules-toggle${pressed ? " on" : ""}`}
      disabled={disabled}
      onClick={disabled ? undefined : () => onChange?.(!pressed)}
    />
  );
}

// ── Stepper component ────────────────────────────────────────────────
function Stepper({
  value,
  unit,
  onChange,
  min = 0,
  disabled = false,
  decLabel = "−",
  incLabel = "+",
}: {
  value: number;
  unit: string;
  onChange?: (v: number) => void;
  min?: number;
  disabled?: boolean;
  decLabel?: string;
  incLabel?: string;
}) {
  return (
    <div className="oa-rules-row-control">
      <div className="oa-rules-stepper">
        <button
          type="button"
          aria-label={decLabel}
          onClick={() => onChange?.(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
        >
          −
        </button>
        <span className="oa-rules-stepper-val latin">{value}</span>
        <button
          type="button"
          aria-label={incLabel}
          onClick={() => onChange?.(value + 1)}
          disabled={disabled}
        >
          +
        </button>
      </div>
      <span className="oa-rules-stepper-unit">{unit}</span>
    </div>
  );
}

// ── Choice strip ─────────────────────────────────────────────────────
function ChoiceStrip({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { value: string; label: ReactNode }[];
  value: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="oa-rules-choice-strip" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          className={`oa-rules-choice${opt.value === value ? " active" : ""}`}
          onClick={() => !disabled && onChange?.(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── MultiSelect chip bar ─────────────────────────────────────────────
function MultiSelect({
  options,
  selected,
  onToggle,
  disabled = false,
}: {
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="oa-rules-multi-select">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={selected.has(opt.value)}
          className={`oa-rules-ms-btn${selected.has(opt.value) ? " active" : ""}`}
          onClick={() => !disabled && onToggle?.(opt.value)}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Section card ─────────────────────────────────────────────────────
function RuleSection({
  id,
  icon,
  iconVariant,
  heading,
  desc,
  hasUnsaved = false,
  children,
}: {
  id: string;
  icon: ReactNode;
  iconVariant: string;
  heading: string;
  desc: ReactNode;
  hasUnsaved?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="oa-rules-section" id={id}>
      <header className="oa-rules-section-head">
        <div className={`oa-rules-section-icon ${iconVariant}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {icon}
          </svg>
        </div>
        <div className="oa-rules-section-meta">
          <h3>{heading}</h3>
          <p>{desc}</p>
        </div>
        {hasUnsaved && (
          <span className="oa-rules-section-flag" aria-live="polite">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {t("businessRules.unsavedFlag")}
          </span>
        )}
      </header>
      <div className="oa-rules-section-body">{children}</div>
    </section>
  );
}

// ── Rule row ─────────────────────────────────────────────────────────
function RuleRow({
  title,
  desc,
  pill,
  pillReq = false,
  changed = false,
  wasLabel,
  nowLabel,
  control,
}: {
  title: ReactNode;
  desc?: ReactNode;
  pill?: string;
  pillReq?: boolean;
  changed?: boolean;
  wasLabel?: string;
  nowLabel?: string;
  control: ReactNode;
}) {
  return (
    <div className={`oa-rules-row${changed ? " changed" : ""}`}>
      <div className="oa-rules-row-text">
        <div className="oa-rules-row-title">
          {changed && <span className="oa-rules-changed-dot" aria-hidden="true" />}
          {title}
          {pill && (
            <span className={`oa-rules-pill${pillReq ? " req" : ""}`}>{pill}</span>
          )}
        </div>
        {desc && (
          <div className="oa-rules-row-desc">
            {desc}
            {wasLabel && nowLabel && (
              <span className="oa-rules-was">
                <span className="was-val">{wasLabel}</span>
                {nowLabel}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="oa-rules-row-control">{control}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Main page
// ════════════════════════════════════════════════════════════════════
export function BusinessRulesPage() {
  const { t: tRaw } = useTranslation();
  // Convenience: all keys for this page live under the `businessRules` prefix
  // in the shared en.json / ar.json translation namespace.
  const t = (key: string, opts?: Record<string, unknown>) =>
    tRaw(`businessRules.${key}`, opts);

  // ── Real data: default currency from /organization ───────────────
  const orgQuery = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
  });
  const orgName = orgQuery.data?.name_ar ?? orgQuery.data?.name_en ?? "—";
  // TODO(backend): default_currency used in JSON preview only; no
  // dedicated business-rules endpoint exists.
  const defaultCurrency = orgQuery.data?.default_currency ?? "KWD";

  // ── Section 1: Assign ────────────────────────────────────────────
  // TODO(backend): no channel-assignment-duration field in /organization
  const [assignDuration, setAssignDuration] = useState(120);
  // TODO(backend): no expiry-warning-days field in /organization
  const [expiryWarning, setExpiryWarning] = useState<string>("10");
  // TODO(backend): no auto-return-enabled field in /organization
  const [autoReturn, setAutoReturn] = useState(true);
  // TODO(backend): no multi-channel-assign field in /organization
  const [multiChannel, setMultiChannel] = useState(false);

  // ── Section 2: Payment ───────────────────────────────────────────
  // TODO(backend): no payment-delay thresholds in /organization
  const [mildDays, setMildDays] = useState(7);
  const [moderateDays, setModerateDays] = useState(30);
  const [suspendDays, setSuspendDays] = useState(90);
  // TODO(backend): no reminder-channels field in /organization
  const [reminderChannels, setReminderChannels] = useState(
    new Set(["email", "whatsapp"])
  );
  // TODO(backend): no self-deferral toggle in /organization
  const [deferral, setDeferral] = useState(true);

  // ── Section 3: Orphan lifecycle ──────────────────────────────────
  // TODO(backend): no min-orphan-age field in /organization
  const [minOrphanAge, setMinOrphanAge] = useState(12);
  // TODO(backend): no graduation-age field in /organization
  const [graduationAge, setGraduationAge] = useState(18);
  // TODO(backend): no university-extension toggle in /organization
  const [universityExt, setUniversityExt] = useState(true);
  // TODO(backend): no graduation-notice-months field in /organization
  const [gradNotice, setGradNotice] = useState<string>("6months");

  // ── Section 4: Reports ───────────────────────────────────────────
  // TODO(backend): no report-frequency field in /organization
  const [reportFreq, setReportFreq] = useState("bimonthly");
  // TODO(backend): no require-photo toggle in /organization
  const [requirePhoto, setRequirePhoto] = useState(true);
  // TODO(backend): no reminder-days-before field in /organization
  const [reminderDays, setReminderDays] = useState(5);
  // TODO(backend): no accept-voice-note toggle in /organization
  const [acceptVoice, setAcceptVoice] = useState(true);
  // TODO(backend): no auto-notify-donor toggle in /organization
  const [notifyDonor, setNotifyDonor] = useState(true);

  // ── Section 5: Approval rules ────────────────────────────────────
  // TODO(backend): no approval-workflow fields in /organization
  const [newOrphanApproval, setNewOrphanApproval] = useState("staffManager");
  const [reportApproval, setReportApproval] = useState("staffOnly");
  const [mediaApproval, setMediaApproval] = useState("aiStaff");
  const [bankApproval, setBankApproval] = useState("financeManagerOrg");
  const [msgApproval, setMsgApproval] = useState("aiStaff");

  // ── Section 6: Guardian visibility ──────────────────────────────
  // TODO(backend): no guardian-visibility fields in /organization
  const [showCountry, setShowCountry] = useState(true);
  const [showDuration, setShowDuration] = useState(true);
  const [reportDetail, setReportDetail] = useState("last6");

  // ── Active TOC section ───────────────────────────────────────────
  const [activeSection, setActiveSection] = useState("sec-assign");

  const scrollTo = useCallback((id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const toggleReminderChannel = useCallback((ch: string) => {
    setReminderChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  }, []);

  // ── Unsaved sections (mockup shows assign + orphan flagged) ──────
  // assignDuration starts at 120 (mockup "was:90, now:120") → changed = true
  // minOrphanAge starts at 12 (mockup "was:14, now:12") → changed = true
  const tocSections = [
    { id: "sec-assign",     icon: ICONS.house,    label: t("toc.assign"),     changed: true },
    { id: "sec-payment",    icon: ICONS.creditCard,label: t("toc.payment"),   changed: false },
    { id: "sec-orphan",     icon: ICONS.user,      label: t("toc.orphan"),    changed: true },
    { id: "sec-report",     icon: ICONS.fileText,  label: t("toc.report"),    changed: false },
    { id: "sec-approval",   icon: ICONS.check,     label: t("toc.approval"),  changed: false },
    { id: "sec-visibility", icon: ICONS.eye,       label: t("toc.visibility"),changed: false },
    { id: "sec-custom",     icon: ICONS.code,      label: t("toc.custom"),    changed: false },
  ] as const;

  return (
    <div className="oa-rules">
      {/* Single semantic h1 — visually hidden; page heading shown in topbar h2 */}
      <h1 className="sr-only">{t("title")}</h1>

      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <div className="oa-rules-topbar">
        <div className="oa-rules-topbar-title">
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
        </div>
        <div className="oa-rules-topbar-actions">
          {/* TODO(backend): last-edit metadata not yet exposed by /organization */}
          <span className="oa-rules-last-edit">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {t("lastEdit", { days: "3", name: "—" })}
          </span>
          {/* TODO(backend): no audit-log API integration yet */}
          <button type="button" className="oa-rules-btn-secondary" disabled>
            <Icon className="oa-rules-icon-sm">{ICONS.file}</Icon>
            {t("viewLog")}
          </button>
        </div>
      </div>

      {/* ── Page grid ──────────────────────────────────────────────── */}
      <div className="oa-rules-page">

        {/* ── TOC ──────────────────────────────────────────────────── */}
        <nav className="oa-rules-toc" aria-label={t("toc.heading")}>
          <h4>{t("toc.heading")}</h4>
          <div className="oa-rules-toc-list">
            {tocSections.map(({ id, icon, label, changed }) => (
              <button
                key={id}
                type="button"
                className={`oa-rules-toc-link${activeSection === id ? " active" : ""}`}
                onClick={() => scrollTo(id)}
                aria-current={activeSection === id ? "location" : undefined}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {icon}
                </svg>
                {label}
                {changed && <span className="oa-rules-toc-changed" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Content ──────────────────────────────────────────────── */}
        <div className="oa-rules-content">

          {/* Info banner */}
          <div className="oa-rules-info-banner" role="note">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <div>
              {/* Using raw string with orgName interpolated */}
              تطبق هذه القواعد على المؤسسة بأكملها (<strong>{orgName}</strong>). يمكن لكلّ جهة شريكة استثناءً محدوداً بإذن منك. أيّ تغيير يدخل حيّز التنفيذ فوراً بعد الحفظ ويُسجَّل في <strong>سجلّ التدقيق</strong>.
            </div>
          </div>

          {/* ══════════════════════════════════════════════
              1. Marketing Assignment
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-assign"
            icon={ICONS.house}
            iconVariant="assign"
            heading={t("assign.heading")}
            desc={t("assign.desc")}
            hasUnsaved={true}
          >
            {/* Default duration — mockup shows "was 90, now 120" */}
            <RuleRow
              changed={true}
              title={t("assign.defaultDuration.title")}
              desc={t("assign.defaultDuration.desc")}
              wasLabel={t("assign.defaultDuration.was", { old: 90 })}
              nowLabel={t("assign.defaultDuration.now", { new: assignDuration })}
              control={
                // TODO(backend): channel assignment duration not in /organization
                <Stepper
                  value={assignDuration}
                  unit={t("assign.defaultDuration.unit")}
                  onChange={setAssignDuration}
                  min={1}
                />
              }
            />

            {/* Expiry warning */}
            <RuleRow
              title={t("assign.expiryWarning.title")}
              desc={t("assign.expiryWarning.desc")}
              pill={t("toc.report")}
              control={
                // TODO(backend): expiry-warning-days not in /organization
                <ChoiceStrip
                  value={expiryWarning}
                  onChange={setExpiryWarning}
                  options={[
                    { value: "14", label: <>{t("assign.expiryWarning.at", { n: "" })}<span className="latin">14</span></> },
                    { value: "10", label: <>{t("assign.expiryWarning.at", { n: "" })}<span className="latin">10</span></> },
                    { value: "7",  label: <>{t("assign.expiryWarning.at", { n: "" })}<span className="latin">7</span></> },
                    { value: "3",  label: <>{t("assign.expiryWarning.at", { n: "" })}<span className="latin">3</span></> },
                  ]}
                />
              }
            />

            {/* Auto-return */}
            <RuleRow
              title={t("assign.autoReturn.title")}
              desc={t("assign.autoReturn.desc")}
              control={
                // TODO(backend): auto-return toggle not in /organization
                <Toggle
                  pressed={autoReturn}
                  onChange={setAutoReturn}
                  label={t("assign.autoReturn.title")}
                />
              }
            />

            {/* Multi-channel */}
            <RuleRow
              title={t("assign.multiChannel.title")}
              desc={t("assign.multiChannel.desc")}
              control={
                // TODO(backend): multi-channel-assign toggle not in /organization
                <Toggle
                  pressed={multiChannel}
                  onChange={setMultiChannel}
                  label={t("assign.multiChannel.title")}
                />
              }
            />

            {/* Preview banner */}
            <div className="oa-rules-preview">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 9 19 4 22 7 17 12" />
                <path d="M5 16l-2 2 4 4 2-2" />
                <line x1="9" y1="14" x2="14" y2="9" />
              </svg>
              <div>
                <strong>ملخّص بعد التغيير:</strong>{" "}
                سيكون لكلّ قناة{" "}
                <code><span className="latin">{assignDuration}</span> يوماً</code>{" "}
                للترويج لليتيم، مع تذكير عند{" "}
                <code><span className="latin">{expiryWarning}</span> أيام متبقّية</code>،
                ثم إعادة تلقائيّة للمتاحين.
              </div>
            </div>
          </RuleSection>

          {/* ══════════════════════════════════════════════
              2. Payment Delays
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-payment"
            icon={ICONS.creditCard}
            iconVariant="payment"
            heading={t("payment.heading")}
            desc={t("payment.desc")}
          >
            {/* Mild threshold */}
            <RuleRow
              title={t("payment.mildThreshold.title")}
              desc={t("payment.mildThreshold.desc")}
              control={
                // TODO(backend): mild-delay-days not in /organization
                <Stepper
                  value={mildDays}
                  unit={t("payment.mildThreshold.unit")}
                  onChange={setMildDays}
                  min={1}
                />
              }
            />

            {/* Moderate threshold */}
            <RuleRow
              title={t("payment.moderateThreshold.title")}
              desc={t("payment.moderateThreshold.desc")}
              control={
                // TODO(backend): moderate-delay-days not in /organization
                <Stepper
                  value={moderateDays}
                  unit={t("payment.moderateThreshold.unit")}
                  onChange={setModerateDays}
                  min={1}
                />
              }
            />

            {/* Suspend threshold */}
            <RuleRow
              title={t("payment.suspendThreshold.title")}
              desc={t("payment.suspendThreshold.desc")}
              pill={t("sensitive")}
              pillReq={true}
              control={
                // TODO(backend): suspension-threshold-days not in /organization
                <Stepper
                  value={suspendDays}
                  unit={t("payment.suspendThreshold.unit")}
                  onChange={setSuspendDays}
                  min={1}
                />
              }
            />

            {/* Reminder channels */}
            <RuleRow
              title={t("payment.reminderChannels.title")}
              desc={t("payment.reminderChannels.desc")}
              control={
                // TODO(backend): reminder-channels selection not in /organization
                <MultiSelect
                  selected={reminderChannels}
                  onToggle={toggleReminderChannel}
                  options={[
                    { value: "email",    label: t("payment.reminderChannels.email") },
                    { value: "whatsapp", label: t("payment.reminderChannels.whatsapp") },
                    { value: "sms",      label: t("payment.reminderChannels.sms") },
                    { value: "call",     label: t("payment.reminderChannels.call") },
                  ]}
                />
              }
            />

            {/* Deferral */}
            <RuleRow
              title={t("payment.deferral.title")}
              desc={
                <span
                  dangerouslySetInnerHTML={{
                    __html: t("payment.deferral.desc"),
                  }}
                />
              }
              control={
                // TODO(backend): self-deferral toggle not in /organization
                <Toggle
                  pressed={deferral}
                  onChange={setDeferral}
                  label={t("payment.deferral.title")}
                />
              }
            />
          </RuleSection>

          {/* ══════════════════════════════════════════════
              3. Orphan Lifecycle
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-orphan"
            icon={ICONS.user}
            iconVariant="orphan"
            heading={t("orphan.heading")}
            desc={t("orphan.desc")}
            hasUnsaved={true}
          >
            {/* Min age — mockup "was:14, now:12" */}
            <RuleRow
              changed={true}
              title={t("orphan.minAge.title")}
              desc={t("orphan.minAge.desc")}
              wasLabel={t("orphan.minAge.was", { old: 14 })}
              nowLabel={t("orphan.minAge.now", { new: minOrphanAge })}
              control={
                // TODO(backend): min-orphan-age not in /organization
                <Stepper
                  value={minOrphanAge}
                  unit={t("orphan.minAge.unit")}
                  onChange={setMinOrphanAge}
                  min={6}
                />
              }
            />

            {/* Graduation age */}
            <RuleRow
              title={t("orphan.graduationAge.title")}
              desc={t("orphan.graduationAge.desc")}
              control={
                // TODO(backend): graduation-age not in /organization
                <Stepper
                  value={graduationAge}
                  unit={t("orphan.graduationAge.unit")}
                  onChange={setGraduationAge}
                  min={14}
                />
              }
            />

            {/* University extension */}
            <RuleRow
              title={t("orphan.universityExtension.title")}
              desc={t("orphan.universityExtension.desc")}
              control={
                // TODO(backend): university-extension toggle not in /organization
                <Toggle
                  pressed={universityExt}
                  onChange={setUniversityExt}
                  label={t("orphan.universityExtension.title")}
                />
              }
            />

            {/* Graduation notice */}
            <RuleRow
              title={t("orphan.graduationNotice.title")}
              desc={t("orphan.graduationNotice.desc")}
              control={
                // TODO(backend): graduation-notice-months not in /organization
                <ChoiceStrip
                  value={gradNotice}
                  onChange={setGradNotice}
                  options={[
                    { value: "3months", label: t("orphan.graduationNotice.3months") },
                    { value: "6months", label: t("orphan.graduationNotice.6months") },
                    { value: "9months", label: t("orphan.graduationNotice.9months") },
                    { value: "1year",   label: t("orphan.graduationNotice.1year") },
                  ]}
                />
              }
            />
          </RuleSection>

          {/* ══════════════════════════════════════════════
              4. Reports
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-report"
            icon={ICONS.fileText}
            iconVariant="report"
            heading={t("report.heading")}
            desc={t("report.desc")}
          >
            {/* Report frequency */}
            <RuleRow
              title={t("report.frequency.title")}
              desc={t("report.frequency.desc")}
              control={
                // TODO(backend): report-frequency not in /organization
                <select
                  className="oa-rules-select"
                  value={reportFreq}
                  onChange={(e) => setReportFreq(e.target.value)}
                  aria-label={t("report.frequency.title")}
                >
                  <option value="monthly">{t("report.frequency.monthly")}</option>
                  <option value="bimonthly">{t("report.frequency.bimonthly")}</option>
                  <option value="quarterly">{t("report.frequency.quarterly")}</option>
                  <option value="semiannual">{t("report.frequency.semiannual")}</option>
                </select>
              }
            />

            {/* Require photo */}
            <RuleRow
              title={t("report.photo.title")}
              desc={t("report.photo.desc")}
              control={
                // TODO(backend): require-photo toggle not in /organization
                <Toggle
                  pressed={requirePhoto}
                  onChange={setRequirePhoto}
                  label={t("report.photo.title")}
                />
              }
            />

            {/* Reminder days */}
            <RuleRow
              title={t("report.reminder.title")}
              desc={t("report.reminder.desc")}
              control={
                // TODO(backend): report-reminder-days not in /organization
                <Stepper
                  value={reminderDays}
                  unit={t("report.reminder.unit")}
                  onChange={setReminderDays}
                  min={1}
                />
              }
            />

            {/* Accept voice */}
            <RuleRow
              title={t("report.voice.title")}
              desc={
                <span
                  dangerouslySetInnerHTML={{
                    __html: t("report.voice.desc"),
                  }}
                />
              }
              control={
                // TODO(backend): accept-voice-recording toggle not in /organization
                <Toggle
                  pressed={acceptVoice}
                  onChange={setAcceptVoice}
                  label={t("report.voice.title")}
                />
              }
            />

            {/* Notify donor */}
            <RuleRow
              title={t("report.notifyDonor.title")}
              desc={t("report.notifyDonor.desc")}
              control={
                // TODO(backend): auto-notify-sponsor toggle not in /organization
                <Toggle
                  pressed={notifyDonor}
                  onChange={setNotifyDonor}
                  label={t("report.notifyDonor.title")}
                />
              }
            />
          </RuleSection>

          {/* ══════════════════════════════════════════════
              5. Approval Rules
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-approval"
            icon={ICONS.check}
            iconVariant="approval"
            heading={t("approval.heading")}
            desc={t("approval.desc")}
          >
            {/* New orphan approval */}
            <RuleRow
              title={t("approval.newOrphan.title")}
              desc={t("approval.newOrphan.desc")}
              pill={t("sensitive")}
              pillReq={true}
              control={
                // TODO(backend): new-orphan-approval-level not in /organization
                <select
                  className="oa-rules-select"
                  value={newOrphanApproval}
                  onChange={(e) => setNewOrphanApproval(e.target.value)}
                  aria-label={t("approval.newOrphan.title")}
                >
                  <option value="staffOnly">{t("approval.newOrphan.staffOnly")}</option>
                  <option value="staffManager">{t("approval.newOrphan.staffManager")}</option>
                  <option value="staffManagerOrg">{t("approval.newOrphan.staffManagerOrg")}</option>
                </select>
              }
            />

            {/* Monthly reports approval */}
            <RuleRow
              title={t("approval.monthlyReports.title")}
              desc={t("approval.monthlyReports.desc")}
              control={
                // TODO(backend): monthly-report-approval-level not in /organization
                <select
                  className="oa-rules-select"
                  value={reportApproval}
                  onChange={(e) => setReportApproval(e.target.value)}
                  aria-label={t("approval.monthlyReports.title")}
                >
                  <option value="staffOnly">{t("approval.monthlyReports.staffOnly")}</option>
                  <option value="staffManager">{t("approval.monthlyReports.staffManager")}</option>
                </select>
              }
            />

            {/* Media approval */}
            <RuleRow
              title={t("approval.media.title")}
              desc={t("approval.media.desc")}
              control={
                // TODO(backend): media-approval-level not in /organization
                <select
                  className="oa-rules-select"
                  value={mediaApproval}
                  onChange={(e) => setMediaApproval(e.target.value)}
                  aria-label={t("approval.media.title")}
                >
                  <option value="aiOnly">{t("approval.media.aiOnly")}</option>
                  <option value="aiStaff">{t("approval.media.aiStaff")}</option>
                  <option value="aiStaffManager">{t("approval.media.aiStaffManager")}</option>
                </select>
              }
            />

            {/* Bank transfers approval */}
            <RuleRow
              title={t("approval.bankTransfers.title")}
              desc={t("approval.bankTransfers.desc")}
              pill={t("sensitive")}
              pillReq={true}
              control={
                // TODO(backend): bank-transfer-approval-level not in /organization
                <select
                  className="oa-rules-select"
                  value={bankApproval}
                  onChange={(e) => setBankApproval(e.target.value)}
                  aria-label={t("approval.bankTransfers.title")}
                >
                  <option value="financeManager">{t("approval.bankTransfers.financeManager")}</option>
                  <option value="financeManagerOrg">{t("approval.bankTransfers.financeManagerOrg")}</option>
                </select>
              }
            />

            {/* Donor messages approval */}
            <RuleRow
              title={t("approval.donorMessages.title")}
              desc={t("approval.donorMessages.desc")}
              control={
                // TODO(backend): donor-message-approval-level not in /organization
                <select
                  className="oa-rules-select"
                  value={msgApproval}
                  onChange={(e) => setMsgApproval(e.target.value)}
                  aria-label={t("approval.donorMessages.title")}
                >
                  <option value="aiAuto">{t("approval.donorMessages.aiAuto")}</option>
                  <option value="aiStaff">{t("approval.donorMessages.aiStaff")}</option>
                </select>
              }
            />
          </RuleSection>

          {/* ══════════════════════════════════════════════
              6. Guardian Visibility
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-visibility"
            icon={ICONS.eye}
            iconVariant="visibility"
            heading={t("visibility.heading")}
            desc={
              <span
                dangerouslySetInnerHTML={{
                  __html: t("visibility.desc"),
                }}
              />
            }
          >
            {/* Sponsorship amount — locked OFF (golden rule) */}
            <RuleRow
              title={t("visibility.amount.title")}
              desc={t("visibility.amount.desc")}
              pill={t("visibility.amount.pill")}
              pillReq={true}
              control={
                // TODO(backend): visibility.show_amount is a locked "golden rule";
                // it must always remain false and requires sharia sign-off to change.
                <Toggle
                  pressed={false}
                  label={t("visibility.amount.title")}
                  disabled={true}
                />
              }
            />

            {/* Donor name — locked OFF (golden rule) */}
            <RuleRow
              title={t("visibility.donorName.title")}
              desc={t("visibility.donorName.desc")}
              pill={t("visibility.donorName.pill")}
              pillReq={true}
              control={
                // TODO(backend): visibility.show_donor_name locked; same golden rule.
                <Toggle
                  pressed={false}
                  label={t("visibility.donorName.title")}
                  disabled={true}
                />
              }
            />

            {/* Show nationality */}
            <RuleRow
              title={t("visibility.nationality.title")}
              desc={t("visibility.nationality.desc")}
              control={
                // TODO(backend): visibility.show_sponsor_country not in /organization
                <Toggle
                  pressed={showCountry}
                  onChange={setShowCountry}
                  label={t("visibility.nationality.title")}
                />
              }
            />

            {/* Show duration */}
            <RuleRow
              title={t("visibility.duration.title")}
              desc={t("visibility.duration.desc")}
              control={
                // TODO(backend): visibility.show_sponsorship_duration not in /organization
                <Toggle
                  pressed={showDuration}
                  onChange={setShowDuration}
                  label={t("visibility.duration.title")}
                />
              }
            />

            {/* Report detail level */}
            <RuleRow
              title={t("visibility.reportDetail.title")}
              desc={t("visibility.reportDetail.desc")}
              control={
                // TODO(backend): visibility.report_history_depth not in /organization
                <select
                  className="oa-rules-select"
                  value={reportDetail}
                  onChange={(e) => setReportDetail(e.target.value)}
                  aria-label={t("visibility.reportDetail.title")}
                >
                  <option value="all">{t("visibility.reportDetail.all")}</option>
                  <option value="last6">{t("visibility.reportDetail.last6")}</option>
                  <option value="last1">{t("visibility.reportDetail.last1")}</option>
                  <option value="none">{t("visibility.reportDetail.none")}</option>
                </select>
              }
            />
          </RuleSection>

          {/* ══════════════════════════════════════════════
              7. Custom Rules (JSON editor — read-only)
              ══════════════════════════════════════════════ */}
          <RuleSection
            id="sec-custom"
            icon={ICONS.code}
            iconVariant="custom"
            heading={t("custom.heading")}
            desc={t("custom.desc")}
          >
            {/* JSON editor — presentational, read-only */}
            {/* TODO(backend): no custom-rules JSON endpoint exists yet;
                the editor is display-only showing the mockup's sample. */}
            <div className="oa-rules-json-editor" aria-label={t("custom.heading")}>
              <div className="oa-rules-json-toolbar">
                <span className="oa-rules-json-lab mono">{t("custom.fileName")}</span>
                <span className="oa-rules-json-status">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {t("custom.validJson")}
                </span>
                <div className="oa-rules-json-btns">
                  <button type="button" disabled>{t("custom.format")}</button>
                  <button type="button" disabled>{t("custom.validate")}</button>
                  <button type="button" disabled>{t("custom.fullscreen")}</button>
                </div>
              </div>
              <pre className="oa-rules-json-code" dir="ltr" tabIndex={0} role="region" aria-label={t("custom.fileName")}>
{/* The JSON is display-only; inline span highlights mimic syntax colouring */}
<span className="j-comment">{"// قواعد إضافيّة على مستوى المؤسسة"}</span>{"\n"}
{"{\n"}
{"  "}<span className="j-key">"ramadan_period"</span>{": {\n"}
{"    "}<span className="j-key">"start_hijri"</span>{": "}<span className="j-str">"1446-09-01"</span>{",\n"}
{"    "}<span className="j-key">"end_hijri"</span>{": "}<span className="j-str">"1446-09-30"</span>{",\n"}
{"    "}<span className="j-key">"boost_orphan_visibility"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"allow_one_time_zakat_donations"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"zakat_calculator_visible"</span>{": "}<span className="j-bool">true</span>{"\n"}
{"  },\n"}
{"  "}<span className="j-key">"emergency_orphan_priority"</span>{": {\n"}
{"    "}<span className="j-key">"enabled"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"max_days_visible"</span>{": "}<span className="j-num">14</span>{",\n"}
{"    "}<span className="j-key">"sort_boost"</span>{": "}<span className="j-num">100</span>{"\n"}
{"  },\n"}
{"  "}<span className="j-key">"sibling_grouping"</span>{": {\n"}
{"    "}<span className="j-key">"enabled"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"suggest_sibling_to_same_donor"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"max_suggestions_per_donor"</span>{": "}<span className="j-num">2</span>{"\n"}
{"  },\n"}
{"  "}<span className="j-key">"new_donor_welcome"</span>{": {\n"}
{"    "}<span className="j-key">"send_voice_message_from_dg"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"send_arabic_dua_card"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"delay_hours"</span>{": "}<span className="j-num">2</span>{"\n"}
{"  },\n"}
{"  "}<span className="j-key">"currency_overrides"</span>{": {\n"}
{"    "}<span className="j-key">"default"</span>{": "}<span className="j-str">{`"${defaultCurrency}"`}</span>{",\n"}
{"    "}<span className="j-key">"display_local_for_orphan"</span>{": "}<span className="j-bool">true</span>{",\n"}
{"    "}<span className="j-key">"fx_refresh_minutes"</span>{": "}<span className="j-num">60</span>{"\n"}
{"  }\n"}
{"}"}
              </pre>
            </div>

            {/* Note banner */}
            <div className="oa-rules-preview" style={{ marginTop: 14 }}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div
                dangerouslySetInnerHTML={{
                  __html: t("custom.note"),
                }}
              />
            </div>
          </RuleSection>

        </div>{/* /.oa-rules-content */}
      </div>{/* /.oa-rules-page */}
    </div>
  );
}
