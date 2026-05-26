import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRole } from "@/hooks/useRole";
import {
  fetchOrganization,
  updateOrganization,
  type OrganizationUpdateInput,
} from "@/lib/organization";
import { toast } from "@/store/toasts";

export function OrganizationSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin } = useRole();

  const { data, isLoading } = useQuery({
    queryKey: ["organization"],
    queryFn: fetchOrganization,
  });

  const [form, setForm] = useState<OrganizationUpdateInput>({});

  // Reset the local form whenever the server payload changes.
  useEffect(() => {
    if (data) {
      setForm({
        name_ar: data.name_ar,
        name_en: data.name_en,
        country_code: data.country_code,
        timezone: data.timezone,
        default_language: data.default_language,
        default_currency: data.default_currency,
        primary_color: data.primary_color,
      });
    }
  }, [data]);

  const mut = useMutation({
    mutationFn: (payload: OrganizationUpdateInput) => updateOrganization(payload),
    onSuccess: (next) => {
      qc.setQueryData(["organization"], next);
      toast.success(t("settings.organizationSaved"));
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        const detail = err.response?.data?.detail;
        toast.error(typeof detail === "string" ? detail : t("common.createError"));
      } else {
        toast.error(t("common.createError"));
      }
    },
  });

  if (isLoading || !data) {
    return (
      <div className="card max-w-2xl">
        <h2 className="text-lg font-semibold">{t("settings.organization")}</h2>
        <p className="text-slate-500">{t("common.loading")}</p>
      </div>
    );
  }

  const disabled = !isAdmin;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mut.mutate(form);
      }}
      className="card max-w-2xl space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("settings.organization")}</h2>
        <span className="font-mono text-xs text-slate-500">{data.code}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("partners.nameAr")}>
          <input
            className="input"
            value={form.name_ar ?? ""}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
          />
        </Field>
        <Field label={t("partners.nameEn")}>
          <input
            className="input"
            value={form.name_en ?? ""}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, name_en: e.target.value })}
          />
        </Field>
        <Field label={t("partners.country")}>
          <input
            className="input"
            maxLength={2}
            value={form.country_code ?? ""}
            disabled={disabled}
            onChange={(e) =>
              setForm({ ...form, country_code: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label={t("settings.timezone")}>
          <input
            className="input"
            value={form.timezone ?? ""}
            disabled={disabled}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
        </Field>
        <Field label={t("settings.language")}>
          <select
            className="input"
            value={form.default_language ?? "ar"}
            disabled={disabled}
            onChange={(e) =>
              setForm({ ...form, default_language: e.target.value })
            }
          >
            <option value="ar">ar</option>
            <option value="en">en</option>
          </select>
        </Field>
        <Field label={t("donors.currency")}>
          <input
            className="input"
            maxLength={3}
            value={form.default_currency ?? ""}
            disabled={disabled}
            onChange={(e) =>
              setForm({ ...form, default_currency: e.target.value.toUpperCase() })
            }
          />
        </Field>
        <Field label={t("settings.primaryColor")}>
          <div className="flex items-center gap-2">
            <input
              type="color"
              className="h-10 w-12 cursor-pointer rounded border border-sky bg-white p-1 disabled:cursor-not-allowed"
              value={form.primary_color ?? "#769FCD"}
              disabled={disabled}
              onChange={(e) =>
                setForm({ ...form, primary_color: e.target.value })
              }
            />
            <input
              className="input flex-1 font-mono"
              maxLength={7}
              value={form.primary_color ?? ""}
              disabled={disabled}
              onChange={(e) =>
                setForm({ ...form, primary_color: e.target.value })
              }
            />
          </div>
        </Field>
      </div>

      {isAdmin ? (
        <button type="submit" className="btn-primary" disabled={mut.isPending}>
          {mut.isPending ? t("common.saving") : t("common.save")}
        </button>
      ) : (
        <p className="text-xs text-slate-500">{t("settings.adminOnly")}</p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  );
}
