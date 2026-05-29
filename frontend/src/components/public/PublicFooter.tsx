import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { GithubIcon, MailIcon, WhatsappIcon, XIcon } from "@/components/public/icons";

import { CONTAINER } from "./ui";

const REPO_URL = "https://github.com/samehshakeraly/rufaqaa-app";

/**
 * Shared public-site footer, extracted from the W-01 landing shell and
 * reused across every public page. Four columns (brand + social,
 * platform, trust, community) over a dark band, with the MIT-license
 * line at the bottom — mirroring docs/design/screens/public mockups.
 */
export function PublicFooter() {
  const { t } = useTranslation();
  const year = new Date().getFullYear();

  return (
    <footer role="contentinfo" className="mt-auto bg-gray-900 pt-16 pb-7 text-gray-300">
      <div className={CONTAINER}>
        <div className="mb-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand + social */}
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-bl from-trust-300 to-trust-500 text-xl font-semibold text-white"
              >
                ر
              </span>
              <span className="text-base font-semibold text-white">{t("app.name")}</span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-gray-400">
              {t("public.footer.desc")}
            </p>
            <div className="mt-1 flex gap-2">
              <a
                href={REPO_URL}
                aria-label="GitHub"
                rel="noopener"
                target="_blank"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition hover:bg-trust-500 hover:text-white"
              >
                <GithubIcon className="h-5 w-5" />
              </a>
              <a
                href="#"
                aria-label="WhatsApp"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition hover:bg-trust-500 hover:text-white"
              >
                <WhatsappIcon className="h-5 w-5" />
              </a>
              <a
                href="#"
                aria-label="X"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition hover:bg-trust-500 hover:text-white"
              >
                <XIcon className="h-5 w-5" />
              </a>
              <a
                href="mailto:hello@rufaqaa.app"
                aria-label={t("public.footer.contact")}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-gray-300 transition hover:bg-trust-500 hover:text-white"
              >
                <MailIcon className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Platform */}
          <FooterCol title={t("public.footer.platform.title")}>
            <FooterLink to="/orphans">{t("public.footer.platform.browse")}</FooterLink>
            <FooterLink to="/orphans">{t("public.footer.platform.sponsor")}</FooterLink>
            <FooterLink to="/how-it-works">{t("public.footer.platform.howItWorks")}</FooterLink>
            <FooterLink to="/partners">{t("public.footer.platform.forOrgs")}</FooterLink>
            <FooterLink to="/login">{t("public.footer.platform.login")}</FooterLink>
          </FooterCol>

          {/* Trust */}
          <FooterCol title={t("public.footer.trust.title")}>
            <FooterLink to="/transparency">{t("public.footer.trust.financials")}</FooterLink>
            <FooterLink to="/transparency">{t("public.footer.trust.reports")}</FooterLink>
            <FooterLink to="/partners">{t("public.footer.trust.partners")}</FooterLink>
            <FooterLink to="/contact">{t("public.footer.privacy")}</FooterLink>
            <FooterLink to="/contact">{t("public.footer.terms")}</FooterLink>
          </FooterCol>

          {/* Community */}
          <FooterCol title={t("public.footer.community.title")}>
            <li>
              <a
                href={REPO_URL}
                rel="noopener"
                target="_blank"
                className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-white"
              >
                <GithubIcon className="h-3.5 w-3.5" />
                {t("public.footer.community.repo")}
                <span className="ms-1 rounded-full bg-success-500 px-1.5 text-[10px] font-semibold text-white">
                  {t("public.footer.community.repoBadge")}
                </span>
              </a>
            </li>
            <FooterLink to="/about">{t("public.footer.community.contributing")}</FooterLink>
            <FooterLink to="/about">{t("public.footer.community.roadmap")}</FooterLink>
            <FooterLink to="/contact">{t("public.footer.community.contact")}</FooterLink>
          </FooterCol>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-gray-500">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            © {year} {t("app.name")} — {t("public.footer.license")}
            <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-gray-300">
              MIT License
            </code>
            <span>· {t("public.footer.licenseNote")}</span>
          </span>
          <span className="text-gray-400">
            {t("public.footer.madeWith")} <span aria-hidden="true" className="text-trust-300">♥</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-white">{title}</h3>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

function FooterLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <li>
      <Link to={to} className="text-sm text-gray-400 transition hover:text-white">
        {children}
      </Link>
    </li>
  );
}
