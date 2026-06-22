import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { TFunction } from "i18next";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";

import {
  getCountryRequirements,
  listCountries,
  type CountryFieldFlags,
  type NationalIdRequirements,
} from "@/lib/countries";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { createOrphan, type OrphanCreateInput } from "@/lib/orphans";
import { listPartners } from "@/lib/partners";

// Matches partner-issued orphan codes like ORF-12345 / ORP-ABCDE. The backend
// embeds the existing record's code in the 409 detail string; we surface it as
// a "view existing" link (where the caller allows one — see `duplicateHref`).
const ORPHAN_CODE_PATTERN = /\bOR[FP]-[A-Z0-9]{3,}\b/;

// Enum option lists — mirror schema.gen.ts (OrphanCreate / GuardianOrphanCreate)
// exactly. Used both for the zod validators and to render the <select> options.
export const EDUCATION_STAGES = [
  "pre_kindergarten",
  "kindergarten",
  "primary",
  "preparatory",
  "secondary",
] as const;
export const ACADEMIC_LEVELS = ["weak", "good", "excellent"] as const;
// Who the child currently lives with (optional). Mirrors the LivesWith enum.
export const LIVES_WITH_OPTIONS = ["mother", "relative", "orphanage", "other"] as const;
export const HEALTH_STATUSES = [
  "good",
  "chronic_condition",
  "disability",
  "under_treatment",
] as const;
export const HEALTH_COVERAGES = ["none", "government", "private", "charity"] as const;
export const MOTHER_STATUSES = ["alive", "deceased", "unknown"] as const;
export const PRIORITY_LEVELS = ["normal", "high", "urgent"] as const;

// country_specific option lists — these feed the conditional sections a
// country can turn on (show_conflict_fields / show_wash_fields). The backend
// persists country_specific as a free JSON bag, so these vocabularies are
// owned by the form; only the values below are ever rendered/sent.
export const DAMAGE_TYPES = ["total", "partial", "severe"] as const;
export const MALNUTRITION_STATUSES = ["none", "moderate", "severe"] as const;
export const CHILD_LABOR_STATUSES = ["none", "part_time", "full_time"] as const;

// Baseline used until a country's requirements resolve (or on 404 / error):
// no conditional sections, national_id optional. Mirrors the server baseline.
const NO_COUNTRY_FLAGS: CountryFieldFlags = {
  requires_gps: false,
  show_conflict_fields: false,
  show_housing: false,
  show_wash_fields: false,
};

// Full-match a country's national_id regex (anchored both ends). UX-only — an
// unparseable server pattern never blocks the user, since the server is the
// authority and re-validates on submit.
function nationalIdMatchesPattern(regex: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${regex})$`).test(value);
  } catch {
    return true;
  }
}

// Convert Arabic-Indic (٠-٩, U+0660–0669) and Extended Arabic-Indic / Persian
// (۰-۹, U+06F0–06F9) digits to Latin (0-9). Applied to the national_id input on
// change so submissions are always Latin — the backend rejects any non-Latin
// national_id, and every per-country regex is written against Latin digits.
function toLatinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// Optional free-text: empty string is left as-is here and dropped at submit
// time (truthiness gate), so we never send "" to the API.
const optionalText = z.string().trim().optional();

// father_name is REQUIRED (domain rule: an orphan is defined by their father).
// partner_organization_id is only collected on the staff path; the guardian
// portal derives it server-side, so it is dropped from validation there.
// The extended profile fields are ALL optional, on both paths.
//
// `nationalIdRule` (the selected country's resolved requirements, or null for
// the baseline) drives the dynamic national_id validation; `t` localizes the
// resulting messages. The schema is rebuilt whenever either changes — react-
// hook-form reads the latest resolver on every validation pass.
function makeSchema(
  requirePartner: boolean,
  nationalIdRule: NationalIdRequirements | null,
  t: TFunction,
) {
  return z.object({
    first_name: z.string().trim().min(1),
    family_name: z.string().trim().min(1),
    date_of_birth: z.string().min(4),
    gender: z.enum(["M", "F"]),
    father_name: z.string().trim().min(1),
    // mother_name is OPTIONAL on both paths (persists via OrphanCreate).
    mother_name: z.string().trim().max(255).optional(),
    // Who the child currently lives with (optional, coded).
    lives_with: z
      .enum(LIVES_WITH_OPTIONS)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    // Country is REQUIRED — it drives the dynamic national_id + country_specific
    // sections. The field name stays `nationality` (the persisted column); the
    // value is the ISO alpha-2 code chosen from the country <select>.
    nationality: z
      .string({ required_error: t("orphans.country.required") })
      .trim()
      .min(1, { message: t("orphans.country.required") })
      .length(2),
    // national_id — shape depends on the selected country's rule. Empty is fine
    // unless the country marks it required; when present it must match the exact
    // length and full regex. The server stays authoritative (this is UX only).
    national_id: z
      .string()
      .trim()
      .optional()
      .superRefine((value, ctx) => {
        const v = (value ?? "").trim();
        if (!nationalIdRule) return; // baseline: nothing extra required
        if (!v) {
          if (nationalIdRule.required) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: t("orphans.nationalId.errors.required"),
            });
          }
          return;
        }
        if (nationalIdRule.length != null && v.length !== nationalIdRule.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("orphans.nationalId.errors.length", { length: nationalIdRule.length }),
          });
        }
        if (nationalIdRule.regex && !nationalIdMatchesPattern(nationalIdRule.regex, v)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("orphans.nationalId.errors.format"),
          });
        }
      }),
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
    academic_level: z
      .enum(ACADEMIC_LEVELS)
      .optional()
      .or(z.literal("").transform(() => undefined)),
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
    // country_specific (free per-country bag) — registered here so the values
    // are tracked/reset like any other field; rendered only when the country's
    // flags turn the section on, and gated again at submit so a hidden value
    // can never leak into the payload.
    damage_type: z
      .enum(DAMAGE_TYPES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    original_address: optionalText,
    water_source: optionalText,
    malnutrition_status: z
      .enum(MALNUTRITION_STATUSES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    child_labor: z
      .enum(CHILD_LABOR_STATUSES)
      .optional()
      .or(z.literal("").transform(() => undefined)),
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

  // Partner-scoped staff (partner_manager / partner_staff) only ever register
  // orphans under their own جهة, so the picker is pointless for them — it is
  // replaced by a locked read-only field pre-filled with their جهة.
  const { data: currentUser } = useCurrentUser();
  const isPartnerScoped =
    currentUser?.role === "partner_manager" || currentUser?.role === "partner_staff";
  const lockedPartnerId =
    showPartnerSelect && isPartnerScoped ? (currentUser?.partner_organization_id ?? null) : null;
  // Misconfigured account: partner-scoped but no جهة assigned. The backend
  // would 403 the create, so surface that instead of an empty picker.
  const partnerMissing = showPartnerSelect && isPartnerScoped && !lockedPartnerId;

  // Country drives everything: the list feeds the REQUIRED selector, and the
  // selected code resolves that country's requirements (national_id rule +
  // conditional sections + documents). `countryCode` is local UI state that
  // mirrors the registered `nationality` field (kept in sync by the select's
  // onChange, cleared on a successful create) so it can drive the queries and
  // the schema before react-hook-form is initialised below.
  const [countryCode, setCountryCode] = useState("");

  // The partner picker is country-filtered: pass the selected nationality (ISO
  // alpha-2, upper-cased) so only that country's جهات are listed, refetching on
  // change. Partner-scoped staff are exempt — they always get just their own
  // جهة, and filtering it by a mismatched country would hide it.
  const partnerCountryFilter =
    showPartnerSelect && !isPartnerScoped && countryCode.length === 2
      ? countryCode.toUpperCase()
      : undefined;
  const partnersQuery = useQuery({
    queryKey: ["partners", partnerCountryFilter ?? null],
    queryFn: () => listPartners(false, partnerCountryFilter),
    enabled: showPartnerSelect && !partnersProp,
  });
  const partners = useMemo(
    () => partnersProp ?? partnersQuery.data?.items ?? [],
    [partnersProp, partnersQuery.data],
  );

  const countriesQuery = useQuery({
    queryKey: ["countries"],
    queryFn: () => listCountries(),
  });
  const countries = countriesQuery.data ?? [];

  const requirementsQuery = useQuery({
    queryKey: ["country-requirements", countryCode],
    queryFn: () => getCountryRequirements(countryCode),
    enabled: countryCode.length === 2,
    retry: false, // a 404 / unconfigured country just falls through to baseline
  });
  // Baseline while loading or on 404 / unconfigured / error: nothing extra
  // required, national_id optional, no conditional sections, no documents.
  const requirements = requirementsQuery.data ?? null;
  const nationalIdRule = requirements?.national_id ?? null;
  const countryFlags = requirements?.fields ?? NO_COUNTRY_FLAGS;
  const requiredDocs = requirements?.required_documents ?? [];

  const schema = useMemo(
    () => makeSchema(showPartnerSelect, nationalIdRule, t),
    [showPartnerSelect, nationalIdRule, t],
  );

  const {
    register,
    handleSubmit,
    reset,
    resetField,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { gender: "M", mother_status: "unknown", priority_level: "normal" },
  });
  // register the country selector once so we can layer our own onChange on top.
  const nationalityField = register("nationality");
  // Same for national_id — we layer an Arabic-Indic → Latin digit conversion.
  const nationalIdField = register("national_id");

  useEffect(() => {
    if (lockedPartnerId) {
      setValue("partner_organization_id", lockedPartnerId, { shouldValidate: true });
    }
  }, [lockedPartnerId, setValue]);

  // When the country filter narrows the partner list, drop a selected partner
  // that is no longer in it — a جهة from a previous country can't be submitted.
  // Skipped for the locked partner-scoped field and the caller-supplied list.
  const selectedPartnerId = watch("partner_organization_id");
  useEffect(() => {
    if (lockedPartnerId || partnersProp || partnersQuery.isLoading) return;
    if (!selectedPartnerId) return;
    if (!partners.some((p) => p.id === selectedPartnerId)) {
      setValue("partner_organization_id", "", { shouldValidate: false });
    }
  }, [
    partners,
    selectedPartnerId,
    lockedPartnerId,
    partnersProp,
    partnersQuery.isLoading,
    setValue,
  ]);

  // When the country changes, clear the now-stale dependent fields (national_id
  // + every country_specific input, including any kept by an unmounted section)
  // and their errors, so a value entered for a previous country can never linger
  // in form state or slip into a later submit.
  const prevCountry = useRef<string | null>(null);
  useEffect(() => {
    if (prevCountry.current !== null && prevCountry.current !== countryCode) {
      resetField("national_id");
      resetField("damage_type");
      resetField("original_address");
      resetField("water_source");
      resetField("malnutrition_status");
      resetField("child_labor");
    }
    prevCountry.current = countryCode;
  }, [countryCode, resetField]);

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
      // reset() falls back to defaultValues, which can't know the جهة —
      // re-pin it so a follow-up create still submits the locked partner.
      if (lockedPartnerId) {
        setValue("partner_organization_id", lockedPartnerId);
      }
      setTags([]);
      setTagInput("");
      setCountryCode(""); // drop the resolved requirements so the next case starts clean
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
    // country_specific — collect ONLY the fields the selected country's flags
    // turn on (and only when populated). Gating on the live flags here is the
    // last line of defence: even if a hidden field kept a stale value, it can
    // never reach the payload for a country that doesn't ask for it.
    const countrySpecific: Record<string, unknown> = {};
    if (countryFlags.show_conflict_fields) {
      if (v.damage_type) countrySpecific.damage_type = v.damage_type;
      if (v.original_address) countrySpecific.original_address = v.original_address;
    }
    if (countryFlags.show_wash_fields) {
      if (v.water_source) countrySpecific.water_source = v.water_source;
      if (v.malnutrition_status) countrySpecific.malnutrition_status = v.malnutrition_status;
      if (v.child_labor) countrySpecific.child_labor = v.child_labor;
    }
    const payload: OrphanCreateInput = {
      first_name: v.first_name,
      family_name: v.family_name,
      date_of_birth: v.date_of_birth,
      gender: v.gender,
      father_name: v.father_name,
      // Optional richer-intake fields — only sent when populated, both audiences.
      ...(v.mother_name ? { mother_name: v.mother_name } : {}),
      ...(v.lives_with ? { lives_with: v.lives_with } : {}),
      // Non-sensitive: always sent (defaults to "unknown"), both audiences.
      mother_status: v.mother_status,
      ...(showPartnerSelect && v.partner_organization_id
        ? { partner_organization_id: v.partner_organization_id }
        : {}),
      // Staff-only: only sent when the picker was rendered (orphanages prop
      // present). Guardians never pass the prop, so it can't slip in here.
      ...(orphanages && v.orphanage_id ? { orphanage_id: v.orphanage_id } : {}),
      // Country is required, so always sent. national_id + country_specific are
      // country-driven and sent for BOTH audiences (never staff-gated).
      nationality: v.nationality,
      ...(v.national_id ? { national_id: v.national_id } : {}),
      ...(Object.keys(countrySpecific).length > 0
        ? { country_specific: countrySpecific }
        : {}),
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
        {/* Country FIRST — it is required and drives the dynamic national_id +
            country_specific sections below. */}
        <Field
          label={t("orphans.country.label")}
          error={errors.nationality?.message}
          className="sm:col-span-2"
        >
          <select
            className="input"
            disabled={countriesQuery.isLoading}
            {...nationalityField}
            onChange={(e) => {
              void nationalityField.onChange(e); // keep react-hook-form in sync
              setCountryCode(e.target.value); // drive requirements + schema
            }}
          >
            <option value="">{t("orphans.country.placeholder")}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {i18n.language === "ar" ? c.name_ar : (c.name_en || c.name_ar)}
              </option>
            ))}
          </select>
          {countriesQuery.isError && (
            <p className="mt-1 text-xs text-warning-700">{t("orphans.country.loadError")}</p>
          )}
        </Field>
        {/* national_id — appears once a country is chosen; its rule comes from
            that country's requirements (or the permissive baseline). */}
        {countryCode.length === 2 && (
          <Field
            label={t("orphans.nationalId.label")}
            error={errors.national_id?.message}
            className="sm:col-span-2"
          >
            <input
              className="input"
              maxLength={nationalIdRule?.length ?? undefined}
              {...nationalIdField}
              onChange={(e) => {
                // Normalise Arabic-Indic digits to Latin as the user types so
                // the submitted value is always Latin (backend rejects others).
                const latin = toLatinDigits(e.target.value);
                if (latin !== e.target.value) e.target.value = latin;
                void nationalIdField.onChange(e);
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              {nationalIdRule?.required
                ? t("orphans.nationalId.requiredHint")
                : t("orphans.nationalId.optionalHint")}
            </p>
          </Field>
        )}
        {/* Name fields, in domain order: first → father → family → mother. */}
        <Field label={t("orphans.firstName")} error={errors.first_name?.message}>
          <input className="input" {...register("first_name")} />
        </Field>
        <Field label={t("orphans.fatherName")} error={errors.father_name?.message}>
          <input className="input" {...register("father_name")} />
        </Field>
        <Field label={t("orphans.familyName")} error={errors.family_name?.message}>
          <input className="input" {...register("family_name")} />
        </Field>
        <Field label={t("orphans.motherName")} error={errors.mother_name?.message}>
          <input className="input" maxLength={255} {...register("mother_name")} />
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
        <Field label={t("orphans.livesWith")}>
          <select className="input" {...register("lives_with")}>
            <option value="">{t("orphans.profile.notSpecified")}</option>
            {LIVES_WITH_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`orphans.livesWithOptions.${s}`)}
              </option>
            ))}
          </select>
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
        {showPartnerSelect &&
          (lockedPartnerId ? (
            // Partner-scoped user: their جهة is fixed — show it read-only.
            // The hidden input keeps the value registered so it validates
            // and submits exactly like the select would.
            <Field
              label={t("orphans.partner")}
              error={errors.partner_organization_id?.message}
              className="sm:col-span-2"
            >
              <input type="hidden" {...register("partner_organization_id")} />
              <input
                className="input cursor-not-allowed bg-tranquil text-gray-700"
                value={(() => {
                  const p = partners.find((x) => x.id === lockedPartnerId);
                  if (!p) return "";
                  return i18n.language === "ar" ? p.name_ar : (p.name_en ?? p.name_ar);
                })()}
                readOnly
                disabled
              />
              <p className="mt-1 text-xs text-gray-500">{t("orphans.partnerLockedHint")}</p>
            </Field>
          ) : partnerMissing ? (
            // Partner-scoped user with no جهة on their account — the backend
            // would reject the create, so explain instead of an empty picker.
            <Field label={t("orphans.partner")} className="sm:col-span-2">
              <input className="input cursor-not-allowed bg-tranquil" value="" readOnly disabled />
              <p className="mt-1 text-xs text-warning-700">{t("orphans.partnerNotAssigned")}</p>
            </Field>
          ) : (
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
          ))}
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

      {/* ── Country-specific (conflict / WASH) ─────────────── */}
      {/* Rendered only for flags THIS form can persist. requires_gps and
          show_housing are family-level (separate flow) and out of scope here. */}
      {(countryFlags.show_conflict_fields || countryFlags.show_wash_fields) && (
        <Section title={t("orphans.countrySpecific.section")}>
          {countryFlags.show_conflict_fields && (
            <>
              <Field label={t("orphans.countrySpecific.damageType")}>
                <select className="input" {...register("damage_type")}>
                  <option value="">{t("orphans.profile.notSpecified")}</option>
                  {DAMAGE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`orphans.countrySpecific.damageTypeOptions.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("orphans.countrySpecific.originalAddress")}>
                <input className="input" {...register("original_address")} />
              </Field>
            </>
          )}
          {countryFlags.show_wash_fields && (
            <>
              <Field label={t("orphans.countrySpecific.waterSource")}>
                <input className="input" {...register("water_source")} />
              </Field>
              <Field label={t("orphans.countrySpecific.malnutritionStatus")}>
                <select className="input" {...register("malnutrition_status")}>
                  <option value="">{t("orphans.profile.notSpecified")}</option>
                  {MALNUTRITION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`orphans.countrySpecific.malnutritionStatusOptions.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("orphans.countrySpecific.childLabor")}>
                <select className="input" {...register("child_labor")}>
                  <option value="">{t("orphans.profile.notSpecified")}</option>
                  {CHILD_LABOR_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`orphans.countrySpecific.childLaborOptions.${s}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
        </Section>
      )}

      {/* ── Required documents (read-only guidance) ────────── */}
      {/* Just what to gather — upload happens after the orphan exists. */}
      {requiredDocs.length > 0 && (
        <div className="rounded-lg bg-tranquil px-3 py-2 text-sm text-gray-700">
          <p className="font-medium">{t("orphans.requiredDocuments.title")}</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {requiredDocs.map((d) => (
              <li key={d}>{t(`documents.types.${d}`, { defaultValue: d })}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500">{t("orphans.requiredDocuments.hint")}</p>
        </div>
      )}

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
          <select className="input" {...register("academic_level")}>
            <option value="">{t("orphans.profile.notSpecified")}</option>
            {ACADEMIC_LEVELS.map((s) => (
              <option key={s} value={s}>
                {t(`orphans.profile.academicLevelOptions.${s}`)}
              </option>
            ))}
          </select>
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
          <select className="input" {...register("quran_juz_memorized")}>
            <option value="">{t("orphans.profile.notSpecified")}</option>
            {Array.from({ length: 31 }, (_, i) => i).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
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
        {/* No جهة on a partner-scoped account → the create can only fail;
            block submit rather than surfacing an unfixable validation error. */}
        <button type="submit" className="btn-primary" disabled={isSubmitting || partnerMissing}>
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
