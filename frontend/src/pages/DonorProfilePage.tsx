import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getDonorMe, patchDonorMe } from "@/lib/donorAuth";
import { toast } from "@/store/toasts";

export function DonorProfilePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["donor", "me"], queryFn: getDonorMe });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");

  useEffect(() => {
    if (q.data) {
      setFullName(q.data.full_name);
      setPhone(q.data.phone ?? "");
      setCountry(q.data.country_of_residence ?? "");
      setCurrency(q.data.preferred_currency ?? "");
    }
  }, [q.data]);

  const mut = useMutation({
    mutationFn: () =>
      patchDonorMe({
        full_name: fullName,
        phone: phone || undefined,
        country_of_residence: country || undefined,
        preferred_currency: currency || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["donor", "me"] });
      toast.success(t("donor.profile.saved"));
    },
  });

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">
        {t("donor.profile.title")}
      </h1>

      <form
        className="card space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
      >
        <Field label={t("signup.fullName")}>
          <input
            className="input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </Field>
        <Field label={t("auth.email")}>
          <input className="input" value={q.data?.email ?? ""} disabled />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("signup.phone")}>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label={t("signup.country")}>
            <input
              className="input"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t("signup.currency")}>
            <input
              className="input"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <button type="submit" className="btn-primary" disabled={mut.isPending}>
          {mut.isPending ? t("common.saving") : t("common.save")}
        </button>
      </form>
    </div>
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
