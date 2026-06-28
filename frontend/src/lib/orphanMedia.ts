import type { components } from "@/api/schema.gen";

import { api } from "./api";

// Orphan media-management types — mirror schema.gen.ts exactly (PR-4 backend).
// MediaManageRead is the staff/manager view of one media row: it carries a
// fresh short-lived presigned `url` (+ `thumbnail_url` when present) and the
// full moderation/visibility/consent state, so the management UI can render
// and act on items the sponsor never sees (hidden / pending / consent-missing).
export type MediaManageRead = components["schemas"]["MediaManageRead"];
export type MediaCategory = components["schemas"]["MediaCategory"];
export type MediaVisibility = NonNullable<components["schemas"]["MediaPatch"]["visibility"]>;
export type MediaModerationDecision = components["schemas"]["MediaModeratePayload"]["decision"];

/** The four memory-box categories a manager can upload here. `portrait` is the
 * identity avatar (managed elsewhere) and is intentionally excluded from the
 * upload picker — it never belongs in the donor memory box. */
export const UPLOAD_CATEGORIES: readonly MediaCategory[] = [
  "drawing",
  "certificate",
  "album",
  "recitation",
] as const;

/** Categories that require explicit guardian consent before they can reach the
 * sponsor, even once approved + visibility is donor_only/public. */
export const CONSENT_REQUIRED_CATEGORIES: readonly MediaCategory[] = [
  "recitation",
  "album",
  "portrait",
] as const;

export interface MediaUploadInput {
  category: MediaCategory;
  file: File;
  title?: string;
  description?: string;
  display_date?: string;
}

/** Fields the manager may PATCH on one media item (does NOT touch moderation). */
export type MediaPatch = components["schemas"]["MediaPatch"];

/** Staff/manager read of ALL of this orphan's media — including hidden and
 * pending rows. Each item carries a fresh presigned `url`. */
export async function listOrphanMedia(orphanId: string): Promise<MediaManageRead[]> {
  const { data } = await api.get<MediaManageRead[]>(`/media/orphans/${orphanId}/media`);
  return data;
}

/** Upload one media item (multipart). Lands moderation_status='pending' /
 * visibility='private'; the MIME allow-list and ≤10MB cap are enforced
 * server-side (415 / 413 on violation). */
export async function uploadOrphanMedia(
  orphanId: string,
  input: MediaUploadInput,
): Promise<MediaManageRead> {
  const form = new FormData();
  form.append("category", input.category);
  form.append("file", input.file);
  if (input.title) form.append("title", input.title);
  if (input.description) form.append("description", input.description);
  if (input.display_date) form.append("display_date", input.display_date);
  const { data } = await api.post<MediaManageRead>(`/media/orphans/${orphanId}/media`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/** PATCH editable fields (title/description/display_date/visibility/consent).
 * Moderation status is unaffected. */
export async function updateMedia(mediaId: string, patch: MediaPatch): Promise<MediaManageRead> {
  const { data } = await api.patch<MediaManageRead>(`/media/${mediaId}`, patch);
  return data;
}

/** Moderate one item. 'approve' bumps visibility to 'donor_only'; 'reject'
 * leaves it hidden. */
export async function moderateMedia(
  mediaId: string,
  decision: MediaModerationDecision,
): Promise<MediaManageRead> {
  const { data } = await api.post<MediaManageRead>(`/media/${mediaId}/moderate`, {
    decision,
  });
  return data;
}

/** Why (if at all) an item is hidden from the sponsor. `null` => visible. */
export type HiddenReason = "pending" | "rejected" | "archived" | "private" | "consent";

/** Derive whether one item is visible to the sponsor, encoding the PR-4 domain
 * rule: visible ONLY when moderation_status='approved' AND visibility IN
 * ('donor_only','public') AND (category not consent-gated OR consent given). */
export function sponsorVisibility(item: MediaManageRead): {
  visible: boolean;
  reason: HiddenReason | null;
} {
  if (item.moderation_status === "rejected") return { visible: false, reason: "rejected" };
  if (item.moderation_status !== "approved") return { visible: false, reason: "pending" };
  if (item.visibility === "archived") return { visible: false, reason: "archived" };
  if (item.visibility !== "donor_only" && item.visibility !== "public")
    return { visible: false, reason: "private" };
  if (
    item.category != null &&
    (CONSENT_REQUIRED_CATEGORIES as readonly string[]).includes(item.category) &&
    !item.has_guardian_consent
  )
    return { visible: false, reason: "consent" };
  return { visible: true, reason: null };
}

/** Whether this category needs guardian consent before reaching the sponsor. */
export function needsConsent(category: string | null): boolean {
  return category != null && (CONSENT_REQUIRED_CATEGORIES as readonly string[]).includes(category);
}
