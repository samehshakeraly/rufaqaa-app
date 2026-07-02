import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { Lightbox } from "@/components/Lightbox";
import {
  ACADEMIC_LEVELS,
  EDUCATION_STAGES,
  HEALTH_COVERAGES,
  HEALTH_STATUSES,
  MOTHER_STATUSES,
  PRIORITY_LEVELS,
} from "@/components/NewOrphanForm";
import { OrphanDocumentChecklist } from "@/components/OrphanDocumentChecklist";
import { useRole } from "@/hooks/useRole";
import { listOrphanages } from "@/lib/orphanages";
import {
  approveOrphan,
  getOrphan,
  getOrphanTimeline,
  rejectOrphan,
  releaseOrphan,
  updateOrphan,
  type AcademicLevel,
  type EducationStage,
  type HealthCoverage,
  type HealthStatus,
  type MotherStatus,
  type PriorityLevel,
  type Orphan,
  type OrphanUpdateInput,
} from "@/lib/orphans";
import { listOrphanPhotos, moderateMedia } from "@/lib/media";
import { listReports } from "@/lib/reports";
import { toast } from "@/store/toasts";

import "./OrphanDetailPage.css";

// Map a case_status onto a hero-badge variant (PS-04 visual language).
const STATUS_BADGE: Record<string, string> = {
  pending_review: "review",
  approved: "active",
  available: "active",
  reserved: "pending",
  sponsored: "active",
  graduated: "active",
  deceased: "archived",
  rejected: "archived",
  archived: "archived",
};

export function OrphanDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin, isDonor, isPartnerApprover, isStaff } = useRole();

  const { data: orphan, isLoading, error } = useQuery({
    queryKey: ["orphan", id],
    queryFn: () => getOrphan(id),
    enabled: !!id,
  });
  const { data: timeline } = useQuery({
    queryKey: ["orphan", id, "timeline"],
    queryFn: () => getOrphanTimeline(id),
    enabled: !!id,
  });
  const { data: photos } = useQuery({
    queryKey: ["orphan", id, "photos"],
    queryFn: () => listOrphanPhotos(id),
    enabled: !!id,
  });

  const [rejectMode, setRejectMode] = useState<
    | { kind: "orphan" }
    | { kind: "media"; mediaId: string }
    | null
  >(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const invalidateOrphan = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["orphan", id] }),
      qc.invalidateQueries({ queryKey: ["orphans"] }),
      qc.invalidateQueries({ queryKey: ["orphan", id, "timeline"] }),
    ]);

  const approveMut = useMutation({
    mutationFn: () => approveOrphan(id),
    onSuccess: async () => {
      await invalidateOrphan();
      toast.success(t("orphans.actions.approved"));
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });
  const rejectMut = useMutation({
    mutationFn: (reason: string) => rejectOrphan(id, reason),
    onSuccess: async () => {
      await invalidateOrphan();
      toast.success(t("orphans.actions.rejected"));
      setRejectMode(null);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });
  const releaseMut = useMutation({
    mutationFn: () => releaseOrphan(id),
    onSuccess: async () => {
      await invalidateOrphan();
      toast.success(t("orphans.actions.released"));
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  const invalidatePhotos = () =>
    qc.invalidateQueries({ queryKey: ["orphan", id, "photos"] });

  const mediaApproveMut = useMutation({
    mutationFn: (mediaId: string) => moderateMedia(mediaId, "approve"),
    onSuccess: async () => {
      await invalidatePhotos();
      toast.success(t("media.moderate.approved"));
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });
  const mediaRejectMut = useMutation({
    mutationFn: ({ mediaId, notes }: { mediaId: string; notes: string }) =>
      moderateMedia(mediaId, "reject", notes),
    onSuccess: async () => {
      await invalidatePhotos();
      toast.success(t("media.moderate.rejected"));
      setRejectMode(null);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  if (isLoading) return <p className="ps-detail-msg">{t("common.loading")}</p>;
  if (error || !orphan) {
    return <p className="ps-detail-error">{t("common.loadError")}</p>;
  }

  // Donor-facing CTA must never leak to partner staff/managers. Only
  // admins (who legitimately need to act on behalf of donors) and donors
  // themselves get the sponsor link.
  const showSponsorCta = isAdmin || isDonor;

  const showApproveReject =
    isPartnerApprover && orphan.case_status === "pending_review";
  const showRelease =
    isPartnerApprover &&
    (orphan.case_status === "approved" || orphan.case_status === "reserved");

  // Timeline privacy filter (defence-in-depth — backend gate is a TODO):
  // non-admin/non-approver viewers must not see internal payment events.
  const canSeeAmounts = isAdmin || isPartnerApprover;
  const filteredTimeline = timeline
    ? {
        ...timeline,
        items: canSeeAmounts
          ? timeline.items
          : timeline.items.filter((e) => e.kind !== "payment"),
      }
    : undefined;

  const pendingPhotos = photos?.filter((p) => p.moderation_status === "pending") ?? [];
  const statusLabel = t(`orphans.caseStatus.${orphan.case_status}`, orphan.case_status);
  const badgeVariant = STATUS_BADGE[orphan.case_status] ?? "archived";

  return (
    <div className="ps-detail">
      {/* Breadcrumb */}
      <nav className="ps-crumb" aria-label="breadcrumb">
        <Link to="/admin/orphans">{t("orphans.title")}</Link>
        <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span className="ps-crumb-current">{orphan.code}</span>
      </nav>

      {/* Hero — the single semantic h1 is the orphan's name. */}
      <div className="ps-hero">
        <div className="ps-hero-photo" aria-hidden="true">
          {orphan.first_name?.trim()?.[0] ?? "—"}
        </div>
        <div className="ps-hero-text">
          <span className="ps-hero-code">{orphan.code}</span>
          <h1 className="ps-hero-name">
            {orphan.first_name} {orphan.family_name}
          </h1>
          <div className="ps-hero-meta">
            <span className="tabular-nums">{orphan.date_of_birth}</span>
            <span className="dot" aria-hidden="true" />
            <span>{orphan.gender === "M" ? t("orphans.male") : t("orphans.female")}</span>
            <span className="dot" aria-hidden="true" />
            <span>
              {t("orphans.balance")}:{" "}
              <span className="tabular-nums">{orphan.current_balance}</span>
            </span>
          </div>
          <div className="ps-hero-badges">
            <span className={`ps-badge ${badgeVariant}`}>
              <span className="dot" aria-hidden="true" />
              {statusLabel}
            </span>
            <span className={`ps-badge ${orphan.is_sponsored ? "active" : "partner"}`}>
              {orphan.is_sponsored ? t("orphans.sponsored") : t("orphans.notSponsored")}
            </span>
          </div>
        </div>
        <div className="ps-hero-actions">
          {showSponsorCta && (
            <Link to={`/sponsor/${orphan.code}/checkout`} className="ps-btn ps-btn-primary">
              {t("checkout.sponsorThisChild")}
            </Link>
          )}
          <Link to="/admin/orphans" className="ps-btn">
            {t("orphans.register.back")}
          </Link>
        </div>
      </div>

      {/* Pending review banner — approver-only action surface. partner_staff
          never sees approve / reject / release here (gating preserved). */}
      {(showApproveReject || showRelease) && (
        <div className="ps-pending-banner">
          <div className="ps-pending-banner-icon" aria-hidden="true">
            <svg className="ps-icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="ps-pending-banner-text">
            <h2>{showApproveReject ? t("orphans.subtitle.approvals") : statusLabel}</h2>
            <p>{t("orphans.detail.approverHint")}</p>
          </div>
          <div className="ps-pending-banner-actions">
            {showApproveReject && (
              <>
                <button
                  type="button"
                  aria-label={t("orphans.actions.approve")}
                  className="ps-btn ps-btn-success"
                  onClick={() => approveMut.mutate()}
                  disabled={approveMut.isPending}
                >
                  {t("orphans.actions.approve")}
                </button>
                <button
                  type="button"
                  aria-label={t("orphans.actions.reject")}
                  className="ps-btn ps-btn-danger"
                  onClick={() => setRejectMode({ kind: "orphan" })}
                  disabled={rejectMut.isPending}
                >
                  {t("orphans.actions.reject")}
                </button>
              </>
            )}
            {showRelease && (
              <button
                type="button"
                aria-label={t("orphans.actions.release")}
                className="ps-btn"
                onClick={() => releaseMut.mutate()}
                disabled={releaseMut.isPending}
              >
                {t("orphans.actions.release")}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="ps-col-2">
        {/* Main column */}
        <div className="ps-stack">
          <section className="ps-info-block">
            <div className="ps-info-block-head">
              <span className="ps-info-block-title">
                <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                {t("orphans.title")}
              </span>
            </div>
            <div className="ps-info-rows">
              <div className="ps-info-row">
                <span className="ps-info-row-label">{t("orphans.dateOfBirth")}</span>
                <span className="ps-info-row-value tabular-nums">{orphan.date_of_birth}</span>
              </div>
              <div className="ps-info-row">
                <span className="ps-info-row-label">{t("orphans.gender")}</span>
                <span className="ps-info-row-value">
                  {orphan.gender === "M" ? t("orphans.male") : t("orphans.female")}
                </span>
              </div>
              <div className="ps-info-row">
                <span className="ps-info-row-label">{t("orphans.status")}</span>
                <span className="ps-info-row-value">{statusLabel}</span>
              </div>
              <div className="ps-info-row">
                <span className="ps-info-row-label">{t("orphans.balance")}</span>
                <span className="ps-info-row-value tabular-nums">{orphan.current_balance}</span>
              </div>
            </div>
          </section>

          {/* Full orphan profile — staff-only surface. Sensitive fields
              (health_coverage, chronic_conditions, challenges) live here and
              must NOT leak onto guardian/donor surfaces. */}
          {isStaff && <OrphanProfileCard orphan={orphan} />}

          <OrphanReportsCard orphanId={id} />

          <section className="ps-info-block">
            <div className="ps-info-block-head">
              <span className="ps-info-block-title">
                <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                  <line x1="12" y1="20" x2="12" y2="10" />
                  <line x1="18" y1="20" x2="18" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="16" />
                </svg>
                {t("orphans.timeline")}
              </span>
            </div>
            <div className="ps-timeline">
              {!filteredTimeline && <p className="ps-detail-msg">{t("common.loading")}</p>}
              {filteredTimeline && filteredTimeline.items.length === 0 && (
                <p className="ps-detail-msg">{t("common.empty")}</p>
              )}
              {filteredTimeline && filteredTimeline.items.length > 0 && (
                <ol>
                  {filteredTimeline.items.map((e) => (
                    <li
                      key={`${e.kind}-${e.entity_id}-${e.when}`}
                      className="ps-audit-row"
                    >
                      <span className={`ps-audit-dot ${e.kind}`} aria-hidden="true" />
                      <div className="ps-audit-body">
                        <div className="ps-audit-summary">{e.summary}</div>
                        <div className="ps-audit-meta">
                          <span className="ps-audit-kind">{e.kind}</span>
                          <span className="tabular-nums">
                            {new Date(e.when).toLocaleString(i18n.language)}
                          </span>
                          {e.status && <span>{e.status}</span>}
                        </div>
                      </div>
                      {canSeeAmounts && e.amount && (
                        <span className="ps-audit-amount">
                          {e.amount} {e.currency}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>

        {/* Side column */}
        <div className="ps-stack">
          {/* Guided uploader: personal photo + the country-driven document
              slots (required/optional badges resolved from orphan.nationality). */}
          <OrphanDocumentChecklist orphanId={id} nationality={orphan.nationality} />

          {isPartnerApprover && pendingPhotos.length > 0 && (
            <section className="ps-info-block">
              <div className="ps-info-block-head">
                <span className="ps-info-block-title">
                  <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  {t("media.review.title")}
                </span>
              </div>
              <div className="ps-media-grid">
                {pendingPhotos.map((p) => (
                  <div key={p.id} className="ps-media-card">
                    <button
                      type="button"
                      className="ps-media-card-thumb-btn"
                      aria-label={t("common.viewFullSize")}
                      onClick={() => setLightbox(p.presigned_url)}
                    >
                      <img
                        src={p.presigned_url}
                        alt={t("media.review.thumbnailAlt", { id: p.id.slice(0, 8) })}
                        loading="lazy"
                      />
                    </button>
                    <div className="ps-media-card-actions">
                      <button
                        type="button"
                        aria-label={`${t("media.moderate.approve")} ${p.id.slice(0, 8)}`}
                        className="ps-media-mini ok"
                        onClick={() => mediaApproveMut.mutate(p.id)}
                        disabled={mediaApproveMut.isPending}
                      >
                        {t("media.moderate.approve")}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t("media.moderate.reject")} ${p.id.slice(0, 8)}`}
                        className="ps-media-mini no"
                        onClick={() => setRejectMode({ kind: "media", mediaId: p.id })}
                        disabled={mediaRejectMut.isPending}
                      >
                        {t("media.moderate.reject")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      {rejectMode && (
        <ReasonDialog
          title={
            rejectMode.kind === "orphan"
              ? t("orphans.actions.rejectReason")
              : t("media.moderate.notesLabel")
          }
          placeholder={
            rejectMode.kind === "orphan"
              ? t("orphans.actions.rejectReasonPlaceholder")
              : t("media.moderate.notesPlaceholder")
          }
          submitLabel={
            rejectMode.kind === "orphan"
              ? t("orphans.actions.rejectSubmit")
              : t("media.moderate.reject")
          }
          isSubmitting={
            rejectMode.kind === "orphan"
              ? rejectMut.isPending
              : mediaRejectMut.isPending
          }
          onCancel={() => setRejectMode(null)}
          onSubmit={(reason) => {
            if (rejectMode.kind === "orphan") {
              rejectMut.mutate(reason);
            } else {
              mediaRejectMut.mutate({ mediaId: rejectMode.mediaId, notes: reason });
            }
          }}
        />
      )}
    </div>
  );
}

// ── Profile (staff view + edit) ─────────────────────────────────────────
// The full PR #64/#65 profile, rendered read-only by default with an inline
// edit mode so staff can complete/correct a child's file on behalf of a
// guardian. PATCH /orphans/{id} accepts every field; we send only what
// changed.

interface ProfileDraft {
  orphanage_id: string;
  education_stage: string;
  academic_level: string;
  school_name: string;
  quran_juz_memorized: string;
  current_juz: string;
  quran_note: string;
  health_status: string;
  health_coverage: string;
  chronic_conditions: string;
  mother_status: string;
  priority_level: string;
  aspiration: string;
  challenges: string;
  tags: string[];
  languages: string[];
}

function draftFromOrphan(o: Orphan): ProfileDraft {
  return {
    orphanage_id: o.orphanage_id ?? "",
    education_stage: o.education_stage ?? "",
    academic_level: o.academic_level ?? "",
    school_name: o.school_name ?? "",
    quran_juz_memorized:
      o.quran_juz_memorized != null ? String(o.quran_juz_memorized) : "",
    current_juz: o.current_juz != null ? String(o.current_juz) : "",
    quran_note: o.quran_note ?? "",
    health_status: o.health_status ?? "",
    health_coverage: o.health_coverage ?? "",
    chronic_conditions: o.chronic_conditions ?? "",
    mother_status: o.mother_status ?? "",
    priority_level: o.priority_level ?? "",
    aspiration: o.aspiration ?? "",
    challenges: o.challenges ?? "",
    tags: o.tags ?? [],
    languages: o.languages ?? [],
  };
}

// Diff a string/enum field: returns the value to send (trimmed string, or
// null to clear) when it changed, else undefined (omit from payload).
function diffStr(
  orig: string | null | undefined,
  next: string,
): string | null | undefined {
  const o = orig ?? "";
  const n = next.trim();
  if (n === o) return undefined;
  return n === "" ? null : n;
}

function buildProfilePayload(o: Orphan, d: ProfileDraft): OrphanUpdateInput {
  const payload: OrphanUpdateInput = {};

  // Dar assignment: a changed value (UUID or "" → null) is sent; null clears it.
  const orphanage = diffStr(o.orphanage_id, d.orphanage_id);
  if (orphanage !== undefined) payload.orphanage_id = orphanage;

  const stage = diffStr(o.education_stage, d.education_stage);
  if (stage !== undefined) payload.education_stage = stage as EducationStage | null;
  const academic = diffStr(o.academic_level, d.academic_level);
  if (academic !== undefined) payload.academic_level = academic as AcademicLevel | null;
  const school = diffStr(o.school_name, d.school_name);
  if (school !== undefined) payload.school_name = school;
  const quranNote = diffStr(o.quran_note, d.quran_note);
  if (quranNote !== undefined) payload.quran_note = quranNote;
  const status = diffStr(o.health_status, d.health_status);
  if (status !== undefined) payload.health_status = status as HealthStatus | null;
  const coverage = diffStr(o.health_coverage, d.health_coverage);
  if (coverage !== undefined)
    payload.health_coverage = coverage as HealthCoverage | null;
  const chronic = diffStr(o.chronic_conditions, d.chronic_conditions);
  if (chronic !== undefined) payload.chronic_conditions = chronic;
  const mother = diffStr(o.mother_status, d.mother_status);
  if (mother !== undefined) payload.mother_status = mother as MotherStatus | null;
  const priority = diffStr(o.priority_level, d.priority_level);
  if (priority !== undefined) payload.priority_level = priority as PriorityLevel | null;
  const aspiration = diffStr(o.aspiration, d.aspiration);
  if (aspiration !== undefined) payload.aspiration = aspiration;
  const challenges = diffStr(o.challenges, d.challenges);
  if (challenges !== undefined) payload.challenges = challenges;

  const qStr = d.quran_juz_memorized.trim();
  const qNext = qStr === "" ? null : Number(qStr);
  const qOrig = o.quran_juz_memorized ?? null;
  if (qNext !== qOrig && !(qNext !== null && Number.isNaN(qNext))) {
    payload.quran_juz_memorized = qNext;
  }

  const cjStr = d.current_juz.trim();
  const cjNext = cjStr === "" ? null : Number(cjStr);
  const cjOrig = o.current_juz ?? null;
  if (cjNext !== cjOrig && !(cjNext !== null && Number.isNaN(cjNext))) {
    payload.current_juz = cjNext;
  }

  const tagsOrig = o.tags ?? [];
  if (JSON.stringify(d.tags) !== JSON.stringify(tagsOrig)) {
    payload.tags = d.tags;
  }

  const languagesOrig = o.languages ?? [];
  if (JSON.stringify(d.languages) !== JSON.stringify(languagesOrig)) {
    payload.languages = d.languages;
  }

  return payload;
}

function OrphanProfileCard({ orphan }: { orphan: Orphan }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromOrphan(orphan));
  const [tagInput, setTagInput] = useState("");
  const [languageInput, setLanguageInput] = useState("");

  // Org dars, to render the assignment by name (read) and offer the picker
  // (edit). Shares the ["orphanages"] cache with the list/create surfaces.
  const { data: orphanagesPage } = useQuery({
    queryKey: ["orphanages"],
    queryFn: () => listOrphanages({ limit: 100 }),
  });
  const orphanages = orphanagesPage?.items ?? [];
  const orphanageName = (id: string | null): string | null => {
    if (!id) return null;
    const found = orphanages.find((o) => o.id === id);
    if (!found) return null;
    return i18n.language === "ar" ? found.name_ar : found.name_en ?? found.name_ar;
  };

  const updateMut = useMutation({
    mutationFn: (payload: OrphanUpdateInput) => updateOrphan(orphan.id, payload),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["orphan", orphan.id] }),
        qc.invalidateQueries({ queryKey: ["orphans"] }),
      ]);
      toast.success(t("orphans.profile.saved"));
      setEditing(false);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  function beginEdit() {
    setDraft(draftFromOrphan(orphan));
    setTagInput("");
    setLanguageInput("");
    setEditing(true);
  }

  function cancel() {
    setTagInput("");
    setLanguageInput("");
    setEditing(false);
  }

  function save() {
    const payload = buildProfilePayload(orphan, draft);
    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }
    updateMut.mutate(payload);
  }

  function addTag() {
    const next = tagInput.trim();
    if (!next || draft.tags.includes(next)) {
      setTagInput("");
      return;
    }
    setDraft((d) => ({ ...d, tags: [...d.tags, next] }));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== tag) }));
  }

  function addLanguage() {
    const next = languageInput.trim();
    if (!next || draft.languages.includes(next)) {
      setLanguageInput("");
      return;
    }
    setDraft((d) => ({ ...d, languages: [...d.languages, next] }));
    setLanguageInput("");
  }

  function removeLanguage(language: string) {
    setDraft((d) => ({ ...d, languages: d.languages.filter((x) => x !== language) }));
  }

  const notSet = <span className="ps-info-muted">{t("orphans.profile.notSet")}</span>;
  const text = (v?: string | null) => (v && v.trim() ? v : notSet);

  return (
    <section className="ps-info-block">
      <div className="ps-info-block-head">
        <span className="ps-info-block-title">
          <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          {t("orphans.profile.title")}
        </span>
        {!editing && (
          <button type="button" className="ps-btn" onClick={beginEdit}>
            {t("orphans.profile.edit")}
          </button>
        )}
      </div>

      {!editing && (
        <div className="ps-info-rows">
          <ProfileRow label={t("orphans.orphanage.label")}>
            {orphan.orphanage_id ? (
              orphanageName(orphan.orphanage_id) ?? t("orphans.orphanage.resident")
            ) : (
              <span className="ps-info-muted">{t("orphans.orphanage.familyHome")}</span>
            )}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.educationStage")}>
            {orphan.education_stage
              ? t(`orphans.profile.educationStageOptions.${orphan.education_stage}`)
              : notSet}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.academicLevel")}>
            {orphan.academic_level
              ? t(`orphans.profile.academicLevelOptions.${orphan.academic_level}`, {
                  defaultValue: orphan.academic_level,
                })
              : notSet}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.schoolName")}>
            {text(orphan.school_name)}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.quranJuzMemorized")}>
            {orphan.quran_juz_memorized != null ? (
              <>
                <span className="tabular-nums">{orphan.quran_juz_memorized}</span>
                {orphan.is_hafiz && (
                  <span className="ps-badge active ps-hafiz-badge">
                    {t("orphans.profile.isHafiz")}
                  </span>
                )}
              </>
            ) : (
              notSet
            )}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.currentJuz")}>
            {orphan.current_juz != null ? (
              <span className="tabular-nums">{orphan.current_juz}</span>
            ) : (
              notSet
            )}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.quranNote")}>
            {text(orphan.quran_note)}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.healthStatus")}>
            {orphan.health_status
              ? t(`orphans.profile.healthStatusOptions.${orphan.health_status}`)
              : notSet}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.healthCoverage")}>
            {orphan.health_coverage
              ? t(`orphans.profile.healthCoverageOptions.${orphan.health_coverage}`)
              : notSet}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.motherStatus")}>
            {orphan.mother_status
              ? t(`orphans.profile.motherStatusOptions.${orphan.mother_status}`)
              : notSet}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.priorityLevel")}>
            {orphan.priority_level
              ? t(`orphans.profile.priorityLevelOptions.${orphan.priority_level}`)
              : notSet}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.chronicConditions")}>
            {text(orphan.chronic_conditions)}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.aspiration")}>
            {text(orphan.aspiration)}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.challenges")}>
            {text(orphan.challenges)}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.tags.label")}>
            {orphan.tags && orphan.tags.length > 0 ? (
              <span className="ps-tag-chips">
                {orphan.tags.map((tag) => (
                  <span key={tag} className="ps-badge partner">
                    {tag}
                  </span>
                ))}
              </span>
            ) : (
              notSet
            )}
          </ProfileRow>
          <ProfileRow label={t("orphans.profile.languages.label")}>
            {orphan.languages && orphan.languages.length > 0 ? (
              <span className="ps-tag-chips">
                {orphan.languages.map((language) => (
                  <span key={language} className="ps-badge partner">
                    {language}
                  </span>
                ))}
              </span>
            ) : (
              notSet
            )}
          </ProfileRow>
        </div>
      )}

      {editing && (
        <>
          <div className="ps-info-rows">
            <ProfileEditField label={t("orphans.orphanage.label")}>
              <select
                className="input"
                value={draft.orphanage_id}
                onChange={(e) => setDraft((d) => ({ ...d, orphanage_id: e.target.value }))}
              >
                <option value="">{t("orphans.orphanage.familyHome")}</option>
                {orphanages.map((o) => (
                  <option key={o.id} value={o.id}>
                    {i18n.language === "ar" ? o.name_ar : o.name_en ?? o.name_ar}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.educationStage")}>
              <select
                className="input"
                value={draft.education_stage}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, education_stage: e.target.value }))
                }
              >
                <option value="">{t("orphans.profile.notSpecified")}</option>
                {EDUCATION_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`orphans.profile.educationStageOptions.${s}`)}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.academicLevel")}>
              <select
                className="input"
                value={draft.academic_level}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, academic_level: e.target.value }))
                }
              >
                <option value="">{t("orphans.profile.notSpecified")}</option>
                {ACADEMIC_LEVELS.map((s) => (
                  <option key={s} value={s}>
                    {t(`orphans.profile.academicLevelOptions.${s}`)}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.schoolName")}>
              <input
                className="input"
                value={draft.school_name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, school_name: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.quranJuzMemorized")}>
              <input
                type="number"
                min={0}
                max={30}
                step={1}
                className="input"
                value={draft.quran_juz_memorized}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, quran_juz_memorized: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.currentJuz")}>
              <input
                type="number"
                min={1}
                max={30}
                step={1}
                className="input"
                value={draft.current_juz}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, current_juz: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.quranNote")}>
              <input
                className="input"
                value={draft.quran_note}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, quran_note: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.healthStatus")}>
              <select
                className="input"
                value={draft.health_status}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, health_status: e.target.value }))
                }
              >
                <option value="">{t("orphans.profile.notSpecified")}</option>
                {HEALTH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`orphans.profile.healthStatusOptions.${s}`)}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.healthCoverage")}>
              <select
                className="input"
                value={draft.health_coverage}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, health_coverage: e.target.value }))
                }
              >
                <option value="">{t("orphans.profile.notSpecified")}</option>
                {HEALTH_COVERAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`orphans.profile.healthCoverageOptions.${s}`)}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.motherStatus")}>
              <select
                className="input"
                value={draft.mother_status}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, mother_status: e.target.value }))
                }
              >
                <option value="">{t("orphans.profile.notSpecified")}</option>
                {MOTHER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`orphans.profile.motherStatusOptions.${s}`)}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.priorityLevel")}>
              <select
                className="input"
                value={draft.priority_level}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, priority_level: e.target.value }))
                }
              >
                <option value="">{t("orphans.profile.notSpecified")}</option>
                {PRIORITY_LEVELS.map((s) => (
                  <option key={s} value={s}>
                    {t(`orphans.profile.priorityLevelOptions.${s}`)}
                  </option>
                ))}
              </select>
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.chronicConditions")}>
              <textarea
                className="input"
                rows={2}
                value={draft.chronic_conditions}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, chronic_conditions: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.aspiration")}>
              <textarea
                className="input"
                rows={2}
                value={draft.aspiration}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, aspiration: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.challenges")}>
              <textarea
                className="input"
                rows={2}
                value={draft.challenges}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, challenges: e.target.value }))
                }
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.tags.label")}>
              {draft.tags.length > 0 && (
                <div className="ps-tag-chips ps-tag-chips-edit">
                  {draft.tags.map((tag) => (
                    <span key={tag} className="ps-badge partner">
                      {tag}
                      <button
                        type="button"
                        aria-label={t("orphans.profile.tags.remove", { tag })}
                        className="ps-tag-remove"
                        onClick={() => removeTag(tag)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                className="input"
                value={tagInput}
                placeholder={t("orphans.profile.tags.placeholder")}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
            </ProfileEditField>
            <ProfileEditField label={t("orphans.profile.languages.label")}>
              {draft.languages.length > 0 && (
                <div className="ps-tag-chips ps-tag-chips-edit">
                  {draft.languages.map((language) => (
                    <span key={language} className="ps-badge partner">
                      {language}
                      <button
                        type="button"
                        aria-label={t("orphans.profile.languages.remove", { language })}
                        className="ps-tag-remove"
                        onClick={() => removeLanguage(language)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                className="input"
                value={languageInput}
                placeholder={t("orphans.profile.languages.placeholder")}
                onChange={(e) => setLanguageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLanguage();
                  }
                }}
              />
            </ProfileEditField>
          </div>
          <div className="ps-profile-edit-actions">
            <button
              type="button"
              className="ps-btn ps-btn-primary"
              onClick={save}
              disabled={updateMut.isPending}
            >
              {updateMut.isPending ? t("common.saving") : t("common.save")}
            </button>
            <button
              type="button"
              className="ps-btn"
              onClick={cancel}
              disabled={updateMut.isPending}
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ProfileRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ps-info-row">
      <span className="ps-info-row-label">{label}</span>
      <span className="ps-info-row-value">{children}</span>
    </div>
  );
}

function ProfileEditField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="ps-edit-field">
      <span className="ps-edit-field-label">{label}</span>
      {children}
    </label>
  );
}

function OrphanReportsCard({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["reports", { orphan_id: orphanId }],
    queryFn: () => listReports({ orphan_id: orphanId, limit: 50 }),
    enabled: !!orphanId,
  });
  return (
    <section className="ps-info-block">
      <div className="ps-info-block-head">
        <span className="ps-info-block-title">
          <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          {t("reports.title")}
        </span>
      </div>
      {isLoading && <p className="ps-detail-msg" style={{ padding: "14px 16px" }}>{t("common.loading")}</p>}
      {error && (
        <p className="ps-detail-error" style={{ margin: 14 }}>
          {t("common.loadError")}
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="ps-detail-msg" style={{ padding: "14px 16px" }}>{t("common.empty")}</p>
      )}
      {data && data.items.length > 0 && (
        <ul>
          {data.items.map((r) => (
            <li key={r.id} className="ps-report-row">
              <div>
                <span className="ps-report-type">
                  {t(`reports.types.${r.report_type}`, r.report_type)}
                </span>
                <span className="ps-report-period tabular-nums">
                  {r.period_start} → {r.period_end}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="ps-report-status">
                  {t(`reports.statuses.${r.status}`, r.status)}
                </span>
                <Link to={`/admin/reports/${r.id}`} className="ps-btn">
                  {t("reports.open")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface ReasonDialogProps {
  title: string;
  placeholder: string;
  submitLabel: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

function ReasonDialog({
  title,
  placeholder,
  submitLabel,
  isSubmitting,
  onCancel,
  onSubmit,
}: ReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > 1000) {
      setError(t("common.required"));
      return;
    }
    setError(null);
    onSubmit(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <textarea
          className="input"
          rows={4}
          autoFocus
          maxLength={1000}
          placeholder={placeholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-gray-700 hover:bg-tranquil"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-danger-600 px-3 py-1 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? t("common.saving") : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
