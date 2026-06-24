import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { Skeleton } from "@/components/Skeleton";
import {
  createOrphanageReport,
  listOrphanageResidents,
  type ActivitiesSection,
  type EducationProgress,
  type HealthStatus,
  type OrphanageReportInput,
  type PsychologicalStatus,
  type QuranProgress,
} from "@/lib/orphanageSelf";
import { ageFromDob } from "@/lib/orphanSelf";
import { toast } from "@/store/toasts";

// ── Coded vocabularies — mirror the canonical section models (schema.gen.ts).
// Rendered as <select> options (localized) and used by the zod validators.
const REPORT_TYPES = ["monthly", "quarterly", "annual", "special", "incident"] as const;
const EDU_RATINGS = ["excellent", "very_good", "good", "fair", "needs_support"] as const;
const QURAN_EVALS = ["mastered", "very_good", "good", "needs_review"] as const;
const HEALTH_GENERAL = ["good", "stable", "monitored", "needs_attention"] as const;
const MOODS = ["good", "okay", "needs_attention"] as const;
const SOCIALS = ["excellent", "good", "improving", "needs_support"] as const;

// The five donor-visibility section keys (orphan_reports.section_visibility).
// A section is shown to the sponsor UNLESS its key is explicitly `false`.
const SECTION_KEYS = ["education", "quran", "activities", "health", "psychological"] as const;
type SectionKey = (typeof SECTION_KEYS)[number];

type SubjectRow = NonNullable<EducationProgress["subjects"]>[number];
type ActivityRow = NonNullable<ActivitiesSection["items"]>[number];

const optionalText = z.string().trim().optional();

// A coded <select> whose empty option ("") normalises to undefined, so an
// untouched section field is simply "not provided" (mirrors NewOrphanForm).
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .enum(values)
    .optional()
    .or(z.literal("").transform(() => undefined));
}

// Numeric input → integer in [min, max] or undefined. Empty / unparseable
// normalises to undefined so a blank field never trips the range check.
function optionalInt(min: number, max: number, message: string) {
  return z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z.number().int().min(min, { message }).max(max, { message }).optional(),
  );
}

// Rebuilt whenever `t` changes so validation messages stay localized.
function makeSchema(t: TFunction) {
  return z
    .object({
      report_type: z.enum(REPORT_TYPES),
      period_start: z.string().min(1),
      period_end: z.string().min(1),
      // Education
      edu_stage: optionalText,
      edu_school: optionalText,
      edu_rating: optionalEnum(EDU_RATINGS),
      edu_attendance: optionalInt(0, 100, t("orphanageManager.report.errors.attendanceRange")),
      edu_subjects: z.array(z.object({ name: optionalText, grade: optionalText })),
      edu_note: optionalText,
      // Qur'an
      quran_juz_memorized: optionalInt(
        0,
        30,
        t("orphanageManager.report.errors.juzMemorizedRange"),
      ),
      quran_current_juz: optionalInt(1, 30, t("orphanageManager.report.errors.currentJuzRange")),
      quran_evaluation: optionalEnum(QURAN_EVALS),
      quran_recent: optionalText,
      quran_note: optionalText,
      // Activities
      activities_items: z.array(z.object({ title: optionalText, note: optionalText })),
      activities_note: optionalText,
      // Health
      health_general: optionalEnum(HEALTH_GENERAL),
      health_note: optionalText,
      // Wellbeing
      psych_mood: optionalEnum(MOODS),
      psych_social: optionalEnum(SOCIALS),
      psych_note: optionalText,
      // Summary, sponsor note & milestone
      summary: optionalText,
      donor_message: optionalText,
      is_milestone: z.boolean(),
      milestone_label: optionalText,
    })
    .superRefine((val, ctx) => {
      // ISO yyyy-mm-dd strings compare correctly lexicographically.
      if (val.period_start && val.period_end && val.period_end < val.period_start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["period_end"],
          message: t("orphanageManager.report.errors.periodOrder"),
        });
      }
      if (val.is_milestone && !(val.milestone_label ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["milestone_label"],
          message: t("orphanageManager.report.errors.milestoneLabelRequired"),
        });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

function cleanText(value?: string): string | undefined {
  const v = (value ?? "").trim();
  return v.length ? v : undefined;
}

// Drop undefined/null/empty values; return null when nothing was filled, so a
// section card with no data is sent as `null` (the canonical "absent section").
function compact<T extends object>(obj: T): T | null {
  const out = {} as T;
  let any = false;
  for (const [k, val] of Object.entries(obj) as [keyof T, unknown][]) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    if (typeof val === "string" && val.trim() === "") continue;
    out[k] = val as T[keyof T];
    any = true;
  }
  return any ? out : null;
}

function firstOfMonth(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function lastOfMonth(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

/** Structured report-authoring form for one of the dar's resident orphans.
 *
 * Replaces the old 3-step wizard with a single form of section cards that
 * capture all six canonical report sections. On submit it POSTs to
 * /orphanage/me/reports, landing the report directly in
 * `pending_partner_approval` so it surfaces in the staff review queue and the
 * manager sees the pending→approved/rejected status back on the orphan page.
 *
 * Each of the five content sections has a show/hide toggle (visible by
 * default); hiding marks `section_visibility[key] = false` so the sponsor never
 * sees it — staff still do. Nothing is auto-published; review precedes the
 * sponsor. The backend 403s for a non-resident orphan. */
export function OrphanageManagerReportPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const residents = useQuery({
    queryKey: ["orphanage", "me", "orphans"],
    queryFn: listOrphanageResidents,
  });
  const orphan = residents.data?.find((o) => o.id === id);

  const schema = useMemo(() => makeSchema(t), [t]);
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      report_type: "monthly",
      period_start: firstOfMonth(new Date()),
      period_end: lastOfMonth(new Date()),
      is_milestone: false,
      edu_subjects: [],
      activities_items: [],
    },
  });
  const subjects = useFieldArray({ control, name: "edu_subjects" });
  const activities = useFieldArray({ control, name: "activities_items" });

  // Per-section donor visibility — `true` here means HIDDEN from the sponsor.
  // Every section starts visible (the product default).
  const [hidden, setHidden] = useState<Record<SectionKey, boolean>>({
    education: false,
    quran: false,
    activities: false,
    health: false,
    psychological: false,
  });
  const toggleHidden = (key: SectionKey) =>
    setHidden((h) => ({ ...h, [key]: !h[key] }));

  const isMilestone = watch("is_milestone");

  const submit = useMutation({
    mutationFn: createOrphanageReport,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orphanage", "me", "reports", id] });
      toast.success(t("orphanageManager.report.sentSuccess"));
      navigate(`/orphanage-manager/orphans/${id}`);
    },
    onError: (err) => {
      const detail = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof detail === "string" ? detail : t("orphanageManager.report.sentError"));
    },
  });

  function onValid(v: FormValues) {
    const subjectRows: SubjectRow[] = v.edu_subjects
      .map((s) => ({ name: (s.name ?? "").trim(), grade: cleanText(s.grade) }))
      .filter((s) => s.name.length > 0)
      .map((s) => (s.grade ? { name: s.name, grade: s.grade } : { name: s.name }));
    const activityRows: ActivityRow[] = v.activities_items
      .map((a) => ({ title: (a.title ?? "").trim(), note: cleanText(a.note) }))
      .filter((a) => a.title.length > 0)
      .map((a) => (a.note ? { title: a.title, note: a.note } : { title: a.title }));

    const educational_progress = compact<EducationProgress>({
      stage: cleanText(v.edu_stage),
      school_name: cleanText(v.edu_school),
      overall_rating: v.edu_rating,
      attendance_percent: v.edu_attendance,
      subjects: subjectRows.length ? subjectRows : undefined,
      note: cleanText(v.edu_note),
    });
    const quran_progress = compact<QuranProgress>({
      juz_memorized: v.quran_juz_memorized,
      current_juz: v.quran_current_juz,
      evaluation: v.quran_evaluation,
      recent: cleanText(v.quran_recent),
      note: cleanText(v.quran_note),
    });
    const activitiesSection = compact<ActivitiesSection>({
      items: activityRows.length ? activityRows : undefined,
      note: cleanText(v.activities_note),
    });
    const health_status = compact<HealthStatus>({
      general: v.health_general,
      note: cleanText(v.health_note),
    });
    const psychological_status = compact<PsychologicalStatus>({
      mood: v.psych_mood,
      social: v.psych_social,
      note: cleanText(v.psych_note),
    });

    // Send only the hidden sections (`false`); visible ones are the default,
    // so an all-visible report carries an empty map.
    const section_visibility: Record<string, boolean> = {};
    for (const key of SECTION_KEYS) {
      if (hidden[key]) section_visibility[key] = false;
    }

    const payload: OrphanageReportInput = {
      orphan_id: id,
      report_type: v.report_type,
      period_start: v.period_start,
      period_end: v.period_end,
      summary: cleanText(v.summary) ?? null,
      educational_progress,
      quran_progress,
      activities: activitiesSection,
      health_status,
      psychological_status,
      donor_message: cleanText(v.donor_message) ?? null,
      is_milestone: v.is_milestone,
      milestone_label: v.is_milestone ? (cleanText(v.milestone_label) ?? null) : null,
      section_visibility,
    };
    submit.mutate(payload);
  }

  if (residents.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (residents.data && !orphan) {
    return (
      <div className="card space-y-3" role="alert">
        <p className="text-gray-700 dark:text-gray-200">
          {t("orphanageManager.detail.notFound")}
        </p>
        <Link to="/orphanage-manager" className="text-trust-600 hover:underline">
          {t("orphanageManager.detail.backHome")}
        </Link>
      </div>
    );
  }

  if (!orphan) return null;

  const fullName = `${orphan.first_name} ${orphan.family_name}`.trim();
  const age = ageFromDob(orphan.date_of_birth);
  const genderLabel = t(`orphanageManager.gender.${orphan.gender}`, {
    defaultValue: orphan.gender,
  });

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-6" aria-label={t("orphanageManager.report.navLabel")}>
      {/* Header + back link */}
      <div className="space-y-2">
        <Link
          to={`/orphanage-manager/orphans/${orphan.id}`}
          className="inline-flex items-center gap-1 text-sm text-trust-600 hover:underline"
        >
          <ChevronIcon />
          {t("orphanageManager.report.backToOrphan", { name: orphan.first_name })}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("orphanageManager.report.title")}
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("orphanageManager.report.subtitle")}
        </p>
      </div>

      {/* Orphan context */}
      <div className="card flex items-center gap-4">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-trust-100 text-lg font-semibold text-trust-700 dark:bg-trust-900/40 dark:text-trust-200"
          aria-hidden="true"
        >
          {orphan.first_name.slice(0, 1)}
        </span>
        <div>
          <strong className="block text-gray-900 dark:text-gray-100">{fullName}</strong>
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {t("orphanageManager.home.ageYears", { count: age })} · {genderLabel}
          </span>
        </div>
      </div>

      {/* Report meta */}
      <section className="card space-y-4" aria-labelledby="rep-meta">
        <h2 id="rep-meta" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("orphanageManager.report.metaTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("orphanageManager.report.reportTypeLabel")}>
            <select className="input" {...register("report_type")}>
              {REPORT_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t(`orphanageManager.report.reportTypeOptions.${rt}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("orphanageManager.report.periodStart")} error={errors.period_start?.message}>
            <input type="date" className="input" {...register("period_start")} />
          </Field>
          <Field label={t("orphanageManager.report.periodEnd")} error={errors.period_end?.message}>
            <input type="date" className="input" {...register("period_end")} />
          </Field>
        </div>
      </section>

      {/* Education */}
      <SectionCard
        title={t("orphanageManager.report.eduTitle")}
        sectionKey="education"
        hidden={hidden.education}
        onToggle={toggleHidden}
      >
        <Field label={t("orphanageManager.report.eduStage")}>
          <input className="input" {...register("edu_stage")} />
        </Field>
        <Field label={t("orphanageManager.report.eduSchool")}>
          <input className="input" {...register("edu_school")} />
        </Field>
        <Field label={t("orphanageManager.report.eduRating")}>
          <select className="input" {...register("edu_rating")}>
            <option value="">{t("orphanageManager.report.notSpecified")}</option>
            {EDU_RATINGS.map((r) => (
              <option key={r} value={r}>
                {t(`orphanageManager.report.eduRatingOptions.${r}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t("orphanageManager.report.eduAttendance")}
          error={errors.edu_attendance?.message}
        >
          <input type="number" min={0} max={100} className="input" {...register("edu_attendance")} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanageManager.report.eduSubjects")}{" "}
            <span className="text-xs font-normal text-gray-400">
              {t("orphanageManager.report.optional")}
            </span>
          </span>
          {subjects.fields.map((f, i) => (
            <div key={f.id} className="flex items-start gap-2">
              <input
                className="input"
                placeholder={t("orphanageManager.report.subjectName")}
                aria-label={t("orphanageManager.report.subjectName")}
                {...register(`edu_subjects.${i}.name`)}
              />
              <input
                className="input"
                placeholder={t("orphanageManager.report.subjectGrade")}
                aria-label={t("orphanageManager.report.subjectGrade")}
                {...register(`edu_subjects.${i}.grade`)}
              />
              <RemoveRowButton onClick={() => subjects.remove(i)} />
            </div>
          ))}
          <AddRowButton
            label={t("orphanageManager.report.addSubject")}
            onClick={() => subjects.append({ name: "", grade: "" })}
          />
        </div>
        <NoteField label={t("orphanageManager.report.note")} register={register("edu_note")} />
      </SectionCard>

      {/* Qur'an */}
      <SectionCard
        title={t("orphanageManager.report.quranTitle")}
        sectionKey="quran"
        hidden={hidden.quran}
        onToggle={toggleHidden}
      >
        <Field
          label={t("orphanageManager.report.quranJuzMemorized")}
          error={errors.quran_juz_memorized?.message}
        >
          <input
            type="number"
            min={0}
            max={30}
            className="input"
            {...register("quran_juz_memorized")}
          />
        </Field>
        <Field
          label={t("orphanageManager.report.quranCurrentJuz")}
          error={errors.quran_current_juz?.message}
        >
          <input type="number" min={1} max={30} className="input" {...register("quran_current_juz")} />
        </Field>
        <Field label={t("orphanageManager.report.quranEvaluation")}>
          <select className="input" {...register("quran_evaluation")}>
            <option value="">{t("orphanageManager.report.notSpecified")}</option>
            {QURAN_EVALS.map((e) => (
              <option key={e} value={e}>
                {t(`orphanageManager.report.quranEvaluationOptions.${e}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("orphanageManager.report.quranRecent")}>
          <input className="input" {...register("quran_recent")} />
        </Field>
        <NoteField label={t("orphanageManager.report.note")} register={register("quran_note")} />
      </SectionCard>

      {/* Activities */}
      <SectionCard
        title={t("orphanageManager.report.activitiesTitle")}
        sectionKey="activities"
        hidden={hidden.activities}
        onToggle={toggleHidden}
      >
        <div className="space-y-2 sm:col-span-2">
          {activities.fields.map((f, i) => (
            <div key={f.id} className="flex items-start gap-2">
              <input
                className="input"
                placeholder={t("orphanageManager.report.activityTitle")}
                aria-label={t("orphanageManager.report.activityTitle")}
                {...register(`activities_items.${i}.title`)}
              />
              <input
                className="input"
                placeholder={t("orphanageManager.report.note")}
                aria-label={t("orphanageManager.report.note")}
                {...register(`activities_items.${i}.note`)}
              />
              <RemoveRowButton onClick={() => activities.remove(i)} />
            </div>
          ))}
          <AddRowButton
            label={t("orphanageManager.report.addActivity")}
            onClick={() => activities.append({ title: "", note: "" })}
          />
        </div>
        <NoteField
          label={t("orphanageManager.report.note")}
          register={register("activities_note")}
        />
      </SectionCard>

      {/* Health */}
      <SectionCard
        title={t("orphanageManager.report.healthTitle")}
        sectionKey="health"
        hidden={hidden.health}
        onToggle={toggleHidden}
      >
        <Field label={t("orphanageManager.report.healthGeneral")}>
          <select className="input" {...register("health_general")}>
            <option value="">{t("orphanageManager.report.notSpecified")}</option>
            {HEALTH_GENERAL.map((g) => (
              <option key={g} value={g}>
                {t(`orphanageManager.report.healthGeneralOptions.${g}`)}
              </option>
            ))}
          </select>
        </Field>
        <NoteField label={t("orphanageManager.report.note")} register={register("health_note")} />
      </SectionCard>

      {/* Wellbeing */}
      <SectionCard
        title={t("orphanageManager.report.psychTitle")}
        sectionKey="psychological"
        hidden={hidden.psychological}
        onToggle={toggleHidden}
      >
        <Field label={t("orphanageManager.report.psychMood")}>
          <select className="input" {...register("psych_mood")}>
            <option value="">{t("orphanageManager.report.notSpecified")}</option>
            {MOODS.map((m) => (
              <option key={m} value={m}>
                {t(`orphanageManager.report.moodOptions.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("orphanageManager.report.psychSocial")}>
          <select className="input" {...register("psych_social")}>
            <option value="">{t("orphanageManager.report.notSpecified")}</option>
            {SOCIALS.map((s) => (
              <option key={s} value={s}>
                {t(`orphanageManager.report.socialOptions.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <NoteField label={t("orphanageManager.report.note")} register={register("psych_note")} />
      </SectionCard>

      {/* Summary & sponsor note */}
      <section className="card space-y-4" aria-labelledby="rep-summary">
        <h2 id="rep-summary" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("orphanageManager.report.summaryTitle")}
        </h2>
        <Field label={t("orphanageManager.report.summaryLabel")}>
          <textarea
            className="input"
            rows={3}
            placeholder={t("orphanageManager.report.summaryPlaceholder")}
            {...register("summary")}
          />
        </Field>
        <Field label={t("orphanageManager.report.donorMessageLabel")}>
          <textarea
            className="input"
            rows={3}
            placeholder={t("orphanageManager.report.donorMessagePlaceholder")}
            {...register("donor_message")}
          />
          <p className="mt-1 text-xs text-gray-500">
            {t("orphanageManager.report.donorMessageHint")}
          </p>
        </Field>
      </section>

      {/* Milestone */}
      <section className="card space-y-4" aria-labelledby="rep-milestone">
        <h2 id="rep-milestone" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("orphanageManager.report.milestoneTitle")}
        </h2>
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1 h-4 w-4" {...register("is_milestone")} />
          <span>
            <span className="block text-sm font-medium text-gray-800 dark:text-gray-100">
              {t("orphanageManager.report.isMilestone")}
            </span>
            <span className="block text-xs text-gray-500">
              {t("orphanageManager.report.milestoneHint")}
            </span>
          </span>
        </label>
        {isMilestone && (
          <Field
            label={t("orphanageManager.report.milestoneLabel")}
            error={errors.milestone_label?.message}
          >
            <input
              className="input"
              placeholder={t("orphanageManager.report.milestoneLabelPlaceholder")}
              {...register("milestone_label")}
            />
          </Field>
        )}
      </section>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={submit.isPending}>
          {submit.isPending
            ? t("orphanageManager.report.submitting")
            : t("orphanageManager.report.submit")}
        </button>
        <Link
          to={`/orphanage-manager/orphans/${orphan.id}`}
          className="rounded-xl border border-sky-200 px-4 py-2 text-sm text-gray-700 hover:bg-tranquil-200 dark:border-gray-700 dark:text-gray-200"
        >
          {t("common.cancel")}
        </Link>
      </div>

      <p className="rounded-xl bg-tranquil-200 px-4 py-3 text-sm text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
        {t("orphanageManager.report.privacyNote")}
      </p>
    </form>
  );
}

// ── Building blocks ────────────────────────────────────────────────────

/** A content section rendered as a card, with a header donor-visibility
 * toggle. Hiding keeps the fields editable (staff still see them) and only
 * flips what the sponsor is shown. */
function SectionCard({
  title,
  sectionKey,
  hidden,
  onToggle,
  children,
}: {
  title: string;
  sectionKey: SectionKey;
  hidden: boolean;
  onToggle: (key: SectionKey) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = `sec-${sectionKey}`;
  return (
    <section className="card space-y-4" aria-labelledby={headingId}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        <button
          type="button"
          role="switch"
          aria-checked={!hidden}
          aria-label={
            hidden
              ? t("orphanageManager.report.showAction")
              : t("orphanageManager.report.hideAction")
          }
          onClick={() => onToggle(sectionKey)}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            hidden
              ? "border-gray-300 bg-gray-100 text-gray-600 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              : "border-trust-300 bg-trust-50 text-trust-700 dark:border-trust-700 dark:bg-trust-900/30 dark:text-trust-200"
          }`}
        >
          <EyeIcon off={hidden} />
          {hidden ? t("orphanageManager.report.hidden") : t("orphanageManager.report.shown")}
        </button>
      </header>
      {hidden && (
        <p className="rounded-xl bg-tranquil-200 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800/60 dark:text-gray-300">
          {t("orphanageManager.report.hiddenHint")}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
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
      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
        {label}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-danger-700">{error}</p>}
    </label>
  );
}

/** A full-width optional note textarea — the trailing field of most cards. */
function NoteField({
  label,
  register,
}: {
  label: string;
  register: ReturnType<ReturnType<typeof useForm<FormValues>>["register"]>;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} className="sm:col-span-2">
      <textarea
        className="input"
        rows={2}
        placeholder={t("orphanageManager.report.notePlaceholder")}
        {...register}
      />
    </Field>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-sm font-medium text-trust-600 hover:text-trust-700"
    >
      <span aria-hidden="true">+</span>
      {label}
    </button>
  );
}

function RemoveRowButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("orphanageManager.report.removeRow")}
      className="mt-1 shrink-0 rounded-lg border border-sky-200 px-2 py-1.5 text-gray-500 hover:bg-tranquil-200 hover:text-danger-700 dark:border-gray-700"
    >
      ✕
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
