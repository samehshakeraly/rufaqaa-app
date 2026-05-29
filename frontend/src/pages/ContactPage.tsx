import { zodResolver } from "@hookform/resolvers/zod";
import type { ComponentType } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { SeoHead } from "@/components/public/SeoHead";
import {
  ChevronDownIcon,
  ClockIcon,
  GithubIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  SendIcon,
  WhatsappIcon,
  XIcon,
} from "@/components/public/icons";
import { Hero, Section, SectionHead } from "@/components/public/ui";
import { toast } from "@/store/toasts";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";

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
  { title: "g1Title", items: ["g1q1", "g1q2", "g1q3", "g1q4"] },
  { title: "g2Title", items: ["g2q1", "g2q2", "g2q3", "g2q4"] },
  { title: "g3Title", items: ["g3q1", "g3q2", "g3q3"] },
  { title: "g4Title", items: ["g4q1", "g4q2", "g4q3"] },
] as const;

/**
 * W-06 — Contact + FAQ (/contact). Contact channels, a zod-validated
 * contact form, supporting info cards, an FAQ accordion, and a closing
 * note.
 *
 * The contact form has no backend yet: on a valid submit we show a
 * toast and reset. See the TODO in onSubmit for the future
 * POST /public/contact wiring.
 * Rendered inside PublicSiteLayout — content only.
 */
export function ContactPage() {
  const { t } = useTranslation();

  const schema = z.object({
    name: z.string().min(2, t("public.contact.form.nameMin")),
    email: z.string().min(1, t("public.contact.form.required")).email(t("public.contact.form.emailInvalid")),
    phone: z.string().optional(),
    subject: z.string().min(1, t("public.contact.form.required")),
    message: z
      .string()
      .min(10, t("public.contact.form.messageMin"))
      .max(2000, t("public.contact.form.messageMax")),
  });
  type ContactForm = z.infer<typeof schema>;

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

  const channels: {
    key: string;
    href: string;
    Icon: ComponentType<{ className?: string }>;
    external?: boolean;
  }[] = [
    { key: "whatsapp", href: "#", Icon: WhatsappIcon },
    { key: "email", href: "mailto:hello@rufaqaa.app", Icon: MailIcon },
    { key: "github", href: `${REPO_URL}/issues`, Icon: GithubIcon, external: true },
    { key: "telegram", href: "#", Icon: SendIcon },
    { key: "x", href: "#", Icon: XIcon },
  ];

  const fieldErr = "mt-1 text-xs text-danger-600";

  return (
    <>
      <SeoHead
        titleKey="public.contact.meta.title"
        descriptionKey="public.contact.meta.description"
      />
      <Hero
        eyebrow={
          <>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success-500" />
            {t("public.contact.hero.eyebrow")}
          </>
        }
        title={t("public.contact.hero.title")}
        titleAccent={t("public.contact.hero.titleAccent")}
        subtitle={t("public.contact.hero.subtitle")}
      />

      {/* CHANNELS */}
      <Section labelledBy="channels-title">
        <h2 id="channels-title" className="sr-only">
          {t("public.contact.channels.heading")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {channels.map(({ key, href, Icon, external }) => (
            <a
              key={key}
              href={href}
              {...(external ? { rel: "noopener", target: "_blank" } : {})}
              className="flex flex-col gap-1 rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-sky-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
            >
              <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-tranquil-200 text-trust-600 dark:bg-gray-700">
                <Icon className="h-6 w-6" />
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-trust-500">
                {t(`public.contact.channels.${key}Label`)}
              </span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {t(`public.contact.channels.${key}Name`)}
              </span>
              <span className="font-mono text-sm text-trust-600 dark:text-trust-100" dir="ltr">
                {t(`public.contact.channels.${key}Value`)}
              </span>
              <span className="text-xs text-gray-500">
                {t(`public.contact.channels.${key}Meta`)}
              </span>
            </a>
          ))}
        </div>
      </Section>

      {/* CONTACT FORM + INFO */}
      <Section labelledBy="contact-form-title" className="bg-white dark:bg-gray-800/40">
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <form
            noValidate
            onSubmit={handleSubmit(onSubmit)}
            aria-labelledby="contact-form-title"
            className="rounded-2xl border border-sky-200 bg-snow-100 p-6 sm:p-8 dark:border-gray-700 dark:bg-gray-900"
          >
            <h2
              id="contact-form-title"
              className="text-xl font-semibold text-gray-900 dark:text-gray-100"
            >
              {t("public.contact.form.title")}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {t("public.contact.form.subtitle")}
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ct-name" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t("public.contact.form.name")} <span className="text-danger-600">*</span>
                </label>
                <input
                  id="ct-name"
                  type="text"
                  className="input"
                  placeholder={t("public.contact.form.namePlaceholder")}
                  aria-invalid={!!errors.name}
                  {...register("name")}
                />
                {errors.name && <p className={fieldErr}>{errors.name.message}</p>}
              </div>
              <div>
                <label htmlFor="ct-email" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t("public.contact.form.email")} <span className="text-danger-600">*</span>
                </label>
                <input
                  id="ct-email"
                  type="email"
                  dir="ltr"
                  className="input"
                  placeholder={t("public.contact.form.emailPlaceholder")}
                  aria-invalid={!!errors.email}
                  {...register("email")}
                />
                {errors.email && <p className={fieldErr}>{errors.email.message}</p>}
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ct-phone" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t("public.contact.form.phone")}{" "}
                  <span className="font-normal text-gray-500">{t("public.contact.form.phoneOptional")}</span>
                </label>
                <input
                  id="ct-phone"
                  type="tel"
                  dir="ltr"
                  className="input"
                  placeholder="+965 ..."
                  {...register("phone")}
                />
              </div>
              <div>
                <label htmlFor="ct-subject" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t("public.contact.form.subject")} <span className="text-danger-600">*</span>
                </label>
                <select id="ct-subject" className="input" aria-invalid={!!errors.subject} {...register("subject")}>
                  {SUBJECT_KEYS.map((s) => (
                    <option key={s} value={t(`public.contact.form.${s}`)}>
                      {t(`public.contact.form.${s}`)}
                    </option>
                  ))}
                </select>
                {errors.subject && <p className={fieldErr}>{errors.subject.message}</p>}
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="ct-message" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t("public.contact.form.message")} <span className="text-danger-600">*</span>
              </label>
              <textarea
                id="ct-message"
                rows={6}
                className="input resize-y"
                placeholder={t("public.contact.form.messagePlaceholder")}
                aria-invalid={!!errors.message}
                {...register("message")}
              />
              {errors.message ? (
                <p className={fieldErr}>{errors.message.message}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">{t("public.contact.form.messageHelp")}</p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={isSubmitting}>
                <SendIcon className="h-4 w-4" />
                {t("public.contact.form.submit")}
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <LockIcon className="h-4 w-4" />
                {t("public.contact.form.privacy")}
              </span>
            </div>
          </form>

          <aside className="flex flex-col gap-4" aria-label={t("public.contact.info.hoursTitle")}>
            <div className="rounded-2xl border border-sky-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <ClockIcon className="h-4 w-4 text-trust-500" />
                {t("public.contact.info.hoursTitle")}
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="flex items-center justify-between gap-3">
                    <dt className="text-gray-600 dark:text-gray-300">
                      {t(`public.contact.info.hoursDays${n}`)}
                    </dt>
                    <dd className="tabular-nums text-gray-900 dark:text-gray-100" dir="ltr">
                      {t(`public.contact.info.hoursTime${n}`)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-gray-500">{t("public.contact.info.hoursTz")}</p>
            </div>

            <div className="rounded-2xl border border-sky-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <MapPinIcon className="h-4 w-4 text-trust-500" />
                {t("public.contact.info.addressTitle")}
              </div>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {t("public.contact.info.addressBody")}
              </p>
            </div>

            <div className="rounded-2xl border border-sky-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-3 flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100">
                <InfoIcon className="h-4 w-4 text-trust-500" />
                {t("public.contact.info.urgentTitle")}
              </div>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {t("public.contact.info.urgentBody")}
              </p>
            </div>
          </aside>
        </div>
      </Section>

      {/* FAQ */}
      <Section labelledBy="faq-title">
        <SectionHead
          id="faq-title"
          eyebrow={t("public.contact.faq.eyebrow")}
          title={t("public.contact.faq.title")}
          titleAccent={t("public.contact.faq.titleAccent")}
          lede={t("public.contact.faq.lede")}
        />
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          {FAQ_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t(`public.contact.faq.${group.title}`)}
              </h3>
              <div className="flex flex-col gap-2.5">
                {group.items.map((q) => {
                  const a = q.replace("q", "a");
                  return (
                    <details
                      key={q}
                      className="group rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-gray-900 dark:text-gray-100">
                        {t(`public.contact.faq.${q}`)}
                        <ChevronDownIcon className="h-4 w-4 flex-shrink-0 text-trust-500 transition group-open:rotate-180" />
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                        {t(`public.contact.faq.${a}`)}
                      </p>
                    </details>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* NOTE */}
      <Section className="bg-white dark:bg-gray-800/40">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 rounded-3xl border border-sky-200 bg-gradient-to-bl from-tranquil-100 to-snow-200 p-8 text-center dark:border-gray-700 dark:from-gray-900 dark:to-gray-800">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-tranquil-200 text-trust-600 dark:bg-gray-700">
            <WhatsappIcon className="h-6 w-6" />
          </span>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {t("public.contact.note.title")}
          </h2>
          <p className="max-w-md leading-relaxed text-gray-600 dark:text-gray-300">
            {t("public.contact.note.body")}
          </p>
          <a href="#" className="btn-primary inline-flex items-center gap-2">
            <WhatsappIcon className="h-5 w-5" />
            {t("public.contact.note.whatsapp")}
          </a>
        </div>
      </Section>
    </>
  );
}
