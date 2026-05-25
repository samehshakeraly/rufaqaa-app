import { api } from "./api";

export interface Orphan {
  id: string;
  code: string;
  first_name: string;
  middle_name: string | null;
  family_name: string;
  date_of_birth: string;
  gender: "M" | "F";
  case_status: string;
  is_sponsored: boolean;
  current_balance: string;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export async function listOrphans(params?: {
  limit?: number;
  offset?: number;
}): Promise<Page<Orphan>> {
  const { data } = await api.get<Page<Orphan>>("/orphans", { params });
  return data;
}
