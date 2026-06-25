import type { components } from "@/api/schema.gen";

import { api } from "./api";
import type { Page } from "./orphans";

/** Privacy-safe message projection.
 *
 * Sourced from the generated OpenAPI types so it stays in lock-step with
 * the backend `MessageRead`. The wire form deliberately omits every user
 * id, email, phone, and last name — the counter-party is identified only
 * by `from_role`/`from_name` and `to_role`/`to_name` (first name only).
 * Never request or render PII beyond these fields. */
export type MessageRead = components["schemas"]["MessageRead"];

export async function listMessages(params?: {
  limit?: number;
  offset?: number;
  orphan_id?: string;
  unread_only?: boolean;
}): Promise<Page<MessageRead>> {
  const { data } = await api.get<Page<MessageRead>>("/messages", { params });
  return data;
}

/** Mark an incoming (approved) message as read. Only the recipient may
 * call this; the backend rejects anything else. */
export async function markMessageRead(id: string): Promise<MessageRead> {
  const { data } = await api.post<MessageRead>(`/messages/${id}/read`);
  return data;
}

// ── Donor-scoped messaging ────────────────────────────────────────────
//
// A self-signup donor lives in the PLATFORM org while the orphan + staff
// live in the partner org, so the generic org-scoped /messages endpoints
// can't serve donors. These hit the donor-scoped routes under /donor/me.

/** List the donor's own messages (cross-org by design). Pass `orphan_code`
 * to narrow to one child's conversation. */
export async function listDonorMessages(params?: {
  orphan_code?: string;
  limit?: number;
  offset?: number;
}): Promise<Page<MessageRead>> {
  const { data } = await api.get<Page<MessageRead>>("/donor/me/messages", {
    params,
  });
  return data;
}

/** Compose + send a message about a child the donor sponsors. Lands as
 * `pending` until a moderator approves it. */
export async function sendDonorMessage(body: {
  orphan_code: string;
  content: string;
}): Promise<MessageRead> {
  const { data } = await api.post<MessageRead>("/donor/me/messages", body);
  return data;
}

/** Mark an incoming (approved) donor message as read. */
export async function markDonorMessageRead(id: string): Promise<MessageRead> {
  const { data } = await api.post<MessageRead>(
    `/donor/me/messages/${id}/read`,
  );
  return data;
}
