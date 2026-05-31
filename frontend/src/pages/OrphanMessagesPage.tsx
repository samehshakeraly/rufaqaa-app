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

import "./OrphanMessagesPage.css";

const MESSAGES_KEY = ["orphan", "me", "messages"];
const MAX_LEN = 4000;

/** O-03 — compose a thank-you note to your sponsor + see the thread.
 *
 * Messages go through the EXISTING moderation flow only — there is no
 * direct/un-moderated channel to the donor. We say so warmly ("on its
 * way") and the do/don't tips steer the child away from sharing personal
 * data. Senders are shown by first name only (backend projection). */
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
  const counterWarn = content.length > MAX_LEN * 0.9;

  const suggestions = [
    t("orphan.messages.suggestion1"),
    t("orphan.messages.suggestion2"),
    t("orphan.messages.suggestion3"),
    t("orphan.messages.suggestion4"),
  ];
  const doItems = [
    t("orphan.messages.doItem1"),
    t("orphan.messages.doItem2"),
    t("orphan.messages.doItem3"),
    t("orphan.messages.doItem4"),
  ];
  const dontItems = [
    t("orphan.messages.dontItem1"),
    t("orphan.messages.dontItem2"),
    t("orphan.messages.dontItem3"),
    t("orphan.messages.dontItem4"),
  ];

  return (
    <div className="omsg-root">
      <div className="omsg-stack">
        {/* Intro */}
        <div className="omsg-intro">
          <span className="omsg-intro-emoji" aria-hidden="true">
            💌
          </span>
          <div className="omsg-intro-text">
            <h1>{t("orphan.messages.introTitle")}</h1>
            <p>{t("orphan.messages.introSub")}</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) send.mutate(trimmed);
          }}
          className="omsg-stack"
        >
          {/* Compose */}
          <section className="omsg-compose-card" aria-labelledby="omsg-compose-label">
            <label className="omsg-compose-label" id="omsg-compose-label" htmlFor="omsg-textarea">
              <span>{t("orphan.messages.composeLabel")}</span>
              <span className={`omsg-counter ${counterWarn ? "warn" : ""}`}>
                <span className="omsg-latin">{content.length}</span> /{" "}
                <span className="omsg-latin">{MAX_LEN}</span>
              </span>
            </label>
            <textarea
              id="omsg-textarea"
              className="omsg-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_LEN))}
              maxLength={MAX_LEN}
              rows={7}
              placeholder={t("orphan.messages.placeholder")}
            />
          </section>

          {/* Suggestions — clicking fills the box */}
          <section className="omsg-suggestions" aria-label={t("orphan.messages.suggestionsTitle")}>
            <div className="omsg-sug-head">
              <svg className="omsg-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {t("orphan.messages.suggestionsTitle")}
            </div>
            <div className="omsg-sug-list">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  className="omsg-sug-item"
                  onClick={() => setContent(s.slice(0, MAX_LEN))}
                >
                  <span className="omsg-sug-bullet" aria-hidden="true">
                    •
                  </span>
                  <span>{s}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Moderation note (existing flow — never a direct channel) */}
          <section className="omsg-warning" role="note">
            <span className="omsg-warning-icon" aria-hidden="true">
              <svg className="omsg-icon" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </span>
            <p className="omsg-warning-text">
              <strong>{t("orphan.messages.moderationTitle")}</strong>
              {t("orphan.messages.moderationBody")}
            </p>
          </section>

          {/* Do / Don't tips */}
          <section className="omsg-tips" aria-label={t("orphan.messages.tipDoTitle")}>
            <div className="omsg-tip do">
              <div className="omsg-tip-head">
                <span className="omsg-tip-head-icon" aria-hidden="true">
                  <svg className="omsg-icon omsg-icon-sm" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
                {t("orphan.messages.tipDoTitle")}
              </div>
              <ul className="omsg-tip-list">
                {doItems.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
            <div className="omsg-tip dont">
              <div className="omsg-tip-head">
                <span className="omsg-tip-head-icon" aria-hidden="true">
                  <svg className="omsg-icon omsg-icon-sm" viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </span>
                {t("orphan.messages.tipDontTitle")}
              </div>
              <ul className="omsg-tip-list">
                {dontItems.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          </section>

          {/* Actions */}
          <div className="omsg-actions">
            <button type="submit" className="omsg-btn" disabled={!canSend}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              {send.isPending ? t("orphan.messages.sending") : t("orphan.messages.send")}
            </button>
            <button
              type="button"
              className="omsg-btn-secondary"
              onClick={() => setContent("")}
              disabled={content.length === 0 || send.isPending}
            >
              {t("orphan.messages.clear")}
            </button>
          </div>
        </form>

        {/* Thread */}
        <section aria-labelledby="omsg-thread-title">
          <h2 className="omsg-thread-title" id="omsg-thread-title">
            {t("orphan.messages.threadTitle")}
          </h2>

          {q.isLoading && <Skeleton className="h-32 w-full" />}
          {q.error && (
            <p className="omsg-error" role="alert">
              {t("common.loadError")}
            </p>
          )}
          {q.data && messages.length === 0 && (
            <div className="omsg-empty">
              <span className="omsg-empty-emoji" aria-hidden="true">
                ✉️
              </span>
              <p>{t("orphan.messages.empty")}</p>
            </div>
          )}
          {messages.length > 0 && (
            <ul className="omsg-thread-list">
              {messages.map((m) => (
                <MessageItem key={m.id} message={m} lang={i18n.language} />
              ))}
            </ul>
          )}
        </section>
      </div>
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
    <li className={`omsg-msg ${m.is_mine ? "mine" : ""}`}>
      <div className="omsg-msg-head">
        <span className="omsg-msg-sender">{senderName}</span>
        <span className="omsg-msg-side">
          {isPending && <span className="omsg-pending">{t("orphan.messages.onTheWay")}</span>}
          {m.created_at && (
            <time className="omsg-msg-time" dateTime={m.created_at}>
              {new Date(m.created_at).toLocaleDateString(lang)}
            </time>
          )}
        </span>
      </div>
      {m.content && <p className="omsg-msg-body">{m.content}</p>}
    </li>
  );
}
