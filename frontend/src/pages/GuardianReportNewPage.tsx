import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { ReportStatusBadge } from "@/components/guardian/GuardianBits";
import { Skeleton } from "@/components/Skeleton";
import { listMyOrphans, listMyReports } from "@/lib/guardianSelf";
import {
  createReport,
  transitionReport,
  type Report,
  type ReportCreateInput,
} from "@/lib/reports";
import { toast } from "@/store/toasts";

// Error messages are i18n keys, translated at render time so the form
// stays free of hardcoded strings.
const schema = z.object({
  month: z.string().trim().min(1, "guardian.report.validation.monthRequired"),
  summary: z.string().trim().min(1, "guardian.report.validation.summaryRequired"),
  educational_progress: z.string().trim(),
  quran_progress: z.string().trim(),
  activities: z.string().trim(),
  health_status: z.string().trim(),
});

type FormValues = z.infer<typeof schema>;

type Mode = "draft" | "submit";

/** Last day of a "YYYY-MM" month, as a YYYY-MM-DD string. */
function monthBounds(month: string): { start: string; end: string } {
  const [yy = "", mm = ""] = month.split("-");
  const last = new Date(Number(yy), Number(mm), 0).getDate();
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

function toJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  return trimmed ? { notes: trimmed } : undefined;
}

export function GuardianReportNewPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const orphanId = params.get("orphan_id") ?? "";

  const orphans = useQuery({
    queryKey: ["guardian", "me", "orphans"],
    queryFn: listMyOrphans,
  });
  const reports = useQuery({
    queryKey: ["guardian", "me", "reports", orphanId],
    queryFn: () => listMyReports(orphanId),
    enabled: Boolean(orphanId),
  });

  const orphan = orphans.data?.find((o) => o.id === orphanId);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      month: "",
      summary: "",
      educational_progress: "",
      quran_progress: "",
      activities: "",
      health_status: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async ({ values, mode: m }: { values: FormValues; mode: Mode }) => {
      const { start, end } = monthBounds(values.month);
      const payload: ReportCreateInput = {
        orphan_id: orphanId,
        report_type: "monthly",
        period_start: start,
        period_end: end,
        summary: values.summary.trim(),
        educational_progress: toJson(values.educational_progress),
        quran_progress: toJson(values.quran_progress),
        activities: toJson(values.activities),
        health_status: toJson(values.health_status),
      };
      const created = await createReport(payload);
      if (m === "submit") await transitionReport(created.id, "submit");
      return m;
    },
    onSuccess: async (m) => {
      await qc.invalidateQueries({
        queryKey: ["guardian", "me", "reports", orphanId],
      });
      reset();
      toast.success(
        m === "submit"
          ? t("guardian.report.submitted")
          : t("guardian.report.draftSaved"),
      );
    },
    onError: () => toast.error(t("guardian.report.saveError")),
  });

  if (!orphanId) {
    return (
      <div className="card space-y-3 text-center text-slate-500 dark:text-slate-400">
        <p>{t("guardian.report.missingOrphan")}</p>
        <Link to="/guardian" className="btn-primary inline-block">
          {t("guardian.detail.backToDashboard")}
        </Link>
      </div>
    );
  }

  const pendingMode = mutation.isPending ? mutation.variables?.mode : undefined;
  const submitDraft = handleSubmit((values) =>
    mutation.mutate({ values, mode: "draft" }),
  );
  const submitReview = handleSubmit((values) =>
    mutation.mutate({ values, mode: "submit" }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t("guardian.report.newTitle")}
        </h1>
        {orphan && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t("guardian.report.forOrphan", {
              name: `${orphan.first_name} ${orphan.family_name}`,
            })}
          </p>
        )}
      </div>

      <form onSubmit={submitReview} className="card space-y-4">
        <Field label={t("guardian.report.month")} error={errors.month?.message}>
          <input type="month" className="input" {...register("month")} />
        </Field>

        <Field
          label={t("guardian.report.summary")}
          error={errors.summary?.message}
        >
          <textarea
            className="input min-h-20"
            placeholder={t("guardian.report.notesPlaceholder")}
            {...register("summary")}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("guardian.report.educationalProgress")}>
            <textarea
              className="input min-h-20"
              placeholder={t("guardian.report.notesPlaceholder")}
              {...register("educational_progress")}
            />
          </Field>
          <Field label={t("guardian.report.quranProgress")}>
            <textarea
              className="input min-h-20"
              placeholder={t("guardian.report.notesPlaceholder")}
              {...register("quran_progress")}
            />
          </Field>
          <Field label={t("guardian.report.activities")}>
            <textarea
              className="input min-h-20"
              placeholder={t("guardian.report.notesPlaceholder")}
              {...register("activities")}
            />
          </Field>
          <Field label={t("guardian.report.healthStatus")}>
            <textarea
              className="input min-h-20"
              placeholder={t("guardian.report.notesPlaceholder")}
              {...register("health_status")}
            />
          </Field>
        </div>

        {/* Attachments — deferred this phase (upload endpoints are
            staff-only; no real-child imagery either way). */}
        <div className="rounded-xl border border-dashed border-sky-200 bg-snow p-4 text-sm text-slate-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-200">
            {t("guardian.report.attachments")}
          </p>
          <p className="mt-1">{t("guardian.report.attachmentsComingSoon")}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-4 py-2 text-sm font-medium text-slate-700 hover:bg-tranquil dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
            disabled={mutation.isPending}
            onClick={() => void submitDraft()}
          >
            {pendingMode === "draft"
              ? t("guardian.report.saving")
              : t("guardian.report.saveDraft")}
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={mutation.isPending}
          >
            {pendingMode === "submit"
              ? t("guardian.report.submitting")
              : t("guardian.report.submit")}
          </button>
        </div>
      </form>

      {/* Previously submitted reports */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t("guardian.report.submittedReports")}
        </h2>

        {reports.isLoading && <Skeleton className="h-24 w-full" />}

        {reports.data?.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("guardian.report.noReports")}
          </p>
        )}

        {reports.data && reports.data.length > 0 && (
          <ul className="divide-y divide-sky/40">
            {reports.data.map((r) => (
              <ReportRow key={r.id} report={r} orphanId={orphanId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReportRow({
  report: r,
  orphanId,
}: {
  report: Report;
  orphanId: string;
}) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-900 tabular-nums dark:text-slate-100">
          {r.period_start} — {r.period_end}
        </span>
        <ReportStatusBadge status={r.status} />
      </div>
      {r.summary && (
        <p className="text-sm text-slate-600 dark:text-slate-300">{r.summary}</p>
      )}
      {r.status === "rejected" && (
        <div className="mt-1 rounded-lg bg-danger-50 p-2 text-sm text-danger-700">
          {r.rejection_reason && (
            <p>
              <span className="font-medium">
                {t("guardian.report.rejectionReason")}:
              </span>{" "}
              {r.rejection_reason}
            </p>
          )}
          <Link
            to={`/guardian/reports/new?orphan_id=${orphanId}`}
            className="mt-1 inline-block font-medium text-trust underline underline-offset-2"
          >
            {t("guardian.report.resubmit")}
          </Link>
        </div>
      )}
    </li>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {children}
      {error && <p className="mt-1 text-xs text-danger-700">{t(error)}</p>}
    </label>
  );
}
