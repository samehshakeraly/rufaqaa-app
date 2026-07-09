import type {
  EducationStage,
  HealthStatus,
  PriorityLevel,
  listOrphans,
} from "@/lib/orphans";

// Coded vocabularies used to validate deep-link URL params. Typed against the
// lib unions (which mirror schema.gen.ts), so an out-of-vocabulary literal is
// a compile error; kept here rather than imported from NewOrphanForm so lib
// code never depends on a component module.
const EDUCATION_STAGES: readonly EducationStage[] = [
  "pre_kindergarten",
  "kindergarten",
  "primary",
  "preparatory",
  "secondary",
];
const HEALTH_STATUSES: readonly HealthStatus[] = [
  "good",
  "chronic_condition",
  "disability",
  "under_treatment",
];
const PRIORITY_LEVELS: readonly PriorityLevel[] = ["normal", "high", "urgent"];

/** The shared orphan "slice" — every list filter except the case-status tabs,
 * the free-text search and the sort (each host page owns those). Kept as plain
 * strings ("" = unset) so it slots straight into a react-query key. Used by
 * BOTH the staff orphan list and the segments report, so the two surfaces can
 * never drift apart, and deep-links between them stay lossless. */
export interface OrphanSliceFilters {
  educationStage: EducationStage | "";
  healthStatus: HealthStatus | "";
  isHafiz: "" | "true" | "false";
  minJuz: string;
  tags: string[];
  tagsMode: "all" | "any";
  orphanType: "" | "single" | "double";
  priority: PriorityLevel | "";
  minWaitingDays: string;
  minCompletion: string;
}

export const EMPTY_ORPHAN_SLICE: OrphanSliceFilters = {
  educationStage: "",
  healthStatus: "",
  isHafiz: "",
  minJuz: "",
  tags: [],
  tagsMode: "all",
  orphanType: "",
  priority: "",
  minWaitingDays: "",
  minCompletion: "",
};

type OrphanListParams = NonNullable<Parameters<typeof listOrphans>[0]>;

/** Map the slice to the API query params, omitting unset dimensions — the
 * exact mapping the orphan list has always sent. */
export function orphanSliceParams(f: OrphanSliceFilters): OrphanListParams {
  return {
    ...(f.educationStage ? { education_stage: f.educationStage } : {}),
    ...(f.healthStatus ? { health_status: f.healthStatus } : {}),
    ...(f.isHafiz !== "" ? { is_hafiz: f.isHafiz === "true" } : {}),
    ...(f.minJuz !== "" ? { min_juz: Number(f.minJuz) } : {}),
    ...(f.tags.length > 0 ? { tags: f.tags, tags_mode: f.tagsMode } : {}),
    ...(f.orphanType ? { orphan_type: f.orphanType } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.minWaitingDays !== "" ? { min_waiting_days: Number(f.minWaitingDays) } : {}),
    ...(f.minCompletion !== "" ? { min_completion: Number(f.minCompletion) } : {}),
  };
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | "" {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

function numeric(value: string | null): string {
  return value !== null && /^\d+$/.test(value) ? value : "";
}

/** Hydrate a slice from URL search params (the deep-link format produced by
 * {@link orphanSliceToSearchParams}). Param names mirror the API's query
 * params. Unknown or malformed values fall back to unset rather than sending
 * garbage to the API. */
export function orphanSliceFromSearchParams(sp: URLSearchParams): OrphanSliceFilters {
  return {
    educationStage: oneOf(sp.get("education_stage"), EDUCATION_STAGES),
    healthStatus: oneOf(sp.get("health_status"), HEALTH_STATUSES),
    isHafiz: oneOf(sp.get("is_hafiz"), ["true", "false"] as const),
    minJuz: numeric(sp.get("min_juz")),
    tags: sp.getAll("tags").filter(Boolean),
    tagsMode: oneOf(sp.get("tags_mode"), ["all", "any"] as const) || "all",
    orphanType: oneOf(sp.get("orphan_type"), ["single", "double"] as const),
    priority: oneOf(sp.get("priority"), PRIORITY_LEVELS),
    minWaitingDays: numeric(sp.get("min_waiting_days")),
    minCompletion: numeric(sp.get("min_completion")),
  };
}

/** Serialize a slice into URL search params for deep-links into the orphan
 * list. Inverse of {@link orphanSliceFromSearchParams}: only set dimensions
 * are emitted, `tags` as repeated entries. */
export function orphanSliceToSearchParams(f: OrphanSliceFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.educationStage) sp.set("education_stage", f.educationStage);
  if (f.healthStatus) sp.set("health_status", f.healthStatus);
  if (f.isHafiz !== "") sp.set("is_hafiz", f.isHafiz);
  if (f.minJuz !== "") sp.set("min_juz", f.minJuz);
  for (const tag of f.tags) sp.append("tags", tag);
  if (f.tags.length > 0) sp.set("tags_mode", f.tagsMode);
  if (f.orphanType) sp.set("orphan_type", f.orphanType);
  if (f.priority) sp.set("priority", f.priority);
  if (f.minWaitingDays !== "") sp.set("min_waiting_days", f.minWaitingDays);
  if (f.minCompletion !== "") sp.set("min_completion", f.minCompletion);
  return sp;
}
