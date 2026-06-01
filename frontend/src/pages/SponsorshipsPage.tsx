import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TableSkeleton } from "@/components/Skeleton";
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

import "./adminEntities.css";

const SP_QUERY = ["sponsorships", { limit: 50, offset: 0 }] as const;
const ACTIVE = new Set(["active", "paused", "overdue"]);
const FREQUENCIES = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
  "one_time",
] as const;

// Map a sponsorship status onto a shared status-pill variant.
const STATUS_VARIANT: Record<string, string> = {
  active: "success",
  paused: "warning",
  overdue: "danger",
  pending: "info",
  completed: "purple",
  cancelled: "",
  transferred: "",
};

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
    <div className="adm">
      <div className="adm-head">
        <h1>{t("sponsorships.title")}</h1>
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
            className="adm-btn adm-btn-primary"
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

      {isLoading && <TableSkeleton columns={7} />}
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
                  <th>{t("sponsorships.code")}</th>
                  <th>{t("sponsorships.donor")}</th>
                  <th>{t("sponsorships.orphan")}</th>
                  <th>{t("sponsorships.monthlyAmount")}</th>
                  <th>{t("sponsorships.nextPayment")}</th>
                  <th>{t("sponsorships.status")}</th>
                  <th className="end">{t("orphans.actionsCol")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="adm-cell-code">{s.code}</span>
                    </td>
                    <td>
                      <div className="adm-cell-strong">
                        {s.donor_name ?? s.donor_id.slice(0, 8)}
                      </div>
                      {s.donor_code && <div className="adm-cell-sub">{s.donor_code}</div>}
                    </td>
                    <td>
                      <div className="adm-cell-strong">
                        {s.orphan_name ?? s.orphan_id.slice(0, 8)}
                      </div>
                      {s.orphan_code && <div className="adm-cell-sub">{s.orphan_code}</div>}
                    </td>
                    <td>
                      <span className="latin">
                        {s.monthly_amount} {s.currency}
                      </span>{" "}
                      <span className="adm-cell-muted">
                        ({t(`sponsorships.frequencies.${s.payment_frequency}`, s.payment_frequency)})
                      </span>
                    </td>
                    <td className="latin">{s.next_payment_date ?? "—"}</td>
                    <td>
                      <span className={`adm-status ${STATUS_VARIANT[s.status] ?? ""}`}>
                        <span className="dot" aria-hidden="true" />
                        {t(`sponsorships.statuses.${s.status}`, s.status)}
                      </span>
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        {s.status === "active" && (
                          <button
                            type="button"
                            className="adm-row-btn"
                            onClick={() => pauseMut.mutate(s.id)}
                            disabled={pauseMut.isPending}
                          >
                            {t("sponsorships.pause")}
                          </button>
                        )}
                        {s.status === "paused" && (
                          <button
                            type="button"
                            className="adm-row-btn primary"
                            onClick={() => resumeMut.mutate(s.id)}
                            disabled={resumeMut.isPending}
                          >
                            {t("sponsorships.resume")}
                          </button>
                        )}
                        {ACTIVE.has(s.status) && (
                          <button
                            type="button"
                            className="adm-row-btn"
                            onClick={() => cancelMut.mutate(s.id)}
                            disabled={cancelMut.isPending}
                          >
                            {t("sponsorships.cancel")}
                          </button>
                        )}
                      </div>
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
      className="adm-card"
    >
      <div className="adm-form-grid">
        <Field label={t("sponsorships.donor")}>
          <select
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
            inputMode="decimal"
            value={form.monthly_amount}
            onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
          />
        </Field>
        <Field label={t("donors.currency")}>
          <input
            maxLength={3}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t("sponsorships.start")}>
          <input
            type="date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
        </Field>
        <Field label={t("sponsorships.frequency")}>
          <select
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

      {serverError && <p className="adm-error">{serverError}</p>}

      <div className="adm-form-foot">
        <button type="submit" className="adm-btn adm-btn-primary" disabled={mut.isPending}>
          {mut.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="adm-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
