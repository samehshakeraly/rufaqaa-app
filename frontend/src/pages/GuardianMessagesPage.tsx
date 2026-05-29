import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import { listMessages, type MessageRead } from "@/lib/messages";

export function GuardianMessagesPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["messages"],
    queryFn: () => listMessages(),
  });

  const items = q.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {t("guardian.messages.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t("guardian.messages.reviewedNote")}
        </p>
      </div>

      {/* Compose is deferred this phase (no privacy-safe recipient handle
          is exposed to guardians yet). */}
      <div
        className="rounded-xl border border-info-100 bg-info-50 px-4 py-3 text-sm text-info-700"
        role="note"
      >
        {t("guardian.messages.composeComingSoon")}
      </div>

      {q.isLoading && <Skeleton className="h-40 w-full" />}

      {!q.isLoading && items.length === 0 && (
        <div className="card text-center text-slate-500 dark:text-slate-400">
          {t("guardian.messages.empty")}
        </div>
      )}

      {items.length > 0 && (
        <ul className="space-y-3">
          {items.map((m) => (
            <MessageCard key={m.id} message={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageCard({ message: m }: { message: MessageRead }) {
  const { t, i18n } = useTranslation();

  const senderName = m.is_mine ? t("guardian.messages.you") : m.from_name;
  const senderRole = t(`guardian.roles.${m.from_role}`, {
    defaultValue: m.from_role,
  });
  const created = formatDate(m.created_at, i18n.language);

  const pendingMine = m.is_mine && m.moderation_status === "pending";
  const rejectedMine = m.is_mine && m.moderation_status === "rejected";

  return (
    <li className="card space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {senderName}
          </span>
          <span className="text-xs text-slate-500">{senderRole}</span>
        </div>
        <span className="text-xs text-slate-500 tabular-nums">{created}</span>
      </div>

      {m.orphan_code && (
        <p className="font-mono text-xs text-slate-500 tabular-nums">
          {t("guardian.messages.aboutOrphan", { code: m.orphan_code })}
        </p>
      )}

      {m.content && (
        <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
          {m.content}
        </p>
      )}

      {pendingMine && (
        <span className="inline-flex items-center rounded-full bg-warning-100 px-2.5 py-0.5 text-xs font-medium text-warning-700">
          {t("guardian.messages.pendingMine")}
        </span>
      )}

      {rejectedMine && (
        <div className="rounded-lg bg-danger-50 p-2 text-sm text-danger-700">
          <p className="font-medium">{t("guardian.messages.rejectedMine")}</p>
          {m.moderation_notes && (
            <p className="mt-0.5">
              <span className="font-medium">
                {t("guardian.messages.moderationNotes")}:
              </span>{" "}
              {m.moderation_notes}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(lang === "ar" ? "ar" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
