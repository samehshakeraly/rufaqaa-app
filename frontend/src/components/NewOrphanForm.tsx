import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";

import { createOrphan, type OrphanCreateInput } from "@/lib/orphans";
import { listPartners } from "@/lib/partners";

// Matches partner-issued orphan codes like ORF-12345 / ORP-ABCDE. The backend
// embeds the existing record's code in the 409 detail string; we surface it as
// a "view existing" link (where the caller allows one — see `duplicateHref`).
const ORPHAN_CODE_PATTERN = /\bOR[FP]-[A-Z0-9]{3,}\b/;

// Enum option lists — mirror schema.gen.ts (OrphanCreate / GuardianOrphanCreate)
// exactly. Used both for the zod validators and to render the <select> options.
export const EDUCATION_STAGES = [
  "not_enrolled",
  "kindergarten",
  "primary",
  "preparatory",
  "secondary",
  "university",
  "vocational",
  "graduated",
] as const;
export const HEALTH_STATUSES = [
  "good",
  "chronic_condition",
  "disability",
  "under_treatment",
] as const;
export const HEALTH_COVERAGES = ["none", "government", "private", "charity"] as const;
export const MOTHER_STATUSES = ["alive", "deceased", "unknown"] as const;
export const PRIORITY_LEVELS = ["normal", "high", "urgent"] as const;

// Optional free-text: empty string is left as-is here and dropped at submit
// time (truthiness gate), so we never send "" to the API.
const optionalText = z.string().trim().optional();

// father_name is REQUIRED (domain rule: an orphan is defined by their father).
// partner_organization_id is only collected on the staff path; the guardian
// portal derives it server-side, so it is dropped from validation there.
// The extended profile fields are ALL optional, on both paths.
function makeSchema(requirePartner: boolean) {
  return z.object({
    first_name: z.string().trim().min(1),
    family_name: z.string().trim().min(1),
    date_of_birth: z.string().min(4),
    gender: z.enum(["M", "F"]),
    father_name: z.string().trim().min(1),
    nationality: z
      .string()
      .length(2)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    partner_organization_id: requirePartner
      ? z.string().uuid()
      : z
          .string()
          .uuid()
          .optional()
          .or(z.literal("").transform(() => undefined)),
    // Dar (orphanage) — staff-only; the picker is rendered only when the
    // `orphanages` prop is supplied. Empty string = family home (no dar).
    orphanage_id: z
      .string()
      .uuid()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    // Mother status (shown to both audiences) and case priority (staff-only).
    mother_status: z
      .enum(MOTHER_STATUSES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    priority_level: z
      .enum(PRIORITY_LEVELS)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    // Education
    education_stage: z
      .enum(EDUCATION_STAGES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    academic_level: optionalText,
    school_name: optionalText,
    // Qur'an
    quran_juz_memorized: z.preprocess(
      (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
      z.number().int().min(0).max(30).optional(),
    ),
    quran_note: optionalText,
    // Health
    health_status: z
      .enum(HEALTH_STATUSES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    health_coverage: z
      .enum(HEALTH_COVERAGES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    chronic_conditions: optionalText,
    // Profile
    aspiration: optionalText,
    challenges: optionalText,
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

/** The subset of a created orphan that both the staff (`Orphan`) and guardian
 * (`GuardianOrphan`) responses share — enough for callers to react to a
 * successful create without coupling the form to either full shape. */
export interface CreatedOrphan {
  id: string;
  code: string;
  case_status: string;
  first_name: string;
  family_name: string;
}

interface NewOrphanFormProps {
  /** Optional partner list. If omitted (and the picker is shown) the form
   * fetches its own. */
  partners?: { id: string; name_ar: string; name_en: string | null }[];
  /** Optional dar (orphanage) list. When provided, a staff-only orphanage
   * picker is rendered; omit it (guardian path) and the picker stays hidden,
   * so guardians can never assign a dar. */
  orphanages?: { id: string; name_ar: string; name_en: string | null }[];
  /** Called on success with the freshly created orphan. */
  onCreated: (orphan: CreatedOrphan) => void | Promise<void>;
  /** Optional cancel handler (e.g. close the inline panel). */
  onCancel?: () => void;
  /** Show the partner picker. Staff: true (default). Guardian: false — the
   * partner is derived from the guardian's family server-side. */
  showPartnerSelect?: boolean;
  /** Create call. Defaults to the staff `createOrphan` (POST /orphans); the
   * guardian portal injects `createMyOrphan` (POST /guardian/me/orphans). */
  submitFn?: (payload: OrphanCreateInput) => Promise<CreatedOrphan>;
  /** Resolve the "view existing" duplicate link target from the existing code.
   * Return null to show the message without a link (e.g. guardians, who have
   * no code-search screen). Defaults to the staff admin search. */
  duplicateHref?: (code: string) => string | null;
  /** Who is filling the form. Guardians see a lighter subset — the sensitive
   * staff-only fields (health_coverage, chronic_conditions, challenges) are
   * neither rendered nor registered, so they are never submitted. */
  audience?: "staff" | "guardian";
}

export function NewOrphanForm({
  partners: partnersProp,
  orphanages,
  onCreated,
  onCancel,
  showPartnerSelect = true,
  submitFn,
  duplicateHref = (code) => `/admin/orphans?q=${encodeURIComponent(code)}`,
  audience = "staff",
}: NewOrphanFormProps) {
  const { t, i18n } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateCode, setDuplicateCode] = useState<string | null>(null);

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: () => listPartners(),
    enabled: showPartnerSelect && !partnersProp,
  });
  const partners = partnersProp ?? partnersQuery.data?.items ?? [];

  const schema = useMemo(() => makeSchema(showPartnerSelect), [showPartnerSelect]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { gender: "M", mother_status: "unknown", priority_level: "normal" },
  });

  // Guardians get a lighter form: the three sensitive fields below are hidden
  // and never registered, so they can't be submitted.
  const isStaff = audience === "staff";

  // Tags are a string[] edited as chips — managed outside react-hook-form.
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  function addTag() {
    const next = tagInput.trim();
    if (!next || tags.includes(next)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, next]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  const create: (p: OrphanCreateInput) => Promise<CreatedOrphan> = submitFn ?? createOrphan;

  const mutation = useMutation({
    mutationFn: (v: OrphanCreateInput) => create(v),
    onSuccess: async (created) => {
      reset();
      setTags([]);
      setTagInput("");
      await onCreated(created);
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        const detail = err.response?.data?.detail;
        if (status === 409) {
          const message = typeof detail === "string" ? detail : t("orphans.register.duplicate");
          setDuplicateError(message);
          const match = typeof detail === "string" ? detail.match(ORPHAN_CODE_PATTERN) : null;
          setDuplicateCode(match ? match[0] : null);
          return;
        }
        setServerError(typeof detail === "string" ? detail : t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  function submit(v: FormValues) {
    setServerError(null);
    setDuplicateError(null);
    setDuplicateCode(null);
    const payload: OrphanCreateInput = {
      first_name: v.first_name,
      family_name: v.family_name,
      date_of_birth: v.date_of_birth,
      gender: v.gender,
      father_name: v.father_name,
      // Non-sensitive: always sent (defaults to "unknown"), both audiences.
      mother_status: v.mother_status,
      ...(showPartnerSelect && v.partner_organization_id
        ? { partner_organization_id: v.partner_organization_id }
        : {}),
      // Staff-only: only sent when the picker was rendered (orphanages prop
      // present). Guardians never pass the prop, so it can't slip in here.
      ...(orphanages && v.orphanage_id ? { orphanage_id: v.orphanage_id } : {}),
      ...(v.nationality ? { nationality: v.nationality } : {}),
      // Extended profile — only sent when populated; numbers as numbers,
      // tags only when non-empty.
      ...(v.education_stage ? { education_stage: v.education_stage } : {}),
      ...(v.academic_level ? { academic_level: v.academic_level } : {}),
      ...(v.school_name ? { school_name: v.school_name } : {}),
      ...(v.quran_juz_memorized !== undefined
        ? { quran_juz_memorized: v.quran_juz_memorized }
        : {}),
      ...(v.quran_note ? { quran_note: v.quran_note } : {}),
      ...(v.health_status ? { health_status: v.health_status } : {}),
      ...(v.aspiration ? { aspiration: v.aspiration } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      // Staff-only sensitive fields — guardians never render/register these,
      // but we also gate here so they can't slip into the payload.
      ...(isStaff && v.health_coverage ? { health_coverage: v.health_coverage } : {}),
      ...(isStaff && v.priority_level ? { priority_level: v.priority_level } : {}),
      ...(isStaff && v.chronic_conditions
        ? { chronic_conditions: v.chronic_conditions }
        : {}),
      ...(isStaff && v.challenges ? { challenges: v.challenges } : {}),
    };
    mutation.mutate(payload);
  }

  const duplicateLink = duplicateCode ? duplicateHref(duplicateCode) : null;

  return (
    <form onSubmit={handleSubmit(submit)} className="card space-y-4">
      {duplicateError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <span>{duplicateError}</span>
          {duplicateLink && (
            <Link
              to={duplicateLink}
              className="rounded-lg border border-warning-500 bg-white px-2 py-1 text-xs font-medium text-warning-700 hover:bg-warning-50"
            >
              {t("orphans.register.viewExisting")} ({duplicateCode})
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("orphans.firstName")} error={errors.first_name?.message}>
          <input className="input" {...register("first_name")} />
        </Field>
        <Field label={t("orphans.familyName")} error={errors.family_name?.message}>
          <input className="input" {...register("family_name")} />
        </Field>
        <Field label={t("orphans.dateOfBirth")} error={errors.date_of_birth?.message}>
          <input type="date" className="input" {...register("date_of_birth")} />
        </Field>
        <Field label={t("orphans.gender")}>
          <select className="input" {...register("gender")}>
            <option value="M">{t("orphans.male")}</option>
            <option value="F">{t("orphans.female")}</option>
          </select>
        </Field>
        <Field label={t("orphans.fatherName")} error={errors.father_name?.message}>
          <input className="input" {...register("father_name")} />
        </Field>
        <Field label={t("orphans.nationality")}>
          <input className="input" placeholder="KW" maxLength={2} {...register("nationality")} />
        </Field>
        <Field label={t("orphans.profile.motherStatus")}>
          <select className="input" {...register("mother_status")}>
            {MOTHER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`orphans.profile.motherStatusOptions.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        {isStaff && (
          <Field label={t("orphans.profile.priorityLevel")}>
            <select className="input" {...register("priority_level")}>
              {PRIORITY_LEVELS.map((s) => (
                <option key={s} value={s}>
                  {t(`orphans.profile.priorityLevelOptions.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {showPartnerSelect && (
          <Field
            label={t("orphans.partner")}
            error={errors.partner_organization_id?.message}
            className="sm:col-span-2"
          >
            <select className="input" {...register("partner_organization_id")}>
              <option value="">{t("orphans.selectPartner")}</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {i18n.language === "ar" ? p.name_ar : (p.name_en ?? p.name_ar)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {orphanages && (
          <Field label={t("orphans.orphanage.label")} className="sm:col-span-2">
            <select className="input" {...register("orphanage_id")}>
              <option value="">{t("orphans.orphanage.familyHome")}</option>
              {orphanages.map((o) => (
                <option key={o.id} value={o.id}>
                  {i18n.language === "ar" ? o.name_ar : (o.name_en ?? o.name_ar)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {/* ── Education ─────────────────────────────────────── */}
      <Section title={t("orphans.profile.educationSection")}>
        <Field label={t("orphans.profile.educationStage")}>
          <select className="input" {...register("education_stage")}>
            <option value="">{t("orphans.profile.notSpecified")}</option>
            {EDUCATION_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`orphans.profile.educationStageOptions.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("orphans.profile.academicLevel")}>
          <input className="input" {...register("academic_level")} />
        </Field>
        <Field label={t("orphans.profile.schoolName")} className="sm:col-span-2">
          <input className="input" {...register("school_name")} />
        </Field>
      </Section>

      {/* ── Qur'an ────────────────────────────────────────── */}
      <Section title={t("orphans.profile.quranSection")}>
        <Field
          label={t("orphans.profile.quranJuzMemorized")}
          error={errors.quran_juz_memorized?.message}
        >
          <input
            type="number"
            min={0}
            max={30}
            step={1}
            className="input"
            {...register("quran_juz_memorized")}
          />
        </Field>
        <Field label={t("orphans.profile.quranNote")}>
          <input className="input" {...register("quran_note")} />
        </Field>
      </Section>

      {/* ── Health ────────────────────────────────────────── */}
      <Section title={t("orphans.profile.healthSection")}>
        <Field label={t("orphans.profile.healthStatus")}>
          <select className="input" {...register("health_status")}>
            <option value="">{t("orphans.profile.notSpecified")}</option>
            {HEALTH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`orphans.profile.healthStatusOptions.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        {isStaff && (
          <Field label={t("orphans.profile.healthCoverage")}>
            <select className="input" {...register("health_coverage")}>
              <option value="">{t("orphans.profile.notSpecified")}</option>
              {HEALTH_COVERAGES.map((s) => (
                <option key={s} value={s}>
                  {t(`orphans.profile.healthCoverageOptions.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isStaff && (
          <Field label={t("orphans.profile.chronicConditions")} className="sm:col-span-2">
            <textarea className="input" rows={2} {...register("chronic_conditions")} />
          </Field>
        )}
      </Section>

      {/* ── Profile ───────────────────────────────────────── */}
      <Section title={t("orphans.profile.profileSection")}>
        <Field label={t("orphans.profile.aspiration")} className="sm:col-span-2">
          <textarea className="input" rows={2} {...register("aspiration")} />
        </Field>
        {isStaff && (
          <Field label={t("orphans.profile.challenges")} className="sm:col-span-2">
            <textarea className="input" rows={2} {...register("challenges")} />
          </Field>
        )}
      </Section>

      {/* ── Tags ──────────────────────────────────────────── */}
      <Section title={t("orphans.profile.tagsSection")}>
        <Field label={t("orphans.profile.tags.label")} className="sm:col-span-2">
          {tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-tranquil px-2 py-1 text-xs text-gray-700"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={t("orphans.profile.tags.remove", { tag })}
                    className="text-gray-500 hover:text-danger-700"
                    onClick={() => removeTag(tag)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <input
            className="input"
            value={tagInput}
            placeholder={t("orphans.profile.tags.placeholder")}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
        </Field>
      </Section>

      {serverError && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{serverError}</p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t("common.saving") : t("common.save")}
        </button>
        {onCancel && (
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

/** A labelled group of fields, reusing the form's existing two-column grid.
 * No new design language — just a heading above the standard field layout. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-gray-800">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-danger-700">{error}</p>}
    </label>
  );
}
