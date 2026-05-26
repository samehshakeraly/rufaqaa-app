import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { listDonors, type Donor } from "@/lib/donors";
import { listOrphans, type Orphan } from "@/lib/orphans";
import {
  cancelSponsorship,
  createSponsorship,
  exportSponsorshipsCsv,
  listSponsorships,
  pauseSponsorship,
  resumeSponsorship,
  type SponsorshipCreateInput,
} from "@/lib/sponsorships";
import { toast } from "@/store/toasts";

const SP_QUERY = ["sponsorships", { limit: 50, offset: 0 }] as const;
const ACTIVE = new Set(["active", "paused", "overdue"]);
const FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "one_time",
] as const;

export function SponsorshipsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: SP_QUERY,
    queryFn: () => listSponsorships({ limit: 50, offset: 0 }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelSponsorship(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SP_QUERY });
      toast.success(t("sponsorships.cancelled"));
    },
  });
  const pauseMut = useMutation({
    mutationFn: (id: string) => pauseSponsorship(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SP_QUERY }),
  });
  const resumeMut = useMutation({
    mutationFn: (id: string) => resumeSponsorship(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SP_QUERY }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("sponsorships.title")}
        </h1>
        <div className="flex items-center gap-4">
          {data && (
            <span className="text-sm text-slate-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-slate-700 hover:bg-tranquil dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={async () => {
              try {
                const blob = await exportSponsorshipsCsv();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "rufaqaa-sponsorships.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error(t("common.loadError"));
              }
            }}
          >
            {t("sponsorships.exportCsv")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("sponsorships.addNew")}
          </button>
        </div>
      </div>

      {showForm && (
        <NewSponsorshipForm
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: SP_QUERY });
            setShowForm(false);
            toast.success(t("sponsorships.created"));
          }}
        />
      )}

      {isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
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
                <th className="px-4 py-3 font-medium">{t("sponsorships.code")}</th>
                <th className="px-4 py-3 font-medium">{t("sponsorships.donor")}</th>
                <th className="px-4 py-3 font-medium">{t("sponsorships.orphan")}</th>
                <th className="px-4 py-3 font-medium">
                  {t("sponsorships.monthlyAmount")}
                </th>
                <th className="px-4 py-3 font-medium">
                  {t("sponsorships.nextPayment")}
                </th>
                <th className="px-4 py-3 font-medium">{t("sponsorships.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((s) => (
                <tr key={s.id} className="hover:bg-snow">
                  <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                  <td className="px-4 py-3">
                    <div>{s.donor_name ?? s.donor_id.slice(0, 8)}</div>
                    {s.donor_code && (
                      <div className="font-mono text-xs text-slate-500">
                        {s.donor_code}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>{s.orphan_name ?? s.orphan_id.slice(0, 8)}</div>
                    {s.orphan_code && (
                      <div className="font-mono text-xs text-slate-500">
                        {s.orphan_code}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {s.monthly_amount} {s.currency}{" "}
                    <span className="text-xs text-slate-500">
                      ({t(`sponsorships.frequencies.${s.payment_frequency}`, s.payment_frequency)})
                    </span>
                  </td>
                  <td className="px-4 py-3">{s.next_payment_date ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t(`sponsorships.statuses.${s.status}`, s.status)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    <span className="flex justify-end gap-2">
                      {s.status === "active" && (
                        <button
                          type="button"
                          className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil"
                          onClick={() => pauseMut.mutate(s.id)}
                          disabled={pauseMut.isPending}
                        >
                          {t("sponsorships.pause")}
                        </button>
                      )}
                      {s.status === "paused" && (
                        <button
                          type="button"
                          className="rounded-lg border border-trust bg-trust px-2 py-1 text-xs text-white hover:bg-trust/90"
                          onClick={() => resumeMut.mutate(s.id)}
                          disabled={resumeMut.isPending}
                        >
                          {t("sponsorships.resume")}
                        </button>
                      )}
                      {ACTIVE.has(s.status) && (
                        <button
                          type="button"
                          className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil"
                          onClick={() => cancelMut.mutate(s.id)}
                          disabled={cancelMut.isPending}
                        >
                          {t("sponsorships.cancel")}
                        </button>
                      )}
                    </span>
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

function NewSponsorshipForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const { data: donorsPage } = useQuery({
    queryKey: ["donors", { limit: 100, offset: 0 }],
    queryFn: () => listDonors({ limit: 100 }),
  });
  const { data: orphansPage } = useQuery({
    queryKey: ["orphans", { limit: 100, offset: 0 }],
    queryFn: () => listOrphans({ limit: 100 }),
  });

  const [form, setForm] = useState<SponsorshipCreateInput>({
    donor_id: "",
    orphan_id: "",
    monthly_amount: "25.00",
    currency: "KWD",
    start_date: new Date().toISOString().slice(0, 10),
    payment_frequency: "monthly",
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => createSponsorship(form),
    onSuccess: () => onCreated(),
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
        if (!form.donor_id || !form.orphan_id) return;
        mut.mutate();
      }}
      className="card space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("sponsorships.donor")}>
          <select
            className="input"
            value={form.donor_id}
            onChange={(e) => setForm({ ...form, donor_id: e.target.value })}
          >
            <option value="">{t("sponsorships.selectDonor")}</option>
            {donorsPage?.items.map((d: Donor) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("sponsorships.orphan")}>
          <select
            className="input"
            value={form.orphan_id}
            onChange={(e) => setForm({ ...form, orphan_id: e.target.value })}
          >
            <option value="">{t("sponsorships.selectOrphan")}</option>
            {orphansPage?.items.map((o: Orphan) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.first_name} {o.family_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("sponsorships.monthlyAmount")}>
          <input
            className="input"
            inputMode="decimal"
            value={form.monthly_amount}
            onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
          />
        </Field>
        <Field label={t("donors.currency")}>
          <input
            className="input"
            maxLength={3}
            value={form.currency}
            onChange={(e) =>
              setForm({ ...form, currency: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label={t("sponsorships.start")}>
          <input
            type="date"
            className="input"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
        </Field>
        <Field label={t("sponsorships.frequency")}>
          <select
            className="input"
            value={form.payment_frequency ?? "monthly"}
            onChange={(e) => setForm({ ...form, payment_frequency: e.target.value })}
          >
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`sponsorships.frequencies.${f}`, f)}
              </option>
            ))}
          </select>
        </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
