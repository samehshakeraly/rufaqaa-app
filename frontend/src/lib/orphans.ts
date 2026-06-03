import { api } from "./api";

// Enum unions — mirror schema.gen.ts exactly. Shared across the create,
// read, and update shapes.
export type EducationStage =
  | "not_enrolled"
  | "kindergarten"
  | "primary"
  | "preparatory"
  | "secondary"
  | "university"
  | "vocational"
  | "graduated";
export type HealthStatus = "good" | "chronic_condition" | "disability" | "under_treatment";
export type HealthCoverage = "none" | "government" | "private" | "charity";
export type MotherStatus = "alive" | "deceased" | "unknown";
export type PriorityLevel = "normal" | "high" | "urgent";

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
  assigned_to_channel_id: string | null;
  assigned_at: string | null;
  assignment_deadline: string | null;
  created_at: string;
  // Extended profile fields (read). Mirror schema.gen.ts OrphanRead.
  education_stage?: EducationStage | null;
  academic_level?: string | null;
  school_name?: string | null;
  quran_juz_memorized?: number | null;
  quran_note?: string | null;
  health_status?: HealthStatus | null;
  health_coverage?: HealthCoverage | null;
  chronic_conditions?: string | null;
  mother_status?: MotherStatus | null;
  priority_level?: PriorityLevel | null;
  aspiration?: string | null;
  challenges?: string | null;
  tags?: string[];
  /** Derived (not stored): a child who has memorised the whole Qur'an. */
  is_hafiz?: boolean;
}

export type AssignmentStatus = "active" | "expired" | "all";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface OrphanCreateInput {
  first_name: string;
  family_name: string;
  date_of_birth: string;
  gender: "M" | "F";
  /** Required domain field — an orphan is defined by their father. */
  father_name: string;
  /** Staff path only. The guardian path derives the partner server-side, so
   * it is omitted there (and rejected by the API if sent). */
  partner_organization_id?: string;
  middle_name?: string;
  full_name_en?: string;
  father_death_date?: string;
  family_id?: string;
  nationality?: string;
  // Extended profile fields (all optional). Mirror schema.gen.ts
  // OrphanCreate / GuardianOrphanCreate.
  education_stage?:
    | "not_enrolled"
    | "kindergarten"
    | "primary"
    | "preparatory"
    | "secondary"
    | "university"
    | "vocational"
    | "graduated";
  academic_level?: string;
  school_name?: string;
  quran_juz_memorized?: number;
  quran_note?: string;
  health_status?: "good" | "chronic_condition" | "disability" | "under_treatment";
  health_coverage?: "none" | "government" | "private" | "charity";
  chronic_conditions?: string;
  mother_status?: MotherStatus;
  priority_level?: PriorityLevel;
  aspiration?: string;
  challenges?: string;
  tags?: string[];
}

export async function listOrphans(params?: {
  limit?: number;
  offset?: number;
  q?: string;
  case_status?: string;
  /** Narrow to orphans assigned to a marketing channel. */
  channel_id?: string;
  /** Filter by assignment deadline: active = not yet lapsed,
   * expired = past deadline, all = no filter. */
  assignment_status?: AssignmentStatus;
}): Promise<Page<Orphan>> {
  const { data } = await api.get<Page<Orphan>>("/orphans", { params });
  return data;
}

export async function createOrphan(payload: OrphanCreateInput): Promise<Orphan> {
  const { data } = await api.post<Orphan>("/orphans", payload);
  return data;
}

export async function getOrphan(id: string): Promise<Orphan> {
  const { data } = await api.get<Orphan>(`/orphans/${id}`);
  return data;
}

/** Partial update. Every key optional — only the supplied fields are written.
 * Mirrors schema.gen.ts OrphanUpdate. `case_status` is intentionally absent:
 * status changes go through the approve / reject / release endpoints. */
export interface OrphanUpdateInput {
  // Basic editable identity fields the PATCH already supports.
  first_name?: string;
  family_name?: string;
  middle_name?: string | null;
  full_name_en?: string | null;
  date_of_birth?: string;
  gender?: "M" | "F";
  nationality?: string | null;
  father_name?: string | null;
  // Extended profile fields.
  education_stage?: EducationStage | null;
  academic_level?: string | null;
  school_name?: string | null;
  quran_juz_memorized?: number | null;
  quran_note?: string | null;
  health_status?: HealthStatus | null;
  health_coverage?: HealthCoverage | null;
  chronic_conditions?: string | null;
  mother_status?: MotherStatus | null;
  priority_level?: PriorityLevel | null;
  aspiration?: string | null;
  challenges?: string | null;
  tags?: string[];
}

export async function updateOrphan(
  id: string,
  payload: OrphanUpdateInput,
): Promise<Orphan> {
  const { data } = await api.patch<Orphan>(`/orphans/${id}`, payload);
  return data;
}

export async function exportOrphansCsv(params?: {
  case_status?: string;
}): Promise<Blob> {
  const r = await api.get("/orphans/export.csv", {
    params,
    responseType: "blob",
  });
  return r.data as Blob;
}

export interface TimelineEvent {
  when: string;
  kind: "sponsorship" | "payment" | "report" | "media";
  entity_id: string;
  summary: string;
  amount: string | null;
  currency: string | null;
  status: string | null;
}

export interface Timeline {
  items: TimelineEvent[];
}

export async function getOrphanTimeline(id: string): Promise<Timeline> {
  const { data } = await api.get<Timeline>(`/orphans/${id}/timeline`);
  return data;
}

export async function archiveOrphan(id: string): Promise<void> {
  await api.delete(`/orphans/${id}`);
}

export async function approveOrphan(id: string): Promise<Orphan> {
  const { data } = await api.post<Orphan>(`/orphans/${id}/approve`);
  return data;
}

export async function rejectOrphan(id: string, reason: string): Promise<Orphan> {
  const { data } = await api.post<Orphan>(`/orphans/${id}/reject`, { reason });
  return data;
}

export async function releaseOrphan(id: string): Promise<Orphan> {
  const { data } = await api.post<Orphan>(`/orphans/${id}/release`);
  return data;
}
