import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import {
  archiveMarketingChannel,
  type ChannelType,
  createMarketingChannel,
  listMarketingChannels,
  type MarketingChannelCreateInput,
} from "@/lib/marketingChannels";

const QK = ["marketing-channels", { includeInactive: true }] as const;

const CHANNEL_TYPES: ChannelType[] = [
  "digital_marketing",
  "committee",
  "website",
  "branch",
  "social_media",
  "partnership",
  "other",
];

export function MarketingChannelsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin } = useRole();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listMarketingChannels(true),
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveMarketingChannel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          {t("marketingChannels.title")}
        </h1>
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
              {showForm ? t("common.cancel") : t("marketingChannels.addNew")}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <NewChannelForm
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: QK });
            setShowForm(false);
          }}
        />
      )}

      {isLoading && <TableSkeleton columns={4} />}
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
                <th className="px-4 py-3 font-medium">{t("marketingChannels.name")}</th>
                <th className="px-4 py-3 font-medium">{t("marketingChannels.type")}</th>
                <th className="px-4 py-3 font-medium">{t("marketingChannels.status")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sky/40 text-sm">
              {data.items.map((c) => (
                <tr key={c.id} className="hover:bg-snow">
                  <td className="px-4 py-3">
                    <Link
                      to={`/admin/marketing/channels/${c.id}`}
                      className="text-trust underline"
                    >
                      {i18n.language === "ar" ? c.name_ar : c.name_en ?? c.name_ar}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {c.channel_type
                      ? t(`marketingChannels.types.${c.channel_type}`, c.channel_type)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {t(`marketingChannels.statuses.${c.status}`, c.status)}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {isAdmin && c.status === "active" && (
                      <button
                        type="button"
                        className="rounded-lg border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil"
                        onClick={() => archive.mutate(c.id)}
                        disabled={archive.isPending}
                      >
                        {t("marketingChannels.archive")}
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

function NewChannelForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [v, setV] = useState<MarketingChannelCreateInput>({
    name_ar: "",
    name_en: "",
    channel_type: "digital_marketing",
    description: "",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createMarketingChannel(v),
    onSuccess: () => {
      setV({
        name_ar: "",
        name_en: "",
        channel_type: "digital_marketing",
        description: "",
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
        if (!v.name_ar.trim()) return;
        mut.mutate();
      }}
      className="card space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("marketingChannels.nameAr")}
          </span>
          <input
            className="input"
            value={v.name_ar}
            onChange={(e) => setV({ ...v, name_ar: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("marketingChannels.nameEn")}
          </span>
          <input
            className="input"
            value={v.name_en ?? ""}
            onChange={(e) => setV({ ...v, name_en: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">
            {t("marketingChannels.type")}
          </span>
          <select
            className="input"
            value={v.channel_type ?? "other"}
            onChange={(e) =>
              setV({ ...v, channel_type: e.target.value as ChannelType })
            }
          >
            {CHANNEL_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`marketingChannels.types.${c}`, c)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {t("marketingChannels.description")}
        </span>
        <textarea
          className="input min-h-[80px]"
          value={v.description ?? ""}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
      </label>
      {serverError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}
      <button type="submit" className="btn-primary" disabled={mut.isPending}>
        {mut.isPending ? t("common.saving") : t("common.save")}
      </button>
    </form>
  );
}
