import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import {
  createFamily,
  type FamilyCreateInput,
  listFamilies,
} from "@/lib/families";

const QK = ["families"] as const;
const HOUSING_OPTIONS = ["owned", "rented", "donated", "homeless"] as const;

export function FamiliesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listFamilies({ limit: 100 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">{t("families.title")}</h1>
        <div className="flex items-center gap-4">
          {data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("families.addNew")}
          </button>
        </div>
      </div>

      {showForm && (
        <NewFamilyForm
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
                <th className="px-4 py-3 font-medium">{t("families.code")}</th>
                <th className="px-4 py-3 font-medium">{t("families.familyName")}</th>
                <th className="px-4 py-3 font-medium">{t("families.deceasedFather")}</th>
                <th className="px-4 py-3 font-medium">{t("families.country")}</th>
                <th className="px-4 py-3 font-medium">{t("families.housing")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((f) => (
                <tr key={f.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      to={`/admin/families/${f.id}`}
                      className="text-trust hover:underline"
                    >
                      {f.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{f.family_name ?? "—"}</td>
                  <td className="px-4 py-3">{f.deceased_father_name ?? "—"}</td>
                  <td className="px-4 py-3">{f.country_code ?? "—"}</td>
                  <td className="px-4 py-3">
                    {f.housing_status
                      ? t(`families.housingStatus.${f.housing_status}`, f.housing_status)
                      : "—"}
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

function NewFamilyForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [v, setV] = useState<FamilyCreateInput>({
    family_name: "",
    deceased_father_name: "",
    country_code: "KW",
    city: "",
    housing_status: "rented",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createFamily(v),
    onSuccess: () => {
      setV({
        family_name: "",
        deceased_father_name: "",
        country_code: "KW",
        city: "",
        housing_status: "rented",
      });
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
        mut.mutate();
      }}
      className="card space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.familyName")}
          </span>
          <input
            className="input"
            value={v.family_name ?? ""}
            onChange={(e) => setV({ ...v, family_name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.deceasedFather")}
          </span>
          <input
            className="input"
            value={v.deceased_father_name ?? ""}
            onChange={(e) => setV({ ...v, deceased_father_name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.country")}
          </span>
          <input
            className="input"
            maxLength={2}
            value={v.country_code ?? ""}
            onChange={(e) => setV({ ...v, country_code: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.city")}
          </span>
          <input
            className="input"
            value={v.city ?? ""}
            onChange={(e) => setV({ ...v, city: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.housing")}
          </span>
          <select
            className="input"
            value={v.housing_status ?? "rented"}
            onChange={(e) =>
              setV({
                ...v,
                housing_status: e.target.value as FamilyCreateInput["housing_status"],
              })
            }
          >
            {HOUSING_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {t(`families.housingStatus.${h}`, h)}
              </option>
            ))}
          </select>
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
