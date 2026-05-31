import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import {
  getOrphanMe,
  getOrphanSponsor,
  listOrphanAchievements,
  listOrphanMessages,
  type OrphanAchievement,
  type OrphanMessage,
  type OrphanSponsorView,
} from "@/lib/orphanSelf";

import "./OrphanHomePage.css";

/** O-02 — the orphan's warm home: a greeting, a privacy-safe "my
 * sponsor" card, a preview of recent achievements, and the latest
 * (already-moderated) message from the sponsor. No financial, donor,
 * partner, or guardian data is ever shown here. */
export function OrphanHomePage() {
  const { t, i18n } = useTranslation();
  const profile = useQuery({ queryKey: ["orphan", "me"], queryFn: getOrphanMe });
  const sponsor = useQuery({
    queryKey: ["orphan", "me", "sponsor"],
    queryFn: getOrphanSponsor,
  });
  const achievements = useQuery({
    queryKey: ["orphan", "me", "achievements"],
    queryFn: () => listOrphanAchievements(20),
  });
  const messages = useQuery({
    queryKey: ["orphan", "me", "messages"],
    queryFn: () => listOrphanMessages(50),
  });

  const highlights = collectPreviewHighlights(achievements.data ?? []);
  // Only messages that already reached the orphan (i.e. from the sponsor,
  // already past moderation) are previewed here.
  const latestFromSponsor = (messages.data ?? [])
    .filter((m) => !m.is_mine && m.content)
    .sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
    )[0];

  return (
    <div className="ohm-root">
      <div className="ohm-stack">
        {/* Welcome */}
        <section className="ohm-welcome">
          <div className="ohm-welcome-inner">
            <span className="ohm-welcome-emoji" aria-hidden="true">
              🌟
            </span>
            <div className="ohm-welcome-text">
              <h1>
                {t("orphan.home.greetingPre")}{" "}
                <span className="ohm-name">{profile.data?.first_name ?? ""}</span>
              </h1>
              <p>{t("orphan.home.subtitle")}</p>
            </div>
          </div>
        </section>

        {/* Sponsor */}
        <section aria-labelledby="ohm-sponsor-title">
          <h2 className="ohm-section-title" id="ohm-sponsor-title">
            <HeartIcon />
            {t("orphan.home.sponsorTitle")}
          </h2>
          <div className="ohm-sponsor-card">
            {sponsor.isLoading && <Skeleton className="h-24 w-full" />}
            {sponsor.data && <SponsorCard sponsor={sponsor.data} />}
          </div>
        </section>

        {/* Achievements preview */}
        <section aria-labelledby="ohm-ach-title">
          <h2 className="ohm-section-title" id="ohm-ach-title">
            <TrophyIcon />
            {t("orphanNav.achievements")}
          </h2>
          <div className="ohm-card">
            {achievements.isLoading && <Skeleton className="h-24 w-full" />}
            {achievements.data && highlights.length === 0 && (
              <div className="ohm-empty">
                <span className="ohm-emoji" aria-hidden="true">
                  🌱
                </span>
                <p>{t("orphan.achievements.empty")}</p>
              </div>
            )}
            {highlights.length > 0 && (
              <>
                <ul className="ohm-ach-list">
                  {highlights.map((h, i) => (
                    <li key={i} className="ohm-ach-item">
                      <span className="ohm-ach-check" aria-hidden="true">
                        <svg className="ohm-icon" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span className="ohm-ach-text">{h}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/orphan/achievements" className="ohm-more">
                  {t("orphan.home.viewAllAchievements")}
                  <svg className="ohm-icon" viewBox="0 0 24 24">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                </Link>
              </>
            )}
          </div>
        </section>

        {/* Messages from sponsor */}
        <section aria-labelledby="ohm-msg-title">
          <h2 className="ohm-section-title" id="ohm-msg-title">
            <MailIcon />
            {t("orphan.home.messagesTitle")}
          </h2>
          <div className="ohm-card">
            {messages.isLoading && <Skeleton className="h-24 w-full" />}
            {messages.data && !latestFromSponsor && (
              <div className="ohm-empty">
                <span className="ohm-emoji" aria-hidden="true">
                  ✉️
                </span>
                <p>{t("orphan.home.noMessages")}</p>
              </div>
            )}
            {latestFromSponsor && (
              <MessagePreview message={latestFromSponsor} lang={i18n.language} />
            )}
            <div className="ohm-privacy">
              <span className="ohm-privacy-icon" aria-hidden="true">
                <svg className="ohm-icon" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <p className="ohm-privacy-text">
                <strong>{t("orphan.home.privacyNote")}</strong>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function SponsorCard({ sponsor }: { sponsor: OrphanSponsorView }) {
  const { t } = useTranslation();

  if (!sponsor.has_sponsor) {
    return (
      <div className="ohm-no-sponsor">
        <span className="ohm-emoji" aria-hidden="true">
          🤲
        </span>
        <p>{t("orphan.home.noSponsor")}</p>
      </div>
    );
  }

  const displayName = sponsor.display_name || t("orphan.home.sponsorFallback");
  const years =
    sponsor.since_year != null ? new Date().getFullYear() - sponsor.since_year : null;

  return (
    <>
      <div className="ohm-sponsor-row">
        <span className="ohm-sponsor-avatar" aria-hidden="true">
          <svg className="ohm-icon" viewBox="0 0 24 24">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </span>
        <div className="ohm-sponsor-text">
          <h3>{t("orphan.home.sponsorHeading")}</h3>
          <p className="ohm-sponsor-name">{displayName}</p>
          <p className="ohm-sponsor-since">{t("orphan.home.sponsorCaring")}</p>
          {years != null && years > 0 && (
            <p className="ohm-sponsor-since">
              {t("orphan.home.sponsorSince", { years })}
            </p>
          )}
        </div>
      </div>
      <Link to="/orphan/messages" className="ohm-msg-btn">
        <svg className="ohm-icon" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {t("orphan.home.writeThanks")}
      </Link>
    </>
  );
}

function MessagePreview({
  message: m,
  lang,
}: {
  message: OrphanMessage;
  lang: string;
}) {
  const { t } = useTranslation();
  const from = m.from_name || t("orphan.home.sponsorFallback");
  return (
    <>
      <div className="ohm-msg-bubble">
        <p className="ohm-msg-text">{m.content}</p>
        <div className="ohm-msg-meta">
          <span className="ohm-from-avatar" aria-hidden="true">
            {from.trim().charAt(0)}
          </span>
          <span className="ohm-msg-from">{from}</span>
          {m.created_at && (
            <>
              <span aria-hidden="true">·</span>
              <time dateTime={m.created_at}>
                {new Date(m.created_at).toLocaleDateString(lang)}
              </time>
            </>
          )}
        </div>
      </div>
      <Link to="/orphan/messages" className="ohm-msg-action">
        {t("orphan.home.readAllMessages")}
        <svg className="ohm-icon" viewBox="0 0 24 24">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </Link>
    </>
  );
}

/**
 * Flatten the most recent achievement reports into up to three short,
 * readable highlight lines for the home preview. Scalar leaf values
 * only — never raw keys, nested JSON, or financial data.
 */
function collectPreviewHighlights(items: OrphanAchievement[]): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (out.length >= 3 || value == null) return;
    if (typeof value === "string") {
      const s = value.trim();
      if (s) out.push(s);
    } else if (typeof value === "number") {
      out.push(String(value));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  for (const a of items) {
    visit(a.quran_progress);
    visit(a.educational_progress);
    visit(a.activities);
    if (out.length >= 3) break;
  }
  return out.slice(0, 3);
}

function HeartIcon() {
  return (
    <svg className="ohm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg className="ohm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg className="ohm-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
