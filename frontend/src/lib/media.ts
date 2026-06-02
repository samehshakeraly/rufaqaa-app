import type { components, operations } from "@/api/schema.gen";

import { api } from "./api";

export interface OrphanPhoto {
  id: string;
  file_url: string;
  presigned_url: string;
  file_size_bytes: number;
  moderation_status: string;
  created_at: string;
}

export async function listOrphanPhotos(orphanId: string): Promise<OrphanPhoto[]> {
  const { data } = await api.get<OrphanPhoto[]>(`/media/orphans/${orphanId}/photos`);
  return data;
}

export async function uploadOrphanPhoto(
  orphanId: string,
  file: File,
): Promise<OrphanPhoto> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post(`/media/orphans/${orphanId}/photo`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data as OrphanPhoto;
}

export type MediaModerationDecision = "approve" | "reject";

export interface MediaModerationResult {
  id: string;
  moderation_status: string;
  moderation_notes: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  visibility: string;
}

export async function moderateMedia(
  id: string,
  decision: MediaModerationDecision,
  notes?: string,
): Promise<MediaModerationResult> {
  const { data } = await api.post<MediaModerationResult>(
    `/media/${id}/moderate`,
    { decision, notes: notes ?? null },
  );
  return data;
}

// ── Moderation queue (GET /media) — types track schema.gen.ts ─────────────
export type MediaQueueItem = components["schemas"]["MediaQueueItem"];
export type MediaQueuePage = components["schemas"]["Page_MediaQueueItem_"];

type MediaQueueQuery = NonNullable<
  operations["list_media_queue_api_v1_media_get"]["parameters"]["query"]
>;

/** moderation_status values the queue accepts (pending | approved | rejected | flagged). */
export type MediaModerationStatus = NonNullable<MediaQueueQuery["moderation_status"]>;

/** One page of the staff moderation queue for a given status, newest first. */
export async function listMediaQueue(
  status: MediaModerationStatus,
  opts: { limit?: number; offset?: number } = {},
): Promise<MediaQueuePage> {
  const params: MediaQueueQuery = {
    moderation_status: status,
    limit: opts.limit,
    offset: opts.offset,
  };
  const { data } = await api.get<MediaQueuePage>("/media", { params });
  return data;
}
