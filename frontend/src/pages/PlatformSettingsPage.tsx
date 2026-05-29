import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  fetchPlatformSettings,
  updatePlatformSettings,
} from "@/lib/platform";
import { toast } from "@/store/toasts";

/**
 * Known platform flags rendered even when the backend settings JSONB is
 * empty (the migration seeds `{}`), so the page is usable from a fresh
 * install. Any additional keys the backend returns are rendered too, with
 * their input type inferred from the value. Values from the backend always
 * win over these defaults.
 */
const KNOWN_FLAGS: Record<string, boolean | string | number> = {
  maintenance_mode: false,
  signups_open: true,
  default_subscription_plan: "free",
};

type Primitive = boolean | string | number;

function isPrimitive(v: unknown): v is Primitive {
  return (
    typeof v === "boolean" || typeof v === "string" || typeof v === "number"
  );
}

export function PlatformSettingsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform", "settings"],
    queryFn: fetchPlatformSettings,
  });

  // Editable form state of primitive settings, seeded from known flags +
  // whatever the backend returns. Non-primitive keys (objects/arrays) are
  // shown read-only and not editable here.
  const [form, setForm] = useState<Record<string, Primitive>>({});

  const readOnlyKeys = useMemo(() => {
    if (!data) return [] as [string, unknown][];
    return Object.entries(data.settings).filter(([, v]) => !isPrimitive(v));
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const merged: Record<string, Primitive> = { ...KNOWN_FLAGS };
    for (const [k, v] of Object.entries(data.settings)) {
      if (isPrimitive(v)) merged[k] = v;
    }
    setForm(merged);
  }, [data]);

  const save = useMutation({
    mutationFn: () => updatePlatformSettings(form),
    onSuccess: async () => {
      toast.success(t("platform.settings.saved"));
      await qc.invalidateQueries({ queryKey: ["platform", "settings"] });
    },
    onError: (err) => {
      const msg =
        err instanceof AxiosError && typeof err.response?.data?.detail === "string"
          ? err.response.data.detail
          : t("common.createError");
      toast.error(msg);
    },
  });

  function setKey(key: string, value: Primitive) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function labelFor(key: string): string {
    return t(`platform.settings.keys.${key}`, key.replace(/_/g, " "));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {t("platform.settings.title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("platform.settings.subtitle")}
          </p>
        </div>
        {data?.updated_at && (
          <span className="text-xs text-slate-500">
            {t("platform.settings.updatedAt", {
              date: new Date(data.updated_at).toLocaleString(i18n.language),
            })}
          </span>
        )}
      </div>

      {isLoading && <Skeleton className="h-48 w-full" />}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}

      {data && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="card space-y-5">
            <h2 className="text-lg font-semibold">{t("platform.settings.general")}</h2>
            {Object.keys(form).length === 0 && (
              <p className="text-sm text-slate-500">{t("common.empty")}</p>
            )}
            {Object.entries(form).map(([key, value]) => (
              <SettingRow
                key={key}
                label={labelFor(key)}
                value={value}
                onChange={(v) => setKey(key, v)}
              />
            ))}
          </div>

          {readOnlyKeys.length > 0 && (
            <div className="card space-y-3">
              <h2 className="text-lg font-semibold">
                {t("platform.settings.advanced")}
              </h2>
              <p className="text-sm text-slate-500">
                {t("platform.settings.advancedHint")}
              </p>
              {readOnlyKeys.map(([key, value]) => (
                <div key={key}>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {labelFor(key)}
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-snow px-3 py-2 text-xs text-slate-600 dark:bg-gray-900 dark:text-slate-300">
                    {JSON.stringify(value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending ? t("common.saving") : t("platform.settings.saveAll")}
            </button>
          </div>
        </form>
      )}

      {/* Danger zone — destructive operations. No backend endpoints are
          exposed yet, so each action surfaces a "coming soon" notice
          rather than firing anything. Styling makes the risk explicit. */}
      <div className="rounded-2xl border-2 border-danger-500 bg-danger-50 p-6 dark:border-danger-700 dark:bg-danger-700/10">
        <h2 className="text-lg font-semibold text-danger-700 dark:text-danger-100">
          {t("platform.settings.dangerZone")}
        </h2>
        <p className="mt-1 text-sm text-danger-700/80 dark:text-danger-100/80">
          {t("platform.settings.dangerHint")}
        </p>
        <ul className="mt-4 space-y-3">
          {(["backup", "reindex", "restart"] as const).map((op) => (
            <li
              key={op}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger-100 bg-white px-4 py-3 dark:border-danger-700 dark:bg-gray-800"
            >
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {t(`platform.settings.danger.${op}.title`)}
                </p>
                <p className="text-xs text-slate-500">
                  {t(`platform.settings.danger.${op}.body`)}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg border border-danger-500 px-3 py-1 text-sm font-medium text-danger-700 hover:bg-danger-100 dark:text-danger-100"
                onClick={() => toast.info(t("common.comingSoon"))}
              >
                {t(`platform.settings.danger.${op}.action`)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Primitive;
  onChange: (v: Primitive) => void;
}) {
  if (typeof value === "boolean") {
    return (
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        <Toggle checked={value} onChange={onChange} label={label} />
      </div>
    );
  }
  if (typeof value === "number") {
    return (
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        <input
          type="number"
          className="input max-w-xs tabular-nums"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </label>
    );
  }
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
      </span>
      <input
        type="text"
        className="input max-w-md"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-trust-500 ${
        checked ? "bg-trust-500" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
          checked ? "translate-x-6 rtl:-translate-x-6" : "translate-x-1 rtl:-translate-x-1"
        }`}
      />
    </button>
  );
}
