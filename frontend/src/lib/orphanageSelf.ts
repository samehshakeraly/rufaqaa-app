import type { components } from "@/api/schema.gen";

import { api } from "./api";

/**
 * Orphanage-manager self-service API client.
 *
 * Mirrors `guardianSelf.ts` — the wire shapes are the privacy-safe
 * projections the backend returns (see backend/app/api/v1/orphanage_self.py).
 * The manager runs a dar (residential orphanage); this portal shows the dar
 * profile, its resident orphans, and lets the manager submit monthly reports
 * for those residents — exactly the way a guardian reports for their own
 * orphans, only scoped by `orphanage_id` instead of `family_id`. Financial
 * figures and donor identity are never exposed.
 */

// Types track schema.gen.ts (regenerated from the backend OpenAPI spec).

/** GET /orphanage/me — the calling manager's own orphanage (dar) profile. */
export type OrphanageProfile = components["schemas"]["OrphanageRead"];

/** GET /orphanage/me/orphans — manager-safe projection of a resident orphan.
 * No financial figures, no donor or partner identity. */
export type OrphanageResident = components["schemas"]["OrphanageOrphanRead"];

/** A report for one of the dar's residents (meta-only ReportRead). */
export type OrphanageReport = components["schemas"]["ReportRead"];

/** Body for POST /orphanage/me/reports. The structured shape the manager
 * authoring form sends: report meta, the five canonical typed sections
 * (each optional), a per-section donor-visibility map, a note to the
 * sponsor (`donor_message`), and milestone flagging. */
export type OrphanageReportInput = components["schemas"]["OrphanageReportCreate"];

/** Canonical typed report sections, re-exported for the authoring form. */
export type EducationProgress = components["schemas"]["EducationProgress"];
export type QuranProgress = components["schemas"]["QuranProgress"];
export type ActivitiesSection = components["schemas"]["ActivitiesSection"];
export type HealthStatus = components["schemas"]["HealthStatus"];
export type PsychologicalStatus = components["schemas"]["PsychologicalStatus"];

export type ReportStatus = OrphanageReport["status"];
export type ReportType = OrphanageReport["report_type"];

/** GET /orphanage/me — 404 for any caller who manages no dar (resource gate). */
export async function getOrphanageMe(): Promise<OrphanageProfile> {
  const { data } = await api.get<OrphanageProfile>("/orphanage/me");
  return data;
}

/** GET /orphanage/me/orphans — the dar's resident orphans (orphanage_id ==
 * my_orphanage.id), newest first. */
export async function listOrphanageResidents(): Promise<OrphanageResident[]> {
  const { data } = await api.get<OrphanageResident[]>("/orphanage/me/orphans");
  return data;
}

/** GET /orphanage/me/reports — reports for one of the dar's residents.
 * `orphanId` is required by the backend (it 403s if the orphan isn't a
 * resident of the manager's dar). */
export async function listOrphanageReports(
  orphanId: string,
  limit = 20,
): Promise<OrphanageReport[]> {
  const { data } = await api.get<OrphanageReport[]>("/orphanage/me/reports", {
    params: { orphan_id: orphanId, limit },
  });
  return data;
}

/** POST /orphanage/me/reports — submit a structured report. It lands directly
 * in `pending_partner_approval`, so it surfaces in the staff review queue and
 * the manager sees the pending→approved/rejected status back on the orphan
 * page. Sections left empty are sent as `null`; `section_visibility` carries
 * only the sections the manager chose to hide (`false`) — everything else is
 * shown to the sponsor by default. The backend 403s if the orphan isn't a
 * resident of the manager's dar. */
export async function createOrphanageReport(
  body: OrphanageReportInput,
): Promise<OrphanageReport> {
  const { data } = await api.post<OrphanageReport>("/orphanage/me/reports", body);
  return data;
}
