import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import {
  createGuardian,
  getFamily,
  type GuardianCreateInput,
  listFamilyGuardians,
} from "@/lib/families";

const RELATIONS = [
  "mother",
  "grandfather",
  "grandmother",
  "uncle",
  "aunt",
  "sibling",
  "other",
] as const;

export function FamilyDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const familyQ = useQuery({
    queryKey: ["family", id],
    queryFn: () => getFamily(id),
    enabled: !!id,
  });
  const guardiansQ = useQuery({
    queryKey: ["family", id, "guardians"],
    queryFn: () => listFamilyGuardians(id),
    enabled: !!id,
  });

  const [showForm, setShowForm] = useState(false);

  if (familyQ.isLoading) {
    return <p className="text-slate-500">{t("common.loading")}</p>;
  }
  if (familyQ.error || !familyQ.data) {
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
        {t("common.loadError")}
      </p>
    );
  }
  const f = familyQ.data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/families" className="text-sm text-trust underline">
          ← {t("families.backToList")}
        </Link>
      </div>

      <div className="card space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">
          {f.family_name ?? f.code}
        </h1>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Row label={t("families.code")} value={f.code} mono />
          <Row label={t("families.deceasedFather")} value={f.deceased_father_name ?? "—"} />
          <Row label={t("families.country")} value={f.country_code ?? "—"} />
          <Row label={t("families.city")} value={f.city ?? "—"} />
          <Row
            label={t("families.housing")}
            value={
              f.housing_status
                ? t(`families.housingStatus.${f.housing_status}`, f.housing_status)
                : "—"
            }
          />
        </dl>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("families.guardians")}</h2>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("families.addGuardian")}
          </button>
        </div>

        {showForm && (
          <NewGuardianForm
            familyId={id}
            onCreated={async () => {
              await qc.invalidateQueries({ queryKey: ["family", id, "guardians"] });
              setShowForm(false);
            }}
          />
        )}

        {guardiansQ.isLoading && (
          <p className="text-slate-500">{t("common.loading")}</p>
        )}

        {guardiansQ.data && guardiansQ.data.items.length === 0 && (
          <div className="card text-center text-slate-500">{t("common.empty")}</div>
        )}

        {guardiansQ.data && guardiansQ.data.items.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full text-start">
              <thead className="border-b border-sky bg-tranquil/40 text-sm text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("families.guardianName")}</th>
                  <th className="px-4 py-3 font-medium">{t("families.relation")}</th>
                  <th className="px-4 py-3 font-medium">{t("families.phone")}</th>
                  <th className="px-4 py-3 font-medium">{t("families.email")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky/40 text-sm">
                {guardiansQ.data.items.map((g) => (
                  <tr key={g.id} className="hover:bg-snow">
                    <td className="px-4 py-3">{g.full_name}</td>
                    <td className="px-4 py-3">
                      {t(`families.relations.${g.relation}`, g.relation)}
                    </td>
                    <td className="px-4 py-3">{g.phone ?? "—"}</td>
                    <td className="px-4 py-3">{g.email ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewGuardianForm({
  familyId,
  onCreated,
}: {
  familyId: string;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState<GuardianCreateInput>({
    full_name: "",
    relation: "mother",
    phone: "",
    email: "",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      createGuardian(familyId, {
        full_name: v.full_name,
        relation: v.relation,
        ...(v.phone ? { phone: v.phone } : {}),
        ...(v.email ? { email: v.email } : {}),
      }),
    onSuccess: () => {
      setV({ full_name: "", relation: "mother", phone: "", email: "" });
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
        if (!v.full_name.trim()) return;
        mut.mutate();
      }}
      className="card space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.guardianName")}
          </span>
          <input
            className="input"
            value={v.full_name}
            onChange={(e) => setV({ ...v, full_name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.relation")}
          </span>
          <select
            className="input"
            value={v.relation}
            onChange={(e) =>
              setV({ ...v, relation: e.target.value as GuardianCreateInput["relation"] })
            }
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {t(`families.relations.${r}`, r)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.phone")}
          </span>
          <input
            className="input"
            value={v.phone ?? ""}
            onChange={(e) => setV({ ...v, phone: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("families.email")}
          </span>
          <input
            type="email"
            className="input"
            value={v.email ?? ""}
            onChange={(e) => setV({ ...v, email: e.target.value })}
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

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 ${mono ? "font-mono text-xs" : "text-sm"} text-slate-900`}>
        {value}
      </dd>
    </div>
  );
}
