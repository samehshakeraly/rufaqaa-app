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
