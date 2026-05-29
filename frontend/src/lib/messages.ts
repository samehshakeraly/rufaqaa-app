import { api } from "./api";
import type { Page } from "./orphans";

/** Privacy-safe message projection.
 *
 * Mirrors the backend `MessageRead` shape exactly. The wire form
 * deliberately omits every user id, email, phone, and last name — the
 * counter-party is identified only by `from_role`/`from_name` and
 * `to_role`/`to_name` (first name only). Never request or render PII
 * beyond these fields. */
export interface MessageRead {
  id: string;
  from_role: string;
  from_name: string;
  to_role: string;
  to_name: string;
  orphan_code: string | null;
  message_type: string;
  content: string | null;
  moderation_status: "pending" | "approved" | "rejected" | string;
  moderation_notes: string | null;
  is_read: boolean;
  is_mine: boolean;
  created_at: string;
  moderated_at: string | null;
  read_at: string | null;
}

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
