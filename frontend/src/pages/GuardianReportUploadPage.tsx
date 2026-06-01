import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import { createGuardianReport, listGuardianOrphans } from "@/lib/guardianSelf";
import { ageFromDob } from "@/lib/orphanSelf";
import { toast } from "@/store/toasts";

import "./GuardianReportUploadPage.css";

type Mood = "good" | "okay" | "attn";
const STEPS = 3;

/** G-04 — monthly report wizard for one of the guardian's orphans.
 *
 * The text report is fully wired: on send it POSTs to /guardian/me/reports,
 * which creates the report in `pending_partner_approval`, so it lands at once
 * in the staff PartnerReportsReview queue and the guardian sees the
 * pending→approved/rejected status back on the orphan page.
 *
 * Photo/voice attachments are DEFERRED — they need a guardian media-upload
 * endpoint + the (still-stubbed) MediaReview queue, so those inputs render
 * visible-but-disabled with a "coming soon" note. See the
 * TODO(backend: media upload + MediaReview) in step 2.
 *
 * CHILD-DATA SENSITIVITY: only what the guardian types is sent, and only for
 * their own orphan (the backend 403s otherwise). Nothing is auto-published —
 * the report is reviewed before any donor sees it. */
export function GuardianReportUploadPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  const submit = useMutation({
    mutationFn: createGuardianReport,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["guardian", "me", "reports", id] });
      toast.success(t("guardian.report.sentSuccess"));
      navigate(`/guardian/orphans/${id}`);
    },
    onError: (err) => {
      const detail = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof detail === "string" ? detail : t("guardian.report.sentError"));
    },
  });

  function handleSend() {
    // Current calendar month → the report period. Mood maps to
    // psychological_status; the star rating + notes to educational_progress.
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    submit.mutate({
      orphan_id: id,
      report_type: "monthly",
      period_start: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      period_end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      psychological_status: { mood, note: moodDetail.trim() },
      educational_progress: { rating: stars, note: eduNotes.trim() },
    });
  }

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
            {/* Attachments (photo + voice) are DEFERRED to a later cut. They
                are rendered visible-but-disabled so the full flow stays
                discoverable to guardians.
                TODO(backend: media upload + MediaReview) — wire these to a
                guardian media-upload endpoint once the staff MediaReview
                moderation queue exists; they must land moderation_status=
                'pending' and never auto-publish. */}
            <div className="gru-attach" aria-label={t("guardian.report.attachTitle")}>
              <div className="gru-attach-head">
                <span className="gru-attach-title">{t("guardian.report.attachTitle")}</span>
                <span className="gru-soon-tag">{t("guardian.report.soonTag")}</span>
              </div>
              <div className="gru-attach-row">
                <button type="button" className="gru-attach-btn" disabled aria-disabled="true">
                  <svg className="gru-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  {t("guardian.report.addPhoto")}
                </button>
                <button type="button" className="gru-attach-btn" disabled aria-disabled="true">
                  <svg className="gru-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                  {t("guardian.report.addVoice")}
                </button>
              </div>
              <p className="gru-field-hint">{t("guardian.report.attachSoon")}</p>
            </div>
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
          <button
            type="button"
            className="gru-foot-btn gru-foot-btn--send"
            onClick={handleSend}
            disabled={submit.isPending}
          >
            {submit.isPending ? t("guardian.report.sending") : t("guardian.report.send")}
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
