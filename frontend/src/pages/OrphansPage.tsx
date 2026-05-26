import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";

import { Pagination } from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import {
  createOrphan,
  exportOrphansCsv,
  listOrphans,
  type OrphanCreateInput,
} from "@/lib/orphans";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

const PAGE_SIZE = 20;

const orphanQueryKey = (q: string, caseStatus: string, offset: number) =>
  ["orphans", { limit: PAGE_SIZE, offset, q, caseStatus }] as const;

const CASE_STATUS_OPTIONS = [
  "",
  "pending_review",
  "approved",
  "available",
  "reserved",
  "sponsored",
  "graduated",
] as const;

const schema = z.object({
  first_name: z.string().min(1),
  family_name: z.string().min(1),
  date_of_birth: z.string().min(4),
  gender: z.enum(["M", "F"]),
  partner_organization_id: z.string().uuid(),
  father_name: z.string().optional(),
  nationality: z
    .string()
    .length(2)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type FormValues = z.infer<typeof schema>;

export function OrphansPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [caseStatus, setCaseStatus] = useState<string>("");
  const [offset, setOffset] = useState(0);

  // 300ms debounce on the search box so we don't spam the API on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset to page 1 whenever filters change so users don't land on an
  // empty page after narrowing the result set.
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, caseStatus]);

  const queryKey = orphanQueryKey(debouncedSearch, caseStatus, offset);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      listOrphans({
        limit: PAGE_SIZE,
        offset,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        ...(caseStatus ? { case_status: caseStatus } : {}),
      }),
  });
  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: () => listPartners(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-900">{t("orphans.title")}</h1>
        <div className="flex flex-1 items-center justify-end gap-4">
          <input
            type="search"
            className="input max-w-xs"
            placeholder={t("orphans.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="input max-w-[10rem]"
            value={caseStatus}
            onChange={(e) => setCaseStatus(e.target.value)}
          >
            {CASE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? t("orphans.allStatuses") : t(`orphans.caseStatus.${s}`, s)}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil"
            onClick={async () => {
              try {
                const blob = await exportOrphansCsv(
                  caseStatus ? { case_status: caseStatus } : {},
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "rufaqaa-orphans.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error(t("common.loadError"));
              }
            }}
          >
            {t("orphans.exportCsv")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("orphans.addNew")}
          </button>
        </div>
      </div>

      {showForm && (
        <NewOrphanForm
          partners={partners?.items ?? []}
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: queryKey });
            setShowForm(false);
          }}
        />
      )}

      {isLoading && <TableSkeleton columns={6} />}
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-slate-500">{t("common.empty")}</div>
      )}

      {data && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
        />
      )}

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">{t("orphans.code")}</th>
                <th className="px-4 py-3 font-medium">{t("orphans.name")}</th>
                <th className="px-4 py-3 font-medium">{t("orphans.dateOfBirth")}</th>
                <th className="px-4 py-3 font-medium">{t("orphans.gender")}</th>
                <th className="px-4 py-3 font-medium">{t("orphans.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((o) => (
                <tr key={o.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link to={`/orphans/${o.id}`} className="text-trust hover:underline">
                      {o.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {o.first_name} {o.family_name}
                  </td>
                  <td className="px-4 py-3">{o.date_of_birth}</td>
                  <td className="px-4 py-3">
                    {o.gender === "M" ? t("orphans.male") : t("orphans.female")}
                  </td>
                  <td className="px-4 py-3">
                    {t(`orphans.caseStatus.${o.case_status}`, o.case_status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface NewOrphanFormProps {
  partners: { id: string; name_ar: string; name_en: string | null }[];
  onCreated: () => void | Promise<void>;
}

function NewOrphanForm({ partners, onCreated }: NewOrphanFormProps) {
  const { t, i18n } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { gender: "M" },
  });

  const mutation = useMutation({
    mutationFn: (v: OrphanCreateInput) => createOrphan(v),
    onSuccess: async () => {
      reset();
      await onCreated();
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  function submit(v: FormValues) {
    setServerError(null);
    const payload: OrphanCreateInput = {
      first_name: v.first_name,
      family_name: v.family_name,
      date_of_birth: v.date_of_birth,
      gender: v.gender,
      partner_organization_id: v.partner_organization_id,
      ...(v.father_name ? { father_name: v.father_name } : {}),
      ...(v.nationality ? { nationality: v.nationality } : {}),
    };
    mutation.mutate(payload);
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="card space-y-4">
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
        <Field label={t("orphans.fatherName")}>
          <input className="input" {...register("father_name")} />
        </Field>
        <Field label={t("orphans.nationality")}>
          <input className="input" placeholder="KW" maxLength={2} {...register("nationality")} />
        </Field>
        <Field
          label={t("orphans.partner")}
          error={errors.partner_organization_id?.message}
          className="sm:col-span-2"
        >
          <select className="input" {...register("partner_organization_id")}>
            <option value="">{t("orphans.selectPartner")}</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {serverError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}

      <button type="submit" className="btn-primary" disabled={isSubmitting}>
        {isSubmitting ? t("common.saving") : t("common.save")}
      </button>
    </form>
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}
