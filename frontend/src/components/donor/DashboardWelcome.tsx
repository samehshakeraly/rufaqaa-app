import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

/** PR-D01 — the zero-sponsorships dashboard: a warm gradient welcome,
 * the three steps of a sponsorship, the two obvious first actions, and
 * the hadith line. (No minimum-amount line — no platform setting
 * exposes one to donors, and we never show an invented number.) */
export function DashboardWelcome() {
  const { t } = useTranslation();

  const steps = [
    {
      title: t("donor.dashboard.welcomeCard.step1Title"),
      body: t("donor.dashboard.welcomeCard.step1Body"),
    },
    {
      title: t("donor.dashboard.welcomeCard.step2Title"),
      body: t("donor.dashboard.welcomeCard.step2Body"),
    },
    {
      title: t("donor.dashboard.welcomeCard.step3Title"),
      body: t("donor.dashboard.welcomeCard.step3Body"),
    },
  ];

  return (
    <section className="card overflow-hidden p-0">
      <div className="bg-gradient-to-bl from-trust-600 via-trust-400 to-trust-300 p-6 text-white dark:from-trust-900 dark:via-trust-700 dark:to-trust-600 sm:p-8">
        <h2 className="text-xl font-bold">
          {t("donor.dashboard.welcomeCard.title")}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/90">
          {t("donor.dashboard.welcomeCard.body")}
        </p>
      </div>

      <div className="space-y-6 p-6 sm:p-8">
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tranquil-200 text-sm font-bold text-trust-700 dark:bg-gray-700 dark:text-tranquil-200"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {step.title}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/orphans" className="btn-primary min-h-[44px]">
            {t("donor.dashboard.welcomeCard.browse")}
          </Link>
          <Link to="/how-it-works" className="btn-secondary min-h-[44px]">
            {t("donor.dashboard.welcomeCard.howItWorks")}
          </Link>
        </div>

        <p className="border-t border-sky-200 pt-4 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t("donor.dashboard.welcomeCard.hadith")}
        </p>
      </div>
    </section>
  );
}
