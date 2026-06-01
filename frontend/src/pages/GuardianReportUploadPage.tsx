import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { listGuardianOrphans } from "@/lib/guardianSelf";
import { ageFromDob } from "@/lib/orphanSelf";

import "./GuardianReportUploadPage.css";

type Mood = "good" | "okay" | "attn";
const STEPS = 3;

/** G-04 — monthly report wizard for one of the guardian's orphans.
 *
 * There is NO guardian-facing report-UPLOAD endpoint yet, so this screen is a
 * faithful preview: the steps are interactive locally, but the final submit is
 * disabled with a clear "coming soon" note. Nothing is sent. The read side of
 * reports stays live on the orphan detail page (GET /guardian/me/reports).
 *
 * CHILD-DATA SENSITIVITY: no child data is collected or transmitted here. The
 * controls keep state only in component memory for the preview. */
export function GuardianReportUploadPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();

  const [step, setStep] = useState(1);
  const [mood, setMood] = useState<Mood | null>(null);
  const [moodDetail, setMoodDetail] = useState("");
  const [stars, setStars] = useState(0);
  const [eduNotes, setEduNotes] = useState("");

  const orphans = useQuery({
    queryKey: ["guardian", "me", "orphans"],
    queryFn: listGuardianOrphans,
  });
  const orphan = orphans.data?.find((o) => o.id === id);

  if (orphans.isLoading) {
    return (
      <div className="gru-root">
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (orphans.data && !orphan) {
    return (
      <div className="gru-root">
        <div className="gru-state" role="alert">
          <p>{t("guardian.detail.notFound")}</p>
          <Link to="/guardian" className="gru-state-link">
            {t("guardian.detail.backHome")}
          </Link>
        </div>
      </div>
    );
  }

  if (!orphan) return null;

  const age = ageFromDob(orphan.date_of_birth);
  const canNext =
    step === 1
      ? Boolean(mood) && (mood !== "attn" || moodDetail.trim().length > 4)
      : step === 2
        ? stars > 0
        : true;

  return (
    <div className="gru-root">
      {/* Header */}
      <header className="gru-header">
        <Link to={`/guardian/orphans/${orphan.id}`} className="gru-back">
          <svg className="gru-icon gru-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>{t("guardian.report.backToOrphan", { name: orphan.first_name })}</span>
        </Link>
        <div className="gru-title-area">
          <h1>{t("guardian.report.title")}</h1>
          <p>{t("guardian.report.about", { name: `${orphan.first_name} ${orphan.family_name}`.trim() })}</p>
        </div>
      </header>

      {/* Coming-soon banner — submit is not wired to a backend yet */}
      <div className="gru-soon-banner" role="status">
        <svg className="gru-icon gru-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>
          <strong>{t("guardian.report.soonTitle")}</strong>{" "}
          {t("guardian.report.soonBody")}
        </span>
      </div>

      {/* Progress */}
      <div className="gru-progress" aria-label={t("guardian.report.progressLabel")}>
        <div className="gru-progress-head">
          <span>{t("guardian.report.progressStep", { current: step, total: STEPS })}</span>
        </div>
        <div
          className="gru-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={STEPS}
          aria-valuenow={step}
        >
          <div
            className="gru-progress-fill"
            style={{ width: `${(step / STEPS) * 100}%` }}
          />
        </div>
        <ol className="gru-steps">
          <StepMarker n={1} current={step} label={t("guardian.report.step1")} />
          <StepMarker n={2} current={step} label={t("guardian.report.step2")} />
          <StepMarker n={3} current={step} label={t("guardian.report.step3")} />
        </ol>
      </div>

      {/* Context */}
      <div className="gru-context">
        <span className="gru-context-avatar" aria-hidden="true">
          {orphan.first_name.slice(0, 1)}
        </span>
        <div className="gru-context-text">
          <strong>{`${orphan.first_name} ${orphan.family_name}`.trim()}</strong>
          <span>
            {t("guardian.home.ageYears", { count: age })} ·{" "}
            {t(`guardian.gender.${orphan.gender}`, { defaultValue: orphan.gender })}
          </span>
        </div>
      </div>

      {/* Steps */}
      <main className="gru-stage">
        {step === 1 && (
          <section aria-labelledby="gru-s1">
            <div className="gru-prompt">
              <h2 id="gru-s1">{t("guardian.report.moodQ", { name: orphan.first_name })}</h2>
              <p>{t("guardian.report.moodHint")}</p>
            </div>
            <div className="gru-mood-grid" role="radiogroup" aria-labelledby="gru-s1">
              <MoodCard value="good" current={mood} onSelect={setMood}
                title={t("guardian.report.moodGood")} sub={t("guardian.report.moodGoodSub")} />
              <MoodCard value="okay" current={mood} onSelect={setMood}
                title={t("guardian.report.moodOkay")} sub={t("guardian.report.moodOkaySub")} />
              <MoodCard value="attn" current={mood} onSelect={setMood}
                title={t("guardian.report.moodAttn")} sub={t("guardian.report.moodAttnSub")} />
            </div>
            {mood === "attn" && (
              <div className="gru-field">
                <label className="gru-label" htmlFor="gru-mood-detail">
                  {t("guardian.report.moodDetailLabel")}
                </label>
                <textarea
                  id="gru-mood-detail"
                  className="gru-textarea"
                  maxLength={500}
                  value={moodDetail}
                  onChange={(e) => setMoodDetail(e.target.value)}
                  placeholder={t("guardian.report.moodDetailPlaceholder")}
                />
                <p className="gru-field-hint">{t("guardian.report.moodDetailHint")}</p>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="gru-s2">
            <div className="gru-prompt">
              <h2 id="gru-s2">{t("guardian.report.eduTitle")}</h2>
              <p>{t("guardian.report.eduHint", { name: orphan.first_name })}</p>
            </div>
            <div className="gru-stars-card">
              <div className="gru-stars" role="radiogroup" aria-label={t("guardian.report.eduTitle")}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={stars === n}
                    aria-label={t("guardian.report.starN", { count: n })}
                    className={`gru-star${n <= stars ? " gru-star--lit" : ""}`}
                    onClick={() => setStars(n)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
                    </svg>
                  </button>
                ))}
              </div>
              <p className="gru-stars-label">
                {stars > 0
                  ? t(`guardian.report.starLabel${stars}`)
                  : t("guardian.report.starsPrompt")}
              </p>
            </div>
            <div className="gru-field">
              <label className="gru-label" htmlFor="gru-edu-notes">
                {t("guardian.report.eduNotesLabel")}{" "}
                <span className="gru-optional">{t("guardian.report.optional")}</span>
              </label>
              <textarea
                id="gru-edu-notes"
                className="gru-textarea"
                value={eduNotes}
                onChange={(e) => setEduNotes(e.target.value)}
                placeholder={t("guardian.report.eduNotesPlaceholder")}
              />
            </div>
            <p className="gru-field-hint">{t("guardian.report.photosSoon")}</p>
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby="gru-s3">
            <div className="gru-prompt">
              <h2 id="gru-s3">{t("guardian.report.reviewTitle")}</h2>
              <p>{t("guardian.report.reviewHint")}</p>
            </div>
            <div className="gru-review">
              <ReviewRow label={t("guardian.report.step1")}>
                {mood ? t(`guardian.report.mood${cap(mood)}`) : t("guardian.report.notChosen")}
                {mood === "attn" && moodDetail.trim() && (
                  <span className="gru-review-extra">{moodDetail}</span>
                )}
              </ReviewRow>
              <ReviewRow label={t("guardian.report.step2")}>
                {stars > 0 ? t(`guardian.report.starLabel${stars}`) : t("guardian.report.notRated")}
                {eduNotes.trim() && <span className="gru-review-extra">{eduNotes}</span>}
              </ReviewRow>
            </div>
            <div className="gru-privacy">
              <svg className="gru-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>{t("guardian.report.privacyNote")}</span>
            </div>
          </section>
        )}
      </main>

      {/* Foot nav */}
      <nav className="gru-foot" aria-label={t("guardian.report.navLabel")}>
        <button
          type="button"
          className="gru-foot-btn gru-foot-btn--secondary"
          disabled={step === 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
        >
          {t("guardian.report.prev")}
        </button>

        {step < STEPS ? (
          <button
            type="button"
            className="gru-foot-btn gru-foot-btn--primary"
            disabled={!canNext}
            onClick={() => setStep((s) => Math.min(STEPS, s + 1))}
          >
            {t("guardian.report.next")}
          </button>
        ) : (
          // TODO(backend): wire to the guardian report-upload POST endpoint
          // once it exists. Disabled until then — the portal must never claim
          // a report was sent when nothing was transmitted.
          <button
            type="button"
            className="gru-foot-btn gru-foot-btn--send"
            disabled
            title={t("guardian.report.soonTitle")}
          >
            {t("guardian.report.sendSoon")}
          </button>
        )}
      </nav>
    </div>
  );
}

function StepMarker({ n, current, label }: { n: number; current: number; label: string }) {
  const state = n === current ? "active" : n < current ? "done" : "";
  return (
    <li className={`gru-step${state ? ` gru-step--${state}` : ""}`}>
      <span className="gru-step-dot">{n}</span>
      <span className="gru-step-label">{label}</span>
    </li>
  );
}

function MoodCard({
  value,
  current,
  onSelect,
  title,
  sub,
}: {
  value: Mood;
  current: Mood | null;
  onSelect: (m: Mood) => void;
  title: string;
  sub: string;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`gru-mood-card${selected ? " gru-mood-card--selected" : ""}`}
      onClick={() => onSelect(value)}
    >
      <span className={`gru-mood-face gru-mood-face--${value}`} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          {value === "good" && <path d="M8 14s1.5 2 4 2 4-2 4-2" />}
          {value === "okay" && <line x1="8" y1="15" x2="16" y2="15" />}
          {value === "attn" && <path d="M16 16s-1.5-2-4-2-4 2-4 2" />}
          <line x1="9" y1="9" x2="9.01" y2="9" />
          <line x1="15" y1="9" x2="15.01" y2="9" />
        </svg>
      </span>
      <span className="gru-mood-text">
        <span className="gru-mood-title">{title}</span>
        <span className="gru-mood-sub">{sub}</span>
      </span>
    </button>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gru-review-row">
      <span className="gru-review-label">{label}</span>
      <span className="gru-review-value">{children}</span>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
