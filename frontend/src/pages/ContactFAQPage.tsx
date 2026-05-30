import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useForm } from "react-hook-form";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { SeoHead } from "@/components/public/SeoHead";
import {
  ChevronDownIcon,
  ClockIcon,
  CodeIcon,
  GithubIcon,
  HeartIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  SearchIcon,
  SendIcon,
  ShieldIcon,
  WhatsappIcon,
  XIcon,
} from "@/components/public/icons";
import { toast } from "@/store/toasts";

import "./ContactFAQPage.css";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";

/** Contact form shape (mirrors the in-component zod schema). */
type ContactForm = {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
};

/** Subject options — keyed to i18n so values stay in ar/en parity. */
const SUBJECT_KEYS = [
  "subjectSponsorship",
  "subjectPayment",
  "subjectTechnical",
  "subjectPartnership",
  "subjectContribute",
  "subjectMedia",
  "subjectOther",
] as const;

/** FAQ groups + their Q/A key suffixes, sourced from the W-06 mockup. */
const FAQ_GROUPS = [
  { title: "g1Title", Icon: HeartIcon, items: ["g1q1", "g1q2", "g1q3", "g1q4"] },
  { title: "g2Title", Icon: CodeIcon, items: ["g2q1", "g2q2", "g2q3", "g2q4"] },
  { title: "g3Title", Icon: ShieldIcon, items: ["g3q1", "g3q2", "g3q3"] },
  { title: "g4Title", Icon: CodeIcon, items: ["g4q1", "g4q2", "g4q3"] },
] as const;

/**
 * W-06 — Contact + FAQ (/contact). Pixel-matches the W-06 mockup:
 * contact channels, a zod-validated contact form, supporting info cards,
 * a searchable/filterable FAQ accordion, and a closing note.
 *
 * The contact form has no backend yet: on a valid submit we acknowledge
 * the message client-side (toast + reset). See the TODO in onSubmit for
 * the future POST /public/contact wiring. Rendered inside
 * PublicSiteLayout — content only (shared nav/footer come from layout).
 */
export function ContactFAQPage() {
  const { t, i18n } = useTranslation();

  const schema = z.object({
    name: z.string().min(2, t("public.contact.form.nameMin")),
    email: z
      .string()
      .min(1, t("public.contact.form.required"))
      .email(t("public.contact.form.emailInvalid")),
    phone: z.string().optional(),
    subject: z.string().min(1, t("public.contact.form.required")),
    message: z
      .string()
      .min(10, t("public.contact.form.messageMin"))
      .max(2000, t("public.contact.form.messageMax")),
  }) satisfies z.ZodType<ContactForm>;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactForm>({
    resolver: zodResolver(schema),
    defaultValues: { subject: t("public.contact.form.subjectSponsorship") },
  });

  const onSubmit = (data: ContactForm) => {
    // TODO(public): POST this to a future backend endpoint
    // (e.g. POST /public/contact). No such endpoint exists yet, so we
    // acknowledge the submission client-side only — nothing is sent.
    void data;
    toast.success(t("public.contact.form.success"));
    reset();
  };

  const fmt = (n: number) => n.toLocaleString(i18n.language, { maximumFractionDigits: 0 });

  return (
    <div className="cf-root">
      <SeoHead
        titleKey="public.contact.meta.title"
        descriptionKey="public.contact.meta.description"
      />

      {/* HERO */}
      <section className="cf-hero" aria-labelledby="cf-hero-title">
        <div className="cf-container cf-hero-inner">
          <span className="cf-eyebrow">
            <span className="cf-dot" aria-hidden="true" />
            {t("public.contact.hero.eyebrow")}
          </span>
          <h1 className="cf-hero-title" id="cf-hero-title">
            {t("public.contact.hero.title")}{" "}
            <span className="cf-accent">{t("public.contact.hero.titleAccent")}</span>
          </h1>
          <p className="cf-hero-sub">{t("public.contact.hero.subtitle")}</p>
        </div>
      </section>

      <ChannelsSection />
      <ContactSection
        register={register}
        errors={errors}
        isSubmitting={isSubmitting}
        onSubmit={handleSubmit(onSubmit)}
      />
      <FaqSection fmt={fmt} />
      <NoteSection />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Channels
// ════════════════════════════════════════════════════════════════════
function ChannelsSection() {
  const { t } = useTranslation();

  const channels: {
    key: string;
    href: string;
    Icon: ComponentType<{ className?: string }>;
    iconClass: string;
    external?: boolean;
    ariaLabel?: boolean;
  }[] = [
    { key: "whatsapp", href: "#", Icon: WhatsappIcon, iconClass: "cf-ic-green", ariaLabel: true },
    { key: "email", href: "mailto:hello@rufaqaa.app", Icon: MailIcon, iconClass: "cf-ic-tranquil" },
    {
      key: "github",
      href: `${REPO_URL}/issues`,
      Icon: GithubIcon,
      iconClass: "cf-ic-dark",
      external: true,
    },
    { key: "telegram", href: "#", Icon: SendIcon, iconClass: "cf-ic-tranquil2" },
    { key: "x", href: "#", Icon: XIcon, iconClass: "cf-ic-snow" },
  ];

  return (
    <section className="cf-channels" aria-labelledby="cf-channels-title">
      <h2 className="cf-sr-only" id="cf-channels-title">
        {t("public.contact.channels.heading")}
      </h2>
      <div className="cf-container">
        <div className="cf-channels-grid">
          {channels.map(({ key, href, Icon, iconClass, external, ariaLabel }) => (
            <a
              key={key}
              className="cf-channel-card"
              href={href}
              {...(ariaLabel ? { "aria-label": t(`public.contact.channels.${key}Name`) } : {})}
              {...(external ? { rel: "noopener", target: "_blank" } : {})}
            >
              <span className={`cf-channel-icon ${iconClass}`} aria-hidden="true">
                <Icon className="cf-icon cf-icon-lg" />
              </span>
              <span className="cf-channel-label">{t(`public.contact.channels.${key}Label`)}</span>
              <span className="cf-channel-name">{t(`public.contact.channels.${key}Name`)}</span>
              <span className="cf-channel-value cf-latin" dir="ltr">
                {t(`public.contact.channels.${key}Value`)}
              </span>
              <span className="cf-channel-meta">{t(`public.contact.channels.${key}Meta`)}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Contact form + info
// ════════════════════════════════════════════════════════════════════
function ContactSection({
  register,
  errors,
  isSubmitting,
  onSubmit,
}: {
  register: UseFormRegister<ContactForm>;
  errors: FieldErrors<ContactForm>;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="cf-contact" aria-labelledby="cf-contact-title">
      <div className="cf-container">
        <div className="cf-contact-grid">
          <form className="cf-form-card" noValidate onSubmit={onSubmit} aria-labelledby="cf-contact-title">
            <div className="cf-form-head">
              <h2 className="cf-form-title" id="cf-contact-title">
                {t("public.contact.form.title")}
              </h2>
              <p className="cf-form-sub">{t("public.contact.form.subtitle")}</p>
            </div>

            <div className="cf-form-row">
              <div className="cf-field">
                <label className="cf-field-label" htmlFor="cf-name">
                  {t("public.contact.form.name")} <span className="cf-field-required">*</span>
                </label>
                <input
                  className="cf-field-input"
                  id="cf-name"
                  type="text"
                  placeholder={t("public.contact.form.namePlaceholder")}
                  aria-invalid={!!errors.name}
                  {...register("name")}
                />
                {errors.name?.message ? <p className="cf-field-err">{errors.name.message}</p> : null}
              </div>
              <div className="cf-field">
                <label className="cf-field-label" htmlFor="cf-email">
                  {t("public.contact.form.email")} <span className="cf-field-required">*</span>
                </label>
                <input
                  className="cf-field-input cf-latin"
                  id="cf-email"
                  type="email"
                  dir="ltr"
                  placeholder={t("public.contact.form.emailPlaceholder")}
                  aria-invalid={!!errors.email}
                  {...register("email")}
                />
                {errors.email?.message ? (
                  <p className="cf-field-err">{errors.email.message}</p>
                ) : null}
              </div>
            </div>

            <div className="cf-form-row">
              <div className="cf-field">
                <label className="cf-field-label" htmlFor="cf-phone">
                  {t("public.contact.form.phone")}{" "}
                  <span className="cf-field-optional">{t("public.contact.form.phoneOptional")}</span>
                </label>
                <input
                  className="cf-field-input cf-latin"
                  id="cf-phone"
                  type="tel"
                  dir="ltr"
                  placeholder="+965 ..."
                  {...register("phone")}
                />
              </div>
              <div className="cf-field">
                <label className="cf-field-label" htmlFor="cf-subject">
                  {t("public.contact.form.subject")} <span className="cf-field-required">*</span>
                </label>
                <select
                  className="cf-field-select"
                  id="cf-subject"
                  aria-invalid={!!errors.subject}
                  {...register("subject")}
                >
                  {SUBJECT_KEYS.map((s) => (
                    <option key={s} value={t(`public.contact.form.${s}`)}>
                      {t(`public.contact.form.${s}`)}
                    </option>
                  ))}
                </select>
                {errors.subject?.message ? (
                  <p className="cf-field-err">{errors.subject.message}</p>
                ) : null}
              </div>
            </div>

            <div className="cf-field">
              <label className="cf-field-label" htmlFor="cf-message">
                {t("public.contact.form.message")} <span className="cf-field-required">*</span>
              </label>
              <textarea
                className="cf-field-textarea"
                id="cf-message"
                rows={6}
                placeholder={t("public.contact.form.messagePlaceholder")}
                aria-invalid={!!errors.message}
                {...register("message")}
              />
              {errors.message?.message ? (
                <p className="cf-field-err">{errors.message.message}</p>
              ) : (
                <span className="cf-field-help">{t("public.contact.form.messageHelp")}</span>
              )}
            </div>

            <div className="cf-form-actions">
              <button className="cf-btn cf-btn-primary cf-btn-lg" type="submit" disabled={isSubmitting}>
                <SendIcon className="cf-icon cf-icon-sm" />
                {t("public.contact.form.submit")}
              </button>
              <span className="cf-form-privacy">
                <LockIcon className="cf-icon cf-icon-sm" />
                {t("public.contact.form.privacy")}
              </span>
            </div>
          </form>

          <aside className="cf-info-list" aria-label={t("public.contact.info.hoursTitle")}>
            <div className="cf-info-card">
              <div className="cf-info-card-head">
                <ClockIcon className="cf-icon cf-icon-sm" />
                {t("public.contact.info.hoursTitle")}
              </div>
              <dl className="cf-info-card-body">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="cf-row">
                    <dt className="cf-day">{t(`public.contact.info.hoursDays${n}`)}</dt>
                    <dd className="cf-time cf-latin" dir="ltr">
                      {t(`public.contact.info.hoursTime${n}`)}
                    </dd>
                  </div>
                ))}
                <p className="cf-info-note">{t("public.contact.info.hoursTz")}</p>
              </dl>
            </div>

            <div className="cf-info-card">
              <div className="cf-info-card-head">
                <MapPinIcon className="cf-icon cf-icon-sm" />
                {t("public.contact.info.addressTitle")}
              </div>
              <p className="cf-info-card-body">{t("public.contact.info.addressBody")}</p>
            </div>

            <div className="cf-info-card">
              <div className="cf-info-card-head">
                <InfoIcon className="cf-icon cf-icon-sm" />
                {t("public.contact.info.urgentTitle")}
              </div>
              <p className="cf-info-card-body">{t("public.contact.info.urgentBody")}</p>
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// FAQ — searchable + category-filterable accordion
// ════════════════════════════════════════════════════════════════════
function FaqSection({ fmt }: { fmt: (n: number) => string }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const searchId = useId();

  const totalCount = useMemo(
    () => FAQ_GROUPS.reduce((sum, g) => sum + g.items.length, 0),
    [],
  );

  const normalizedQuery = query.trim().toLowerCase();

  // Filter by active category, then by free-text search across Q + A.
  const groups = useMemo(() => {
    return FAQ_GROUPS.map((group) => {
      const items = group.items.filter((q) => {
        if (!normalizedQuery) return true;
        const a = q.replace("q", "a");
        const text = `${t(`public.contact.faq.${q}`)} ${t(`public.contact.faq.${a}`)}`.toLowerCase();
        return text.includes(normalizedQuery);
      });
      return { ...group, visible: items };
    }).filter((g) => (activeCat ? g.title === activeCat : true));
  }, [normalizedQuery, activeCat, t]);

  const noResults = groups.every((g) => g.visible.length === 0);

  return (
    <section className="cf-faq" aria-labelledby="cf-faq-title">
      <div className="cf-container">
        <div className="cf-faq-head">
          <span className="cf-eyebrow">{t("public.contact.faq.eyebrow")}</span>
          <h2 className="cf-section-title" id="cf-faq-title">
            {t("public.contact.faq.title")}{" "}
            <span className="cf-accent-text">{t("public.contact.faq.titleAccent")}</span>
          </h2>
          <p className="cf-section-lede">{t("public.contact.faq.lede")}</p>

          <div className="cf-faq-search">
            <SearchIcon className="cf-icon cf-faq-search-icon" />
            <label className="cf-sr-only" htmlFor={searchId}>
              {t("public.contact.faq.searchPlaceholder")}
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("public.contact.faq.searchPlaceholder")}
            />
          </div>
        </div>

        <div className="cf-faq-cats" role="group" aria-label={t("public.contact.faq.eyebrow")}>
          <button
            type="button"
            className={`cf-faq-cat${activeCat === null ? " cf-active" : ""}`}
            aria-pressed={activeCat === null}
            onClick={() => setActiveCat(null)}
          >
            {t("public.contact.faq.catAll")}{" "}
            <span className="cf-latin">{fmt(totalCount)}</span>
          </button>
          {FAQ_GROUPS.map((g) => (
            <button
              key={g.title}
              type="button"
              className={`cf-faq-cat${activeCat === g.title ? " cf-active" : ""}`}
              aria-pressed={activeCat === g.title}
              onClick={() => setActiveCat(g.title)}
            >
              {t(`public.contact.faq.${g.title}`)}{" "}
              <span className="cf-latin">{fmt(g.items.length)}</span>
            </button>
          ))}
        </div>

        {noResults ? (
          <p className="cf-faq-empty">{t("public.contact.faq.noResults")}</p>
        ) : (
          <div className="cf-faq-groups">
            {groups.map(
              (group) =>
                group.visible.length > 0 && (
                  <div key={group.title} className="cf-faq-group">
                    <h3 className="cf-faq-group-title">
                      <group.Icon className="cf-icon" />
                      {t(`public.contact.faq.${group.title}`)}{" "}
                      <span className="cf-count cf-latin">{fmt(group.visible.length)}</span>
                    </h3>
                    <div className="cf-faq-list">
                      {group.visible.map((q) => (
                        <FaqItem key={q} q={q} defaultOpen={q === FAQ_GROUPS[0].items[0]} />
                      ))}
                    </div>
                  </div>
                ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function FaqItem({ q, defaultOpen = false }: { q: string; defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const a = q.replace("q", "a");
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`cf-faq-item${open ? " cf-open" : ""}`}>
      <button
        type="button"
        className="cf-faq-q"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t(`public.contact.faq.${q}`)}</span>
        <span className="cf-faq-q-icon" aria-hidden="true">
          <ChevronDownIcon className="cf-icon cf-icon-sm" />
        </span>
      </button>
      <div className="cf-faq-a" id={panelId} role="region" hidden={!open}>
        {t(`public.contact.faq.${a}`)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Closing note
// ════════════════════════════════════════════════════════════════════
function NoteSection(): ReactNode {
  const { t } = useTranslation();
  return (
    <section className="cf-contact-note">
      <div className="cf-container">
        <div className="cf-contact-note-card">
          <span className="cf-contact-note-icon" aria-hidden="true">
            <WhatsappIcon className="cf-icon cf-icon-lg" />
          </span>
          <h2 className="cf-contact-note-title">{t("public.contact.note.title")}</h2>
          <p className="cf-contact-note-body">{t("public.contact.note.body")}</p>
          <a className="cf-btn cf-btn-primary cf-btn-lg" href="#">
            <WhatsappIcon className="cf-icon" />
            {t("public.contact.note.whatsapp")}
          </a>
        </div>
      </div>
    </section>
  );
}
