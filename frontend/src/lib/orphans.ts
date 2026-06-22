import { api } from "./api";

// Enum unions — mirror schema.gen.ts exactly. Shared across the create,
// read, and update shapes. `education_stage` / `academic_level` are coded on
// the create/update/filter shapes; the read `Orphan` keeps them as plain
// strings (mirrors OrphanRead) so legacy values still surface.
export type EducationStage =
  | "pre_kindergarten"
  | "kindergarten"
  | "primary"
  | "preparatory"
  | "secondary";
export type AcademicLevel = "weak" | "good" | "excellent";
export type LivesWith = "mother" | "relative" | "orphanage" | "other";
export type HealthStatus = "good" | "chronic_condition" | "disability" | "under_treatment";
export type HealthCoverage = "none" | "government" | "private" | "charity";
export type MotherStatus = "alive" | "deceased" | "unknown";
export type PriorityLevel = "normal" | "high" | "urgent";

// Sort options for the staff orphan list. Mirrors the backend `OrphanSort`
// Literal / schema.gen.ts. `balanced` is intentionally excluded (later batch).
export type OrphanSort =
  | "recently_available"
  | "longest_waiting"
  | "priority"
  | "most_complete"
  | "newest";

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
  /** Current dar (orphanage) the child resides in; null = family home. */
  orphanage_id: string | null;
  created_at: string;
  // Extended profile fields (read). Mirror schema.gen.ts OrphanRead —
  // education_stage / academic_level are permissive strings here so a legacy
  // row carrying a now-removed value still reads.
  education_stage?: string | null;
  academic_level?: string | null;
  mother_name?: string | null;
  lives_with?: string | null;
  /** ISO alpha-2 country code (the orphan's nationality). Mirrors
   * OrphanRead.nationality; drives the country document requirements on the
   * detail page. */
  nationality?: string | null;
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
  /** Staff-only dar assignment. Omitted by the guardian self-service path. */
  orphanage_id?: string;
  nationality?: string;
  /** Country national ID. Optional unless the selected country's requirements
   * mark it required; the server re-validates against the same rule. Sent on
   * both the staff and guardian paths. */
  national_id?: string;
  /** Free per-country bag of extra intake fields (conflict / WASH details).
   * Persisted as-is server-side; the shape varies by country. Sent on both
   * the staff and guardian paths. */
  country_specific?: Record<string, unknown>;
  /** Optional richer-intake fields (migration 0021). */
  mother_name?: string;
  lives_with?: LivesWith;
  /** Optional family-residence address — STAFF path only. When it carries ≥1
   * non-empty field and no family_id is set, the API materialises a Family from
   * it (in the orphan's transaction) and links the orphan. Mirrors
   * schema.gen.ts OrphanHomeAddress. */
  home_address?: {
    city?: string;
    village?: string;
    district?: string;
    street?: string;
    house_number?: string;
    floor?: string;
  };
  // Extended profile fields (all optional). Mirror schema.gen.ts
  // OrphanCreate / GuardianOrphanCreate.
  education_stage?: EducationStage;
  academic_level?: AcademicLevel;
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
  /** Segment filters — staff list only (org-scoped endpoint). `health_status`
   * is a sensitive field and is never sent from public/donor surfaces. */
  education_stage?: EducationStage;
  health_status?: HealthStatus;
  is_hafiz?: boolean;
  min_juz?: number;
  tags?: string[];
  /** How to match `tags`: "all" requires every tag (@>), "any" an overlap (&&). */
  tags_mode?: "all" | "any";
  /** Advanced filters — staff list only. `orphan_type` is derived from
   * mother_status (single = father lost / mother alive, double = both parents);
   * orphans with an unknown mother status surface only when this is omitted. */
  orphan_type?: "single" | "double";
  /** Exact match on the case priority level. */
  priority?: PriorityLevel;
  /** Minimum days spent waiting in the available pool (excludes never-available). */
  min_waiting_days?: number;
  /** Minimum profile completion percentage (0–100), inclusive. */
  min_completion?: number;
  /** Sort order. Omit to let the backend auto-pick (relevance while searching,
   * else newest). */
  sort?: OrphanSort;
}): Promise<Page<Orphan>> {
  // Build the query string by hand so `tags` goes out as repeated entries
  // (?tags=a&tags=b) — FastAPI binds those to list[str]. Axios' default array
  // serialization uses tags[]=… brackets, which the API wouldn't pick up.
  const search = new URLSearchParams();
  if (params) {
    const { tags, ...rest } = params;
    for (const [key, value] of Object.entries(rest)) {
      // Omit undefined; stringify everything else (numbers/booleans → "30"/"true").
      if (value !== undefined) search.append(key, String(value));
    }
    for (const tag of tags ?? []) search.append("tags", tag);
  }
  const { data } = await api.get<Page<Orphan>>("/orphans", { params: search });
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
  /** Dar assignment. Send a UUID to assign, or null to clear (family home). */
  orphanage_id?: string | null;
  // Extended profile fields.
  education_stage?: EducationStage | null;
  academic_level?: AcademicLevel | null;
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
