import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { DocumentUploadCard } from "@/components/DocumentUploadCard";
import { OrphanPhotoUpload } from "@/components/OrphanPhotoUpload";
import { useRole } from "@/hooks/useRole";
import {
  approveOrphan,
  getOrphan,
  getOrphanTimeline,
  rejectOrphan,
  releaseOrphan,
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
  const { isAdmin, isDonor, isPartnerApprover } = useRole();

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
          <OrphanPhotoUpload orphanId={id} />

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
                    <img
                      src={p.presigned_url}
                      alt={t("media.review.thumbnailAlt", { id: p.id.slice(0, 8) })}
                      loading="lazy"
                    />
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

          <DocumentUploadCard target={{ kind: "orphan", orphanId: id }} />
        </div>
      </div>

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
