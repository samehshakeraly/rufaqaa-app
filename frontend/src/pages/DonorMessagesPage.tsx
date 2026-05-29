import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Skeleton } from "@/components/Skeleton";
import type { MessageRead } from "@/lib/messages";
import { listMessages, markMessageRead } from "@/lib/messages";
import { toast } from "@/store/toasts";

const MESSAGES_KEY = ["donor", "me", "messages"];

/** D-09 — donor's message list.
 *
 * Read-only this phase (mirrors the guardian portal): the donor sees
 * every message they sent (any moderation status, so they know what's
 * "under review" or "rejected") plus every approved message addressed
 * to them. Composing a new message is deferred until the backend can
 * auto-resolve a recipient from related_orphan_id — see PR description.
 *
 * The projection never carries email/phone/last-name; the counter-party
 * is identified only by role + first name. */
export function DonorMessagesPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: MESSAGES_KEY,
    queryFn: () => listMessages({ limit: 50 }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markMessageRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MESSAGES_KEY });
    },
    onError: () => {
      toast.error(t("common.loadError"));
    },
  });

  const messages = q.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("donor.messages.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("donor.messages.subtitle")}
        </p>
      </header>

      {q.isLoading && <Skeleton className="h-40 w-full" />}

      {q.error && (
        <p
          role="alert"
          className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
        >
          {t("common.loadError")}
        </p>
      )}

      {q.data && messages.length === 0 && (
        <div className="card text-center text-gray-500 dark:text-gray-400">
          <p>{t("donor.messages.empty")}</p>
          <Link to="/donor/orphans" className="btn-primary mt-3 inline-block">
            {t("donor.messages.cta")}
          </Link>
        </div>
      )}

      {messages.length > 0 && (
        <ul className="space-y-3">
          {messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              lang={i18n.language}
              onMarkRead={() => markRead.mutate(m.id)}
              marking={markRead.isPending && markRead.variables === m.id}
            />
          ))}
        </ul>
      )}

      <p className="text-center text-xs text-gray-400">
        {t("donor.messages.composeNote")}
      </p>
    </div>
  );
}

function MessageItem({
  message: m,
  lang,
  onMarkRead,
  marking,
}: {
  message: MessageRead;
  lang: string;
  onMarkRead: () => void;
  marking: boolean;
}) {
  const { t } = useTranslation();

  // A card represents one message; we label its sender. Outgoing
  // messages show "you"; incoming ones show the sender's first name.
  const senderName = m.is_mine ? t("donor.messages.you") : m.from_name;
  const canMarkRead =
    !m.is_mine && m.moderation_status === "approved" && !m.is_read;

  return (
    <li
      className={`card space-y-2 ${
        m.is_mine ? "border-s-4 border-s-trust-300" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {senderName}
          <span className="ms-2 text-xs font-normal text-gray-500">
            {t(`donor.messages.roles.${m.from_role}`, { defaultValue: m.from_role })}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {m.moderation_status === "pending" && (
            <StatusChip tone="warning">
              {t("donor.messages.statusPending")}
            </StatusChip>
          )}
          {m.moderation_status === "rejected" && (
            <StatusChip tone="danger">
              {t("donor.messages.statusRejected")}
            </StatusChip>
          )}
          <time className="text-xs text-gray-500" dateTime={m.created_at}>
            {new Date(m.created_at).toLocaleDateString(lang)}
          </time>
        </div>
      </div>

      {m.orphan_code && (
        <p className="text-xs text-gray-500">
          {t("donor.messages.about")}{" "}
          <span className="font-mono">{m.orphan_code}</span>
        </p>
      )}

      {m.content && (
        <p className="whitespace-pre-line text-sm text-gray-800 dark:text-gray-200">
          {m.content}
        </p>
      )}

      {m.is_mine && m.moderation_status === "pending" && (
        <p className="text-xs text-warning-700 dark:text-warning-100">
          {t("donor.messages.pendingNote")}
        </p>
      )}
      {m.is_mine && m.moderation_status === "rejected" && (
        <p className="text-xs text-danger-700 dark:text-danger-100">
          {t("donor.messages.rejectedNote")}
          {m.moderation_notes ? ` — ${m.moderation_notes}` : ""}
        </p>
      )}

      {canMarkRead && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onMarkRead}
            disabled={marking}
            className="rounded-lg border border-sky-200 px-3 py-1 text-xs text-gray-700 transition hover:bg-tranquil-200 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {t("donor.messages.markRead")}
          </button>
        </div>
      )}
    </li>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "warning" | "danger";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warning"
      ? "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-100"
      : "bg-danger-100 text-danger-700 dark:bg-danger-500/15 dark:text-danger-100";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}
