import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { getReport, updateReport, type ReportUpdateInput } from "@/lib/reports";
import { toast } from "@/store/toasts";

const SECTIONS = [
  "summary",
  "educational_progress",
  "quran_progress",
  "activities",
  "health_status",
  "psychological_status",
] as const;
type SectionKey = (typeof SECTIONS)[number];

export function ReportDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: report, isLoading, error } = useQuery({
    queryKey: ["report", id],
    queryFn: () => getReport(id),
    enabled: !!id,
  });

  const [drafts, setDrafts] = useState<Record<SectionKey, string>>({} as never);

  const mut = useMutation({
    mutationFn: (payload: ReportUpdateInput) => updateReport(id, payload),
    onSuccess: (next) => {
      qc.setQueryData(["report", id], next);
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(t("common.save"));
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        toast.error(err.response?.data?.detail ?? t("common.createError"));
      } else {
        toast.error(t("common.createError"));
      }
    },
  });

  if (isLoading) return <p className="text-slate-500">{t("common.loading")}</p>;
  if (error || !report) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }

  const editable = report.status === "draft";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {t(`reports.types.${report.report_type}`, report.report_type)}
          </h1>
          <p className="text-sm text-slate-500">
            {report.period_start} → {report.period_end} ·{" "}
            {t(`reports.statuses.${report.status}`, report.status)}
          </p>
        </div>
        <Link
          to="/reports"
          className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
        >
          ← {t("reports.title")}
        </Link>
      </div>

      {SECTIONS.map((key) => (
        <SectionCard
          key={key}
          label={t(`reports.sections.${key}`, key)}
          editable={editable}
          value={
            drafts[key] !== undefined
              ? drafts[key]
              : key === "summary"
                ? report.summary ?? ""
                : JSON.stringify(report[key] ?? {}, null, 2)
          }
          isJson={key !== "summary"}
          onChange={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
          onSave={() => {
            const raw = drafts[key];
            if (raw === undefined) return;
            try {
              const payload: ReportUpdateInput =
                key === "summary"
                  ? { summary: raw }
                  : { [key]: JSON.parse(raw || "{}") };
              mut.mutate(payload);
              setDrafts((d) => {
                const next = { ...d };
                delete next[key];
                return next;
              });
            } catch {
              toast.error(t("reports.invalidJson"));
            }
          }}
        />
      ))}

      {!editable && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("reports.readOnlyNotice")}
        </p>
      )}
    </div>
  );
}

interface SectionProps {
  label: string;
  value: string;
  editable: boolean;
  isJson: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
}

function SectionCard({ label, value, editable, isJson, onChange, onSave }: SectionProps) {
  const { t } = useTranslation();
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{label}</h2>
        {editable && (
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg border border-trust bg-trust px-3 py-1 text-xs text-white hover:bg-trust/90"
          >
            {t("common.save")}
          </button>
        )}
      </div>
      {editable ? (
        <textarea
          className="input min-h-[7rem] font-mono text-xs"
          value={value}
          placeholder={isJson ? "{}" : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-snow p-3 text-xs">
          {value || "—"}
        </pre>
      )}
    </div>
  );
}
