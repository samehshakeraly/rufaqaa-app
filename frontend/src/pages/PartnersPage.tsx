import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import {
  archivePartner,
  createPartner,
  listPartners,
  type PartnerCreateInput,
} from "@/lib/partners";

const QK = ["partners", { includeInactive: true }] as const;

export function PartnersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listPartners(true),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archivePartner(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t("partners.title")}</h1>
        <div className="flex items-center gap-4">
          {data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          {isAdmin && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? t("common.cancel") : t("partners.addNew")}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <NewPartnerForm
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: QK });
            setShowForm(false);
          }}
        />
      )}

      {isLoading && <TableSkeleton columns={5} />}
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
                <th className="px-4 py-3 font-medium">{t("partners.code")}</th>
                <th className="px-4 py-3 font-medium">{t("partners.name")}</th>
                <th className="px-4 py-3 font-medium">{t("partners.country")}</th>
                <th className="px-4 py-3 font-medium">{t("partners.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((p) => (
                <tr key={p.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3">
                    {i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar}
                  </td>
                  <td className="px-4 py-3">{p.country_code}</td>
                  <td className="px-4 py-3">
                    {t(`partners.statuses.${p.status}`, p.status)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {isAdmin && p.status === "active" && (
                      <button
                        type="button"
                        className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil"
                        onClick={() => archive.mutate(p.id)}
                        disabled={archive.isPending}
                      >
                        {t("partners.archive")}
                      </button>
                    )}
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

function NewPartnerForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [v, setV] = useState<PartnerCreateInput>({
    name_ar: "",
    name_en: "",
    country_code: "KW",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createPartner(v),
    onSuccess: () => {
      setV({ name_ar: "", name_en: "", country_code: "KW" });
      onCreated();
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        if (!v.name_ar.trim() || v.country_code.length !== 2) return;
        mut.mutate();
      }}
      className="card space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("partners.nameAr")}
          </span>
          <input
            className="input"
            value={v.name_ar}
            onChange={(e) => setV({ ...v, name_ar: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("partners.nameEn")}
          </span>
          <input
            className="input"
            value={v.name_en ?? ""}
            onChange={(e) => setV({ ...v, name_en: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("partners.country")}
          </span>
          <input
            className="input"
            maxLength={2}
            value={v.country_code}
            onChange={(e) => setV({ ...v, country_code: e.target.value.toUpperCase() })}
          />
        </label>
      </div>
      {serverError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}
      <button type="submit" className="btn-primary" disabled={mut.isPending}>
        {mut.isPending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}
