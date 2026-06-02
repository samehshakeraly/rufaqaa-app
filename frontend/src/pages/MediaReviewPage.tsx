import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { moderateMedia, type MediaModerationDecision } from "@/lib/media";
import { toast } from "@/store/toasts";

import "./MediaReviewPage.css";

// TODO(backend): there is no GET /media?moderation_status=… list endpoint yet
// — only per-orphan photos (GET /media/orphans/{id}/photos) and the per-item
// POST /media/{id}/moderate. Until a moderation-queue endpoint lands the queue
// is intentionally empty; we never fabricate a child's media. The full
// workspace below (filter tabs + grid + card actions wired to the real
// moderateMedia mutation) is ready — swap `items` for a useQuery(tab) call and
// add query invalidation in MediaCard once the endpoint exists.
interface PendingMedia {
  id: string;
  presigned_url: string | null;
  orphan_name: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  created_at: string | null;
  /** Existing consent/visibility flag — surfaced, never overridden here. */
  visibility: string | null;
}

type ReviewTab = "pending" | "approved" | "rejected";
const TABS: ReviewTab[] = ["pending", "approved", "rejected"];

function Icon({ children, sm = false }: { children: ReactNode; sm?: boolean }) {
  return (
    <svg className={`ps-icon${sm ? " ps-icon-sm" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}
const ICON = {
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  arrow: (
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>
  ),
};

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function MediaReviewPage() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<ReviewTab>("pending");

  // TODO(backend): replace with useQuery keyed on `tab` (moderation_status)
  // once the queue endpoint exists. Empty by design until then.
  const items: PendingMedia[] = [];

  return (
    <div className="ps-media">
      <div className="ps-media-head">
        <h1>{t("media.review.title")}</h1>
        <p>{t("media.review.description")}</p>
      </div>

      {/* AI summary banner — informational until the AI-moderation feed lands. */}
      <div className="ps-ai-banner">
        <div className="ps-ai-icon" aria-hidden="true">
          <Icon>{ICON.zap}</Icon>
        </div>
        <div className="ps-ai-text">
          <strong>{t("media.review.aiTitle")}</strong>
          <span>{t("media.review.aiBody")}</span>
        </div>
      </div>

      {/* Privacy strip — policy reminder, always relevant. */}
      <div className="ps-privacy-strip">
        <Icon sm>{ICON.shield}</Icon>
        <span>
          <strong>{t("media.review.privacyLabel")}</strong> {t("media.review.privacyBody")}
        </span>
      </div>

      {/* Filter tabs — drive the moderation_status the queue query will use. */}
      <div className="ps-media-filter">
        <div
          className="ps-media-tabs"
          role="tablist"
          aria-label={t("media.review.filterLabel")}
        >
          {TABS.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={tab === s}
              className={`ps-media-tab${tab === s ? " active" : ""}`}
              onClick={() => setTab(s)}
            >
              {t(`media.review.tabs.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {items.length > 0 ? (
        <div className="ps-media-grid">
          {items.map((m) => (
            <MediaCard key={m.id} media={m} lang={i18n.language} />
          ))}
        </div>
      ) : (
        /* Coming-soon empty state where the live queue will render. */
        <div className="ps-media-empty">
          <div className="ps-media-empty-icon" aria-hidden="true">
            <Icon>{ICON.image}</Icon>
          </div>
          <div className="ps-media-empty-title">{t("media.review.comingSoonTitle")}</div>
          <div className="ps-media-empty-sub">{t("media.review.todoBackend")}</div>
          <Link to="/admin/orphans?status=pending_review" className="ps-media-link">
            <Icon sm>{ICON.arrow}</Icon>
            {t("media.review.workaround")}
          </Link>
        </div>
      )}
    </div>
  );
}

function visibilityLabel(t: (k: string) => string, visibility: string | null): string | null {
  if (!visibility) return null;
  const map: Record<string, string> = {
    private: "media.review.visibility.private",
    sponsors: "media.review.visibility.sponsors",
    sponsor: "media.review.visibility.sponsors",
    public: "media.review.visibility.public",
  };
  const key = map[visibility];
  return key ? t(key) : visibility;
}

function MediaCard({ media, lang }: { media: PendingMedia; lang: string }) {
  const { t } = useTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: (decision: MediaModerationDecision) =>
      moderateMedia(media.id, decision, decision === "reject" ? notes || undefined : undefined),
    onSuccess: (_res, decision) => {
      toast.success(
        decision === "approve"
          ? t("media.moderate.approved")
          : t("media.moderate.rejected"),
      );
      // TODO(backend): invalidate the queue query here once it exists.
    },
    onError: () => toast.error(t("common.createError")),
  });

  const created = media.created_at ? new Date(media.created_at) : null;
  const createdLabel =
    created && !Number.isNaN(created.getTime())
      ? created.toLocaleDateString(lang, { day: "numeric", month: "short" })
      : null;
  const visLabel = visibilityLabel(t, media.visibility);
  const orphanName = media.orphan_name ?? "—";

  return (
    <article className="ps-media-card">
      <div className="ps-media-thumb">
        {media.presigned_url ? (
          <img
            src={media.presigned_url}
            alt={t("media.review.thumbnailAlt", { id: media.id })}
            loading="lazy"
          />
        ) : (
          <Icon>{ICON.image}</Icon>
        )}
        {visLabel && (
          <span className="ps-media-priv">
            <Icon sm>{ICON.lock}</Icon>
            {visLabel}
          </span>
        )}
      </div>
      <div className="ps-media-body">
        <div className="ps-media-orphan">
          <span className="ps-media-avatar" aria-hidden="true">
            {orphanName.trim()[0] ?? "—"}
          </span>
          <span className="ps-media-orphan-name">{orphanName}</span>
        </div>
        <div className="ps-media-meta">
          {media.file_name && <span className="latin">{media.file_name}</span>}
          {media.file_size_bytes != null && (
            <>
              <span className="dot" aria-hidden="true" />
              <span className="latin">{formatBytes(media.file_size_bytes)}</span>
            </>
          )}
          {createdLabel && (
            <>
              <span className="dot" aria-hidden="true" />
              <span>{createdLabel}</span>
            </>
          )}
        </div>
      </div>

      {rejecting ? (
        <div className="ps-media-reject">
          <label className="ps-media-reject-label" htmlFor={`reject-${media.id}`}>
            {t("media.moderate.notesLabel")}
          </label>
          <textarea
            id={`reject-${media.id}`}
            className="ps-media-reject-input"
            rows={2}
            autoFocus
            maxLength={1000}
            placeholder={t("media.moderate.notesPlaceholder")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="ps-media-reject-actions">
            <button
              type="button"
              className="ps-media-action"
              onClick={() => setRejecting(false)}
              disabled={mutation.isPending}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="ps-media-action no"
              onClick={() => mutation.mutate("reject")}
              disabled={mutation.isPending}
            >
              <Icon sm>{ICON.x}</Icon>
              {t("media.moderate.reject")}
            </button>
          </div>
        </div>
      ) : (
        <div className="ps-media-actions">
          <button
            type="button"
            className="ps-media-action ok"
            onClick={() => mutation.mutate("approve")}
            disabled={mutation.isPending}
          >
            <Icon sm>{ICON.check}</Icon>
            {t("media.moderate.approve")}
          </button>
          <button
            type="button"
            className="ps-media-action no"
            onClick={() => setRejecting(true)}
            disabled={mutation.isPending}
          >
            <Icon sm>{ICON.x}</Icon>
            {t("media.moderate.reject")}
          </button>
        </div>
      )}
    </article>
  );
}
