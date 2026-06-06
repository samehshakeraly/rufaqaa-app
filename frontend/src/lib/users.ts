import { api } from "./api";
import type { Page } from "./orphans";

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  partner_organization_id: string | null;
  status: string;
  two_factor_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export async function listUsers(params?: {
  limit?: number;
  offset?: number;
  role?: string;
  status?: string;
}): Promise<Page<AdminUser>> {
  const { data } = await api.get<Page<AdminUser>>("/users", { params });
  return data;
}

export async function suspendUser(id: string): Promise<AdminUser> {
  const { data } = await api.post<AdminUser>(`/users/${id}/suspend`);
  return data;
}

export async function reactivateUser(id: string): Promise<AdminUser> {
  const { data } = await api.post<AdminUser>(`/users/${id}/reactivate`);
  return data;
}

export interface UserInviteResult {
  user: { id: string; email: string; role: string; status: string };
  invite_token: string;
  expires_in_days: number;
}

export async function inviteUser(payload: {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  partner_organization_id?: string | null;
}): Promise<UserInviteResult> {
  const { data } = await api.post<UserInviteResult>("/users/invite", payload);
  return data;
}
