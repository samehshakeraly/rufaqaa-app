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

const KIND_ACCENT: Record<string, string> = {
  sponsorship: "border-trust",
  payment: "border-success-500",
  report: "border-warning-500",
  media: "border-sky",
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

  if (isLoading) return <p className="text-gray-500">{t("common.loading")}</p>;
  if (error || !orphan) {
    return (
      <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
        {t("common.loadError")}
      </p>
    );
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {orphan.first_name} {orphan.family_name}
          </h1>
          <p className="text-sm text-gray-500">
            <span className="font-mono">{orphan.code}</span> ·{" "}
            {t(`orphans.caseStatus.${orphan.case_status}`, orphan.case_status)}
          </p>
        </div>
        <div className="flex gap-2">
          {showSponsorCta && (
            <Link to={`/sponsor/${orphan.code}/checkout`} className="btn-primary">
              {t("checkout.sponsorThisChild")}
            </Link>
          )}
          <Link
            to="/admin/orphans"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-gray-700 hover:bg-tranquil"
          >
            ← {t("orphans.title")}
          </Link>
        </div>
      </div>

      {(showApproveReject || showRelease) && (
        <div className="card flex flex-wrap items-center gap-3">
          {showApproveReject && (
            <>
              <button
                type="button"
                aria-label={t("orphans.actions.approve")}
                className="rounded-lg bg-success-600 px-3 py-2 text-sm font-medium text-white hover:bg-success-700 disabled:opacity-50"
                onClick={() => approveMut.mutate()}
                disabled={approveMut.isPending}
              >
                {t("orphans.actions.approve")}
              </button>
              <button
                type="button"
                aria-label={t("orphans.actions.reject")}
                className="rounded-lg bg-danger-600 px-3 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-50"
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
              className="rounded-lg border border-sky bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-tranquil disabled:opacity-50"
              onClick={() => releaseMut.mutate()}
              disabled={releaseMut.isPending}
            >
              {t("orphans.actions.release")}
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("orphans.title")}</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">{t("orphans.dateOfBirth")}</dt>
            <dd className="font-medium tabular-nums">{orphan.date_of_birth}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("orphans.gender")}</dt>
            <dd className="font-medium">
              {orphan.gender === "M" ? t("orphans.male") : t("orphans.female")}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("orphans.status")}</dt>
            <dd className="font-medium">
              {t(`orphans.caseStatus.${orphan.case_status}`, orphan.case_status)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">{t("orphans.balance")}</dt>
            <dd className="font-medium tabular-nums">{orphan.current_balance}</dd>
          </div>
        </dl>
      </div>

      <OrphanPhotoUpload orphanId={id} />

      {isPartnerApprover && pendingPhotos.length > 0 && (
        <div className="card space-y-3">
          <h2 className="text-lg font-semibold">{t("media.review.title")}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {pendingPhotos.map((p) => (
              <li
                key={p.id}
                className="overflow-hidden rounded-lg border border-sky bg-snow"
              >
                <img
                  src={p.presigned_url}
                  alt={t("media.review.thumbnailAlt", { id: p.id.slice(0, 8) })}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
                <div className="flex gap-1 p-2">
                  <button
                    type="button"
                    aria-label={`${t("media.moderate.approve")} ${p.id.slice(0, 8)}`}
                    className="flex-1 rounded bg-success-600 px-2 py-1 text-[10px] text-white hover:bg-success-700 disabled:opacity-50"
                    onClick={() => mediaApproveMut.mutate(p.id)}
                    disabled={mediaApproveMut.isPending}
                  >
                    {t("media.moderate.approve")}
                  </button>
                  <button
                    type="button"
                    aria-label={`${t("media.moderate.reject")} ${p.id.slice(0, 8)}`}
                    className="flex-1 rounded bg-danger-600 px-2 py-1 text-[10px] text-white hover:bg-danger-700 disabled:opacity-50"
                    onClick={() => setRejectMode({ kind: "media", mediaId: p.id })}
                    disabled={mediaRejectMut.isPending}
                  >
                    {t("media.moderate.reject")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DocumentUploadCard target={{ kind: "orphan", orphanId: id }} />

      <OrphanReportsCard orphanId={id} />

      <div className="card">
        <h2 className="mb-3 text-lg font-semibold">{t("orphans.timeline")}</h2>
        {!filteredTimeline && <p className="text-gray-500">{t("common.loading")}</p>}
        {filteredTimeline && filteredTimeline.items.length === 0 && (
          <p className="text-gray-500">{t("common.empty")}</p>
        )}
        {filteredTimeline && filteredTimeline.items.length > 0 && (
          <ol className="space-y-2">
            {filteredTimeline.items.map((e) => (
              <li
                key={`${e.kind}-${e.entity_id}-${e.when}`}
                className={`flex items-start gap-3 border-s-4 ${KIND_ACCENT[e.kind] ?? "border-sky"} bg-snow px-3 py-2 text-sm`}
              >
                <span className="min-w-[10rem] text-xs text-gray-500 tabular-nums">
                  {new Date(e.when).toLocaleString(i18n.language)}
                </span>
                <span className="rounded-md bg-tranquil px-2 py-0.5 text-xs font-medium uppercase">
                  {e.kind}
                </span>
                <span className="flex-1">{e.summary}</span>
                {canSeeAmounts && e.amount && (
                  <span className="font-mono text-xs text-gray-700 tabular-nums">
                    {e.amount} {e.currency}
                  </span>
                )}
                {e.status && (
                  <span className="text-xs text-gray-500">{e.status}</span>
                )}
              </li>
            ))}
          </ol>
        )}
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
    <div className="card">
      <h2 className="mb-3 text-lg font-semibold">{t("reports.title")}</h2>
      {isLoading && <p className="text-gray-500">{t("common.loading")}</p>}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="text-gray-500">{t("common.empty")}</p>
      )}
      {data && data.items.length > 0 && (
        <ul className="divide-y divide-sky/40 text-sm">
          {data.items.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <div>
                <span className="font-medium">
                  {t(`reports.types.${r.report_type}`, r.report_type)}
                </span>
                <span className="ms-2 text-xs text-gray-500 tabular-nums">
                  {r.period_start} → {r.period_end}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {t(`reports.statuses.${r.status}`, r.status)}
                </span>
                <Link
                  to={`/admin/reports/${r.id}`}
                  className="rounded-lg border border-sky px-2 py-1 text-xs text-gray-700 hover:bg-tranquil"
                >
                  {t("reports.open")}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
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
