import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";

import { DonorCsvImport } from "@/components/DonorCsvImport";
import { Pagination } from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import {
  createDonor,
  exportDonorsCsv,
  listDonors,
  type DonorCreateInput,
} from "@/lib/donors";
import { toast } from "@/store/toasts";

const PAGE_SIZE = 20;
const donorQueryKey = (offset: number) =>
  ["donors", { limit: PAGE_SIZE, offset }] as const;

const schema = z.object({
  full_name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  country_of_residence: z
    .string()
    .length(2)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  preferred_currency: z
    .string()
    .length(3)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type FormValues = z.infer<typeof schema>;

export function DonorsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [offset, setOffset] = useState(0);

  const queryKey = donorQueryKey(offset);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => listDonors({ limit: PAGE_SIZE, offset }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t("donors.title")}</h1>
        <div className="flex items-center gap-4">
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
                const blob = await exportDonorsCsv();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "rufaqaa-donors.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error(t("common.loadError"));
              }
            }}
          >
            {t("donors.exportCsv")}
          </button>
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil"
            onClick={() => setShowImport((v) => !v)}
          >
            {showImport ? t("common.cancel") : t("donors.importCsv")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("donors.addNew")}
          </button>
        </div>
      </div>

      {showImport && (
        <DonorCsvImport
          onImported={async () => {
            await qc.invalidateQueries({ queryKey: ["donors"] });
            setOffset(0);
          }}
        />
      )}

      {showForm && (
        <NewDonorForm
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: ["donors"] });
            setShowForm(false);
            setOffset(0);
          }}
        />
      )}

      {data && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
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

      {data && data.items.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-start">
            <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
              <tr>
                <th className="px-4 py-3 font-medium">{t("donors.code")}</th>
                <th className="px-4 py-3 font-medium">{t("donors.name")}</th>
                <th className="px-4 py-3 font-medium">{t("donors.email")}</th>
                <th className="px-4 py-3 font-medium">{t("donors.country")}</th>
                <th className="px-4 py-3 font-medium">{t("donors.currency")}</th>
                <th className="px-4 py-3 font-medium">{t("donors.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((d) => (
                <tr key={d.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{d.code}</td>
                  <td className="px-4 py-3">{d.full_name}</td>
                  <td className="px-4 py-3">{d.email}</td>
                  <td className="px-4 py-3">{d.country_of_residence ?? "—"}</td>
                  <td className="px-4 py-3">{d.preferred_currency ?? "—"}</td>
                  <td className="px-4 py-3">{d.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewDonorForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const mutation = useMutation({
    mutationFn: (v: DonorCreateInput) => createDonor(v),
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
    mutation.mutate({
      full_name: v.full_name,
      email: v.email,
      ...(v.phone ? { phone: v.phone } : {}),
      ...(v.country_of_residence ? { country_of_residence: v.country_of_residence } : {}),
      ...(v.preferred_currency ? { preferred_currency: v.preferred_currency } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="card space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("donors.name")} error={errors.full_name?.message}>
          <input className="input" {...register("full_name")} />
        </Field>
        <Field label={t("donors.email")} error={errors.email?.message}>
          <input type="email" className="input" {...register("email")} />
        </Field>
        <Field label={t("donors.phone")}>
          <input className="input" {...register("phone")} />
        </Field>
        <Field label={t("donors.country")}>
          <input className="input" placeholder="KW" maxLength={2} {...register("country_of_residence")} />
        </Field>
        <Field label={t("donors.currency")}>
          <input className="input" placeholder="KWD" maxLength={3} {...register("preferred_currency")} />
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
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  );
}
