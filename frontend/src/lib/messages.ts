import { api } from "./api";
import type { Page } from "./orphans";

/**
 * Moderated messaging client.
 *
 * Privacy posture mirrors the backend: `MessageRead` never carries a raw
 * `user_id`, email, phone, or last name — only `from_role` + `from_name`
 * (first name) and the caller's `is_mine` relationship. The UI must not
 * request or reconstruct anything more.
 */

export type MessageModerationStatus = "pending" | "approved" | "rejected";

export interface MessageRead {
  id: string;
  from_role: string;
  from_name: string;
  to_role: string;
  to_name: string;
  orphan_code: string | null;
  message_type: string;
  content: string | null;
  moderation_status: MessageModerationStatus;
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

export async function getMessage(id: string): Promise<MessageRead> {
  const { data } = await api.get<MessageRead>(`/messages/${id}`);
  return data;
}

export async function markMessageRead(id: string): Promise<MessageRead> {
  const { data } = await api.post<MessageRead>(`/messages/${id}/read`);
  return data;
}
