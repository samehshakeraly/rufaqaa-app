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
