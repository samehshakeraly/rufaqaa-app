import { api } from "./api";
import type { Page } from "./orphans";

export interface AuditEntry {
  id: number;
  organization_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  is_sensitive: boolean;
  created_at: string;
}

export async function listAudit(params?: {
  limit?: number;
  offset?: number;
  entity_type?: string;
  action?: string;
}): Promise<Page<AuditEntry>> {
  const { data } = await api.get<Page<AuditEntry>>("/audit", { params });
  return data;
}
