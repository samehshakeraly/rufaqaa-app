import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Lightbox } from "@/components/Lightbox";
import {
  listMediaQueue,
  moderateMedia,
  type MediaModerationDecision,
  type MediaQueueItem,
} from "@/lib/media";
import { toast } from "@/store/toasts";

import "./MediaReviewPage.css";

// Card presentation shape. The queue endpoint (GET /media) returns the
// fields below; orphan_name / file_name aren't part of that contract yet
// (it carries orphan_id only), so they map to null and the card hides them.
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

function toPendingMedia(m: MediaQueueItem): PendingMedia {
  return {
    id: m.id,
    presigned_url: m.presigned_url,
    orphan_name: null,
    file_name: null,
    file_size_bytes: m.file_size_bytes,
    created_at: m.created_at,
    visibility: m.visibility,
  };
}

type ReviewTab = "pending" | "approved" | "rejected";
const TABS: ReviewTab[] = ["pending", "approved", "rejected"];
const QUEUE_KEY = "media-queue";

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

  // Live moderation queue, keyed on the active tab (= moderation_status).
  const query = useQuery({
    queryKey: [QUEUE_KEY, tab],
    queryFn: () => listMediaQueue(tab),
  });
  const items = (query.data?.items ?? []).map(toPendingMedia);

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

      {query.isPending ? (
        <MediaQueueSkeleton label={t("media.review.loading")} />
      ) : query.isError ? (
        <div className="ps-media-empty" role="alert">
          <div className="ps-media-empty-icon" aria-hidden="true">
            <Icon>{ICON.image}</Icon>
          </div>
          <div className="ps-media-empty-title">{t("media.review.loadError")}</div>
          <button type="button" className="ps-media-link" onClick={() => query.refetch()}>
            <Icon sm>{ICON.arrow}</Icon>
            {t("common.retry")}
          </button>
        </div>
      ) : items.length > 0 ? (
        <div className="ps-media-grid">
          {items.map((m) => (
            <MediaCard key={m.id} media={m} lang={i18n.language} />
          ))}
        </div>
      ) : (
        /* Real empty state: this tab has no media (no longer "coming soon"). */
        <div className="ps-media-empty">
          <div className="ps-media-empty-icon" aria-hidden="true">
            <Icon>{ICON.image}</Icon>
          </div>
          <div className="ps-media-empty-title">{t(`media.review.empty.${tab}.title`)}</div>
          <div className="ps-media-empty-sub">{t(`media.review.empty.${tab}.sub`)}</div>
        </div>
      )}
    </div>
  );
}

function MediaQueueSkeleton({ label }: { label: string }) {
  return (
    <div className="ps-media-grid" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="ps-media-card ps-media-skel" aria-hidden="true">
          <div className="ps-media-thumb ps-media-skel-thumb" />
          <div className="ps-media-body">
            <div className="ps-media-skel-line" style={{ inlineSize: "60%" }} />
            <div className="ps-media-skel-line" style={{ inlineSize: "40%" }} />
          </div>
        </div>
      ))}
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
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [notes, setNotes] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (decision: MediaModerationDecision) =>
      moderateMedia(media.id, decision, decision === "reject" ? notes || undefined : undefined),
    onSuccess: (_res, decision) => {
      toast.success(
        decision === "approve"
          ? t("media.moderate.approved")
          : t("media.moderate.rejected"),
      );
      // Refresh every tab: the item leaves "pending" and joins approved/rejected.
      void queryClient.invalidateQueries({ queryKey: [QUEUE_KEY] });
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
          <button
            type="button"
            className="ps-media-thumb-btn"
            aria-label={t("common.viewFullSize")}
            onClick={() => setLightbox(media.presigned_url)}
          >
            <img
              src={media.presigned_url}
              alt={t("media.review.thumbnailAlt", { id: media.id })}
              loading="lazy"
            />
          </button>
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

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </article>
  );
}
