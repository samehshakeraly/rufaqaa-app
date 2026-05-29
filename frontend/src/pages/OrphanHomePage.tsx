import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import {
  ageFromDob,
  getOrphanMe,
  getOrphanSponsor,
  type OrphanSponsorView,
} from "@/lib/orphanSelf";

/** O-02 — the orphan's warm home screen: greeting, profile ring, a
 * privacy-safe "my sponsor" card, and quick actions. No financial,
 * donor, partner, or guardian data is ever shown here. */
export function OrphanHomePage() {
  const { t } = useTranslation();
  const profile = useQuery({ queryKey: ["orphan", "me"], queryFn: getOrphanMe });
  const sponsor = useQuery({
    queryKey: ["orphan", "me", "sponsor"],
    queryFn: getOrphanSponsor,
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-trust-400 to-trust-600 px-6 py-7 text-white">
        <p className="text-lg" aria-hidden="true">
          🌟
        </p>
        <h1 className="mt-1 text-2xl font-bold">
          {t("orphan.home.greeting", { name: profile.data?.first_name ?? "" })}
        </h1>
        <p className="mt-1 text-sm text-white/90">{t("orphan.home.subtitle")}</p>
      </section>

      {/* Profile card with completion ring */}
      <section className="card" aria-labelledby="orphan-profile-title">
        <h2
          id="orphan-profile-title"
          className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("orphan.home.profileTitle")}
        </h2>
        {profile.isLoading && <Skeleton className="h-24 w-full" />}
        {profile.data && (
          <div className="flex items-center gap-5">
            <ProgressRing value={profile.data.profile_completion_percentage} />
            <div className="space-y-1">
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {profile.data.first_name} {profile.data.family_name}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("orphan.home.age", {
                  age: ageFromDob(profile.data.date_of_birth),
                })}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* My sponsor — privacy-safe */}
      <section className="card" aria-labelledby="orphan-sponsor-title">
        <h2
          id="orphan-sponsor-title"
          className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("orphan.home.sponsorTitle")}
        </h2>
        {sponsor.isLoading && <Skeleton className="h-24 w-full" />}
        {sponsor.data && <SponsorCard sponsor={sponsor.data} />}
      </section>

      {/* Quick actions */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Link
          to="/orphan/achievements"
          className="card flex items-center gap-3 transition hover:border-trust-300 hover:shadow-md"
        >
          <span aria-hidden="true" className="text-2xl">
            🏆
          </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {t("orphanNav.achievements")}
          </span>
        </Link>
        <Link
          to="/orphan/messages"
          className="card flex items-center gap-3 transition hover:border-trust-300 hover:shadow-md"
        >
          <span aria-hidden="true" className="text-2xl">
            💌
          </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {t("orphan.home.sendMessage")}
          </span>
        </Link>
      </section>
    </div>
  );
}

function SponsorCard({ sponsor }: { sponsor: OrphanSponsorView }) {
  const { t } = useTranslation();

  if (!sponsor.has_sponsor) {
    return (
      <div className="flex items-center gap-4 rounded-xl bg-tranquil-100 p-4 dark:bg-gray-800/60">
        <span aria-hidden="true" className="text-3xl">
          🤲
        </span>
        <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">
          {t("orphan.home.noSponsor")}
        </p>
      </div>
    );
  }

  const displayName = sponsor.display_name || t("orphan.home.sponsorFallback");
  const years =
    sponsor.since_year != null
      ? new Date().getFullYear() - sponsor.since_year
      : null;

  return (
    <div className="flex items-center gap-4">
      <span
        aria-hidden="true"
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-tranquil-200 text-trust-600 dark:bg-gray-700"
      >
        <svg
          className="h-9 w-9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </span>
      <div className="space-y-1">
        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {displayName}
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("orphan.home.sponsorCaring")}
        </p>
        {years != null && years > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphan.home.sponsorSince", { years })}
          </p>
        )}
      </div>
    </div>
  );
}

/** Accessible circular progress indicator for profile completion. */
function ProgressRing({ value }: { value: number }) {
  const { t } = useTranslation();
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div
      role="img"
      aria-label={t("orphan.home.completion", { percent: clamped })}
      className="relative shrink-0"
    >
      <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-tranquil-200 dark:stroke-gray-700"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-trust-500 transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-trust-700 dark:text-trust-100">
        {clamped}%
      </span>
    </div>
  );
}
