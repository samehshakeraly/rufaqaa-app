import { api } from "./api";
import type { Page } from "./orphans";

export interface AdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
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
