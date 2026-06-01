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

import "./adminEntities.css";

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
    <div className="adm">
      <div className="adm-head">
        <h1>{t("donors.title")}</h1>
        <div className="adm-head-actions">
          {data && (
            <span className="adm-total">
              {t("common.total")}: <span className="latin">{data.total.toLocaleString()}</span>
            </span>
          )}
          <button
            type="button"
            className="adm-btn"
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
          <button type="button" className="adm-btn" onClick={() => setShowImport((v) => !v)}>
            {showImport ? t("common.cancel") : t("donors.importCsv")}
          </button>
          <button
            type="button"
            className="adm-btn adm-btn-primary"
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
      {error && <p className="adm-error">{t("common.loadError")}</p>}

      {data && data.items.length === 0 && (
        <div className="adm-empty">{t("common.empty")}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="adm-table-card">
          <div className="adm-table-wrap">
            <table className="adm-t">
              <thead>
                <tr>
                  <th>{t("donors.code")}</th>
                  <th>{t("donors.name")}</th>
                  <th>{t("donors.email")}</th>
                  <th>{t("donors.country")}</th>
                  <th>{t("donors.currency")}</th>
                  <th>{t("donors.status")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="adm-cell-code">{d.code}</span>
                    </td>
                    <td className="adm-cell-strong">{d.full_name}</td>
                    <td className="latin">{d.email}</td>
                    <td>{d.country_of_residence ?? "—"}</td>
                    <td className="latin">{d.preferred_currency ?? "—"}</td>
                    <td>
                      <span className={`adm-status${d.status === "active" ? " success" : ""}`}>
                        <span className="dot" aria-hidden="true" />
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    <form onSubmit={handleSubmit(submit)} className="adm-card">
      <div className="adm-form-grid">
        <Field label={t("donors.name")} error={errors.full_name?.message}>
          <input {...register("full_name")} />
        </Field>
        <Field label={t("donors.email")} error={errors.email?.message}>
          <input type="email" {...register("email")} />
        </Field>
        <Field label={t("donors.phone")}>
          <input {...register("phone")} />
        </Field>
        <Field label={t("donors.country")}>
          <input placeholder="KW" maxLength={2} {...register("country_of_residence")} />
        </Field>
        <Field label={t("donors.currency")}>
          <input placeholder="KWD" maxLength={3} {...register("preferred_currency")} />
        </Field>
      </div>

      {serverError && <p className="adm-error">{serverError}</p>}

      <div className="adm-form-foot">
        <button type="submit" className="adm-btn adm-btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t("common.saving") : t("common.save")}
        </button>
      </div>
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
    <label className="adm-field">
      <span>{label}</span>
      {children}
      {error && <p className="adm-field-err">{error}</p>}
    </label>
  );
}
