import { useTranslation } from "react-i18next";

import "./GuardianMessagesPage.css";

/** G-05 — guardian ↔ sponsor messages.
 *
 * There is NO guardian-facing messages endpoint yet (neither read nor send),
 * so this screen renders the mockup's shell with a clear "coming soon" state
 * and a disabled composer. We deliberately show NO fabricated conversations —
 * that would mean inventing a child's correspondence. When the backend ships,
 * the convo list + thread render here and the composer is enabled.
 *
 * CHILD-DATA SENSITIVITY: nothing is collected or transmitted on this screen. */
export function GuardianMessagesPage() {
  const { t } = useTranslation();

  return (
    <div className="gms-root">
      <div className="gms-workspace">
        {/* Conversation list (right column in RTL) */}
        <aside className="gms-list" aria-label={t("guardian.messages.listLabel")}>
          <div className="gms-list-head">
            <h1>{t("guardian.messages.title")}</h1>
            <p>{t("guardian.messages.subtitle")}</p>
          </div>
          <div className="gms-list-empty">
            <span className="gms-list-empty-icon" aria-hidden="true">
              <MailIcon />
            </span>
            <p>{t("guardian.messages.listEmpty")}</p>
          </div>
        </aside>

        {/* Thread / coming-soon (left column in RTL) */}
        <section className="gms-thread" aria-label={t("guardian.messages.threadLabel")}>
          <div className="gms-moderation" role="status">
            <ShieldIcon />
            <span>
              <strong>{t("guardian.messages.moderationTitle")}</strong>{" "}
              {t("guardian.messages.moderationBody")}
            </span>
          </div>

          <div className="gms-soon">
            <span className="gms-soon-icon" aria-hidden="true">
              <MailIcon />
            </span>
            <h2>{t("guardian.messages.soonTitle")}</h2>
            <p>{t("guardian.messages.soonBody")}</p>
          </div>

          {/* Composer — disabled until the backend exists */}
          <div className="gms-composer" aria-hidden="false">
            <div className="gms-composer-hint">
              <ShieldIcon />
              {t("guardian.messages.composerHint")}
            </div>
            <div className="gms-composer-row">
              <textarea
                className="gms-composer-input"
                rows={1}
                disabled
                placeholder={t("guardian.messages.composerPlaceholder")}
                aria-label={t("guardian.messages.composerPlaceholder")}
              />
              <button
                type="button"
                className="gms-composer-send"
                disabled
                aria-label={t("guardian.messages.send")}
                title={t("guardian.messages.soonTitle")}
              >
                <svg className="gms-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MailIcon() {
  return (
    <svg className="gms-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="gms-icon gms-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
