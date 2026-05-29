import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  listOrphanMessages,
  type OrphanMessage,
  sendOrphanMessage,
} from "@/lib/orphanSelf";
import { toast } from "@/store/toasts";

const MESSAGES_KEY = ["orphan", "me", "messages"];
const MAX_LEN = 4000;

/** O-03 — compose a thank-you note to your sponsor + see the thread.
 *
 * Messages are reviewed before they reach the sponsor; we say so warmly
 * ("on its way") and never use the word "moderation". Senders are shown
 * by first name only (backend projection). */
export function OrphanMessagesPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");

  const q = useQuery({
    queryKey: MESSAGES_KEY,
    queryFn: () => listOrphanMessages(50),
  });

  const send = useMutation({
    mutationFn: (text: string) => sendOrphanMessage(text),
    onSuccess: () => {
      setContent("");
      toast.success(t("orphan.messages.sent"));
      queryClient.invalidateQueries({ queryKey: MESSAGES_KEY });
    },
    onError: () => {
      toast.error(t("orphan.messages.sendError"));
    },
  });

  const messages = q.data ?? [];
  const trimmed = content.trim();
  const canSend = trimmed.length > 0 && !send.isPending;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t("orphan.messages.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {t("orphan.messages.subtitle")}
        </p>
      </header>

      {/* Compose */}
      <section className="card space-y-3" aria-labelledby="orphan-compose-title">
        <h2
          id="orphan-compose-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("orphan.messages.composeTitle")}
        </h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) send.mutate(trimmed);
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="sr-only">{t("orphan.messages.composeTitle")}</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_LEN))}
              rows={6}
              maxLength={MAX_LEN}
              placeholder={t("orphan.messages.placeholder")}
              className="input min-h-40 resize-y leading-relaxed"
            />
          </label>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {content.length}/{MAX_LEN}
            </span>
            <button type="submit" className="btn-primary" disabled={!canSend}>
              {send.isPending
                ? t("orphan.messages.sending")
                : t("orphan.messages.send")}
            </button>
          </div>
        </form>
      </section>

      {/* Thread */}
      <section className="space-y-3" aria-labelledby="orphan-thread-title">
        <h2
          id="orphan-thread-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {t("orphan.messages.threadTitle")}
        </h2>

        {q.isLoading && <Skeleton className="h-32 w-full" />}

        {q.error && (
          <p
            role="alert"
            className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/10 dark:text-danger-100"
          >
            {t("common.loadError")}
          </p>
        )}

        {q.data && messages.length === 0 && (
          <div className="card flex flex-col items-center gap-3 text-center">
            <span aria-hidden="true" className="text-4xl">
              ✉️
            </span>
            <p className="text-gray-600 dark:text-gray-300">
              {t("orphan.messages.empty")}
            </p>
          </div>
        )}

        {messages.length > 0 && (
          <ul className="space-y-3">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} lang={i18n.language} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MessageItem({
  message: m,
  lang,
}: {
  message: OrphanMessage;
  lang: string;
}) {
  const { t } = useTranslation();
  const senderName = m.is_mine ? t("orphan.messages.you") : m.from_name;
  const isPending = m.is_mine && m.moderation_status === "pending";

  return (
    <li
      className={`card space-y-2 ${
        m.is_mine ? "border-s-4 border-s-trust-300" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {senderName}
        </p>
        <div className="flex items-center gap-2">
          {isPending && (
            <span className="rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-700 dark:bg-warning-500/15 dark:text-warning-100">
              {t("orphan.messages.onTheWay")}
            </span>
          )}
          {m.created_at && (
            <time className="text-xs text-gray-500" dateTime={m.created_at}>
              {new Date(m.created_at).toLocaleDateString(lang)}
            </time>
          )}
        </div>
      </div>
      {m.content && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800 dark:text-gray-200">
          {m.content}
        </p>
      )}
    </li>
  );
}
