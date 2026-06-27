import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import { formatDate } from "@/lib/format";
import {
  listOrphanMedia,
  moderateMedia,
  needsConsent,
  sponsorVisibility,
  updateMedia,
  uploadOrphanMedia,
  UPLOAD_CATEGORIES,
  type MediaCategory,
  type MediaManageRead,
  type MediaPatch,
} from "@/lib/orphanMedia";

const MAX_BYTES = 10 * 1024 * 1024;

const queryKey = (orphanId: string) => ["orphan", orphanId, "media"];

/** Map an axios failure to a user-facing i18n key. The PR-4 backend surfaces
 * 415 (unsupported MIME), 413 (>10MB), 403 (not permitted), 422 (bad field). */
function errorKey(err: unknown): string {
  if (err instanceof AxiosError) {
    switch (err.response?.status) {
      case 415:
        return "orphanMedia.errors.unsupportedType";
      case 413:
        return "orphanMedia.errors.tooLarge";
      case 403:
        return "orphanMedia.errors.forbidden";
      case 422:
        return "orphanMedia.errors.invalid";
    }
  }
  return "orphanMedia.errors.generic";
}

/**
 * Supervisor/manager media manager for one orphan's memory box (PR-6).
 *
 * Surfaces ALL of the orphan's media — including hidden, pending and
 * consent-blocked rows the sponsor never sees — and exposes the path to
 * "visible to sponsor": upload → approve → (consent for recitation/album).
 * Hiding is "archive" (no hard-delete endpoint exists). The manager holds both
 * staff and media-moderator rights, so every action here is permitted.
 */
export function OrphanMediaManager({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();

  const mediaQ = useQuery({
    queryKey: queryKey(orphanId),
    queryFn: () => listOrphanMedia(orphanId),
    enabled: Boolean(orphanId),
  });

  return (
    <div className="space-y-6">
      <UploadPanel orphanId={orphanId} />

      {mediaQ.isLoading && (
        <div className="space-y-3" role="status" aria-label={t("common.loading")}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {mediaQ.isError && (
        <div
          className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-600/20 dark:text-danger-100"
          role="alert"
        >
          {t("orphanMedia.loadError")}
        </div>
      )}

      {mediaQ.data && mediaQ.data.length === 0 && (
        <div
          className="rounded-xl border border-sky-200 bg-snow-100 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400"
          role="status"
        >
          {t("orphanMedia.empty")}
        </div>
      )}

      {mediaQ.data && mediaQ.data.length > 0 && (
        <ul className="space-y-3">
          {mediaQ.data.map((item) => (
            <MediaCard key={item.id} orphanId={orphanId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Upload one new memory-box item. Limited to the four sponsor-facing
 * categories (portrait/avatar is managed elsewhere). */
function UploadPanel({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [category, setCategory] = useState<MediaCategory | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [displayDate, setDisplayDate] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const upload = useMutation({
    mutationFn: () =>
      uploadOrphanMedia(orphanId, {
        category: category as MediaCategory,
        file: file as File,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        display_date: displayDate || undefined,
      }),
    onSuccess: async () => {
      setServerError(null);
      setCategory("");
      setFile(null);
      setTitle("");
      setDescription("");
      setDisplayDate("");
      setDone(true);
      await qc.invalidateQueries({ queryKey: queryKey(orphanId) });
    },
    onError: (err) => setServerError(t(errorKey(err))),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setServerError(null);
    setDone(false);
    if (!category) {
      setFieldError(t("orphanMedia.upload.categoryRequired"));
      return;
    }
    if (!file) {
      setFieldError(t("orphanMedia.upload.fileRequired"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setFieldError(t("orphanMedia.errors.tooLarge"));
      return;
    }
    upload.mutate();
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40"
      aria-labelledby="orphan-media-upload-title"
    >
      <h3
        id="orphan-media-upload-title"
        className="text-sm font-semibold text-gray-900 dark:text-gray-100"
      >
        {t("orphanMedia.upload.title")}
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanMedia.upload.category")}
          </span>
          <select
            className="input w-full"
            value={category}
            onChange={(e) => setCategory(e.target.value as MediaCategory | "")}
            required
          >
            <option value="">{t("orphanMedia.upload.categoryPlaceholder")}</option>
            {UPLOAD_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`orphanMedia.category.${c}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanMedia.upload.file")}
          </span>
          <input
            type="file"
            className="block w-full text-sm text-gray-700 dark:text-gray-200"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanMedia.upload.fileHelp")}
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanMedia.upload.titleLabel")}
          </span>
          <input
            type="text"
            className="input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanMedia.upload.displayDate")}
          </span>
          <input
            type="date"
            className="input w-full"
            value={displayDate}
            onChange={(e) => setDisplayDate(e.target.value)}
          />
        </label>

        <label className="block space-y-1 sm:col-span-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanMedia.upload.caption")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>

      {fieldError && (
        <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
          {fieldError}
        </p>
      )}
      {serverError && (
        <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
          {serverError}
        </p>
      )}
      {done && (
        <p className="text-sm font-medium text-success-700" role="status">
          {t("orphanMedia.upload.success")}
        </p>
      )}

      <div>
        <button type="submit" className="btn-primary" disabled={upload.isPending}>
          {upload.isPending ? t("orphanMedia.upload.submitting") : t("orphanMedia.upload.submit")}
        </button>
      </div>
    </form>
  );
}

/** One media item: preview, metadata, status/visibility/consent indicators, the
 * derived "visible / hidden — reason" line, and the per-item actions. */
function MediaCard({ orphanId, item }: { orphanId: string; item: MediaManageRead }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKey(orphanId) });

  const patch = useMutation({
    mutationFn: (body: MediaPatch) => updateMedia(item.id, body),
    onSuccess: async () => {
      setError(null);
      setEditing(false);
      await invalidate();
    },
    onError: (err) => setError(t(errorKey(err))),
  });

  const moderate = useMutation({
    mutationFn: (decision: "approve" | "reject") => moderateMedia(item.id, decision),
    onSuccess: async () => {
      setError(null);
      await invalidate();
    },
    onError: (err) => setError(t(errorKey(err))),
  });

  const busy = patch.isPending || moderate.isPending;
  const { visible, reason } = sponsorVisibility(item);
  const category = item.category ?? "";
  const isRecitation = item.media_type === "audio" || item.category === "recitation";
  const categoryLabel = category
    ? t(`orphanMedia.category.${category}`, { defaultValue: category })
    : t("orphanMedia.category.unknown");
  const titleText = item.title || categoryLabel;
  const isSponsorState =
    item.moderation_status === "approved" &&
    (item.visibility === "donor_only" || item.visibility === "public");

  return (
    <li className="space-y-3 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="flex gap-4">
        {/* Preview */}
        <div className="shrink-0">
          {isRecitation ? (
            <audio
              controls
              src={item.url}
              className="w-48 max-w-full"
              aria-label={t("orphanMedia.audioLabel", { title: titleText })}
            />
          ) : (
            <img
              src={item.thumbnail_url ?? item.url}
              alt={titleText}
              className="h-20 w-20 rounded-lg border border-sky-200 object-cover dark:border-gray-700"
              loading="lazy"
            />
          )}
        </div>

        {/* Metadata + indicators */}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-tranquil-100 px-2.5 py-0.5 text-xs font-medium text-trust-700 dark:bg-trust-900/40 dark:text-trust-100">
              {categoryLabel}
            </span>
            <span
              className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-100"
              aria-label={t("orphanMedia.statusLabel")}
            >
              {t(`orphanMedia.status.${item.moderation_status}`, {
                defaultValue: item.moderation_status,
              })}
            </span>
            <span
              className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-100"
              aria-label={t("orphanMedia.visibilityLabel")}
            >
              {t(`orphanMedia.visibility.${item.visibility}`, {
                defaultValue: item.visibility,
              })}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                item.has_guardian_consent
                  ? "bg-success-100 text-success-700"
                  : "bg-warning-100 text-warning-700"
              }`}
            >
              {item.has_guardian_consent
                ? t("orphanMedia.consent.on")
                : t("orphanMedia.consent.off")}
            </span>
          </div>

          <p className="font-medium text-gray-900 dark:text-gray-100">{titleText}</p>
          {item.description && (
            <p className="text-sm text-gray-600 dark:text-gray-300">{item.description}</p>
          )}
          {item.display_date && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(item.display_date, i18n.language)}
            </p>
          )}

          {/* Derived "visible to sponsor / hidden — reason" line. */}
          {visible ? (
            <p className="text-sm font-medium text-success-700" role="status">
              {t("orphanMedia.sponsor.visible")}
            </p>
          ) : (
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300" role="status">
              {t("orphanMedia.sponsor.hidden", {
                reason: t(`orphanMedia.reason.${reason}`),
              })}
            </p>
          )}

          {needsConsent(item.category) && !item.has_guardian_consent && (
            <p className="text-xs text-warning-700">{t("orphanMedia.consentHint")}</p>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <EditForm
          item={item}
          pending={patch.isPending}
          onCancel={() => setEditing(false)}
          onSave={(body) => patch.mutate(body)}
        />
      )}

      {/* Actions */}
      {!editing && (
        <div className="flex flex-wrap gap-2">
          {!isSponsorState && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => moderate.mutate("approve")}
            >
              {t("orphanMedia.actions.show")}
            </button>
          )}
          {isSponsorState && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => patch.mutate({ visibility: "archived" })}
            >
              {t("orphanMedia.actions.hide")}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => patch.mutate({ has_guardian_consent: !item.has_guardian_consent })}
          >
            {item.has_guardian_consent
              ? t("orphanMedia.actions.consentOff")
              : t("orphanMedia.actions.consentOn")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
          >
            {t("orphanMedia.actions.edit")}
          </button>
          {item.moderation_status === "pending" && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => moderate.mutate("reject")}
            >
              {t("orphanMedia.actions.reject")}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** Inline edit of one item's title / caption / display_date. */
function EditForm({
  item,
  pending,
  onCancel,
  onSave,
}: {
  item: MediaManageRead;
  pending: boolean;
  onCancel: () => void;
  onSave: (body: MediaPatch) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(item.title ?? "");
  const [description, setDescription] = useState(item.description ?? "");
  const [displayDate, setDisplayDate] = useState(item.display_date ?? "");

  return (
    <form
      className="space-y-3 rounded-lg border border-sky-200 bg-snow-100 p-3 dark:border-gray-700 dark:bg-gray-800/40"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          title: title.trim() || null,
          description: description.trim() || null,
          display_date: displayDate || null,
        });
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t("orphanMedia.edit.title")}
        </span>
        <input
          type="text"
          className="input w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t("orphanMedia.edit.caption")}
        </span>
        <textarea
          className="input w-full"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {t("orphanMedia.edit.displayDate")}
        </span>
        <input
          type="date"
          className="input w-full"
          value={displayDate}
          onChange={(e) => setDisplayDate(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t("orphanMedia.edit.saving") : t("orphanMedia.edit.save")}
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>
          {t("orphanMedia.edit.cancel")}
        </button>
      </div>
    </form>
  );
}
