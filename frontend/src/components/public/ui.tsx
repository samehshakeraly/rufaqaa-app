/**
 * Small presentational primitives shared across the public marketing
 * pages (W-02..W-06). Tokens-only colours (trust/sky/tranquil/snow/
 * gray/success/warning from tailwind.config) — no ad-hoc hex.
 */
import type { ReactNode } from "react";

/** Centered max-width content well, matching the mockups' .container. */
export const CONTAINER = "mx-auto w-full max-w-[1240px] px-6";

/** Full-bleed page section with vertical rhythm. */
export function Section({
  children,
  className = "",
  id,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`py-16 sm:py-20 ${className}`}>
      <div className={CONTAINER}>{children}</div>
    </section>
  );
}

/** Pill "eyebrow" label above section titles. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-tranquil-100 px-3.5 py-1.5 text-xs font-medium text-trust-600">
      {children}
    </span>
  );
}

/** Centered section header: eyebrow + title + optional lede. */
export function SectionHead({
  eyebrow,
  title,
  titleAccent,
  lede,
  id,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  titleAccent?: ReactNode;
  lede?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-12 flex flex-col items-center gap-3.5 text-center">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        id={id}
        className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-gray-900 dark:text-gray-100"
      >
        {title} {titleAccent ? <span className="text-trust-500">{titleAccent}</span> : null}
      </h2>
      {lede ? (
        <p className="mx-auto max-w-2xl text-base leading-relaxed text-gray-600 dark:text-gray-300">
          {lede}
        </p>
      ) : null}
    </div>
  );
}

/** Hero band used at the top of every marketing page. */
export function Hero({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  titleAccent?: ReactNode;
  subtitle: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="page-hero-title"
      className="border-b border-sky-200 bg-gradient-to-b from-snow-100 to-snow-200 py-16 sm:py-20 dark:border-gray-700 dark:from-gray-900 dark:to-gray-900"
    >
      <div className={`${CONTAINER} flex flex-col items-center gap-5 text-center`}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1
          id="page-hero-title"
          className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-gray-900 sm:text-5xl dark:text-gray-100"
        >
          {title}{" "}
          {titleAccent ? (
            <span className="bg-tranquil-200 px-1.5 text-trust-700 dark:bg-trust-700 dark:text-tranquil-200">
              {titleAccent}
            </span>
          ) : null}
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-gray-600 dark:text-gray-300">
          {subtitle}
        </p>
        {children}
      </div>
    </section>
  );
}

/** Primary gradient button styling (links). Tokens-only. */
export const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-bl from-trust-400 to-trust-500 px-5 py-3 font-medium text-white shadow-sm transition hover:from-trust-500 hover:to-trust-600 hover:shadow-md";

/** Secondary (outline) button styling. */
export const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-sky-300 bg-white px-5 py-3 font-medium text-trust-600 transition hover:border-trust-300 hover:bg-tranquil-100 dark:bg-gray-800 dark:text-trust-100";

/** Light button used on dark CTA bands. */
export const BTN_LIGHT =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 font-medium text-trust-700 transition hover:bg-tranquil-100 hover:shadow-md";

/** Outline-on-dark button used on dark CTA bands. */
export const BTN_OUTLINE_LIGHT =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/10 px-6 py-3.5 font-medium text-white transition hover:border-white/60 hover:bg-white/20";

/** Dark CTA band shared by several pages. */
export function CtaBand({
  eyebrow,
  title,
  titleSoft,
  lede,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  titleSoft?: ReactNode;
  lede: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section
      aria-labelledby="cta-band-title"
      className="bg-gradient-to-bl from-trust-600 to-trust-800 py-20"
    >
      <div className={`${CONTAINER} flex flex-col items-center gap-4 text-center`}>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-tranquil-200">
          {eyebrow}
        </span>
        <h2
          id="cta-band-title"
          className="max-w-2xl text-3xl font-semibold leading-snug tracking-tight text-white sm:text-4xl"
        >
          {title} {titleSoft ? <span className="text-tranquil-200">{titleSoft}</span> : null}
        </h2>
        <p className="max-w-xl text-lg leading-relaxed text-white/80">{lede}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      </div>
    </section>
  );
}
