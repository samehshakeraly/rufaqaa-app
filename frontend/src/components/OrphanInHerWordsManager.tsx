import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import { formatDate } from "@/lib/format";
import {
  getInHerWords,
  IN_HER_WORDS_MAX_ITEMS,
  IN_HER_WORDS_MAX_LEN,
  setInHerWords,
  type InHerWordsList,
} from "@/lib/inHerWords";

/** One phrase in the local working draft. `_key` is a stable client-only react
 * key (the server `id` is absent for not-yet-saved rows); `id` is carried back
 * to the server so an edit re-uses the same phrase identity. */
interface DraftPhrase {
  _key: string;
  id?: string;
  text: string;
  said_on: string | null;
}

const queryKey = (orphanId: string) => ["orphan", orphanId, "in-her-words"];

let _seq = 0;
function nextKey(): string {
  _seq += 1;
  return `ihw-${_seq}`;
}

function toDraft(list: InHerWordsList): DraftPhrase[] {
  return list.items.map((it) => ({
    _key: nextKey(),
    id: it.id,
    text: it.text,
    said_on: it.said_on ?? null,
  }));
}

/** Today's date as an ISO `yyyy-mm-dd` string, for the date input `max` and the
 * future-date guard (matches the backend's `said_on` rule). */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Supervisor/manager editor for the curated "In Her Words" (بكلماتها) phrases.
 *
 * Mirrors the backend replace-semantics: the whole ordered array is PUT on save
 * (the array order IS the donor display order). Client validation matches the
 * server — trimmed non-empty text ≤ {@link IN_HER_WORDS_MAX_LEN} chars, at most
 * {@link IN_HER_WORDS_MAX_ITEMS} phrases, no future `said_on` — so a save is
 * rejected before it reaches the API. Hiding the whole block is governed
 * separately by the profile-visibility panel. */
export function OrphanInHerWordsManager({ orphanId }: { orphanId: string }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: queryKey(orphanId),
    queryFn: () => getInHerWords(orphanId),
    enabled: Boolean(orphanId),
  });

  const [draft, setDraft] = useState<DraftPhrase[] | null>(null);
  const [feedback, setFeedback] = useState<"idle" | "saved" | "error">("idle");

  const serverDraft = useMemo(() => (listQ.data ? toDraft(listQ.data) : null), [listQ.data]);

  useEffect(() => {
    if (serverDraft) setDraft(serverDraft);
  }, [serverDraft]);

  // Add-form state.
  const [newText, setNewText] = useState("");
  const [newDate, setNewDate] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (items: DraftPhrase[]) =>
      setInHerWords(
        orphanId,
        items.map((it) => ({
          id: it.id,
          text: it.text,
          said_on: it.said_on,
        })),
      ),
    onSuccess: (list) => {
      qc.setQueryData(queryKey(orphanId), list);
      setDraft(toDraft(list));
      setFeedback("saved");
    },
    onError: () => setFeedback("error"),
  });

  if (listQ.isLoading || !draft) {
    return (
      <div className="space-y-3" role="status" aria-label={t("common.loading")}>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (listQ.isError) {
    return (
      <div
        className="rounded-xl border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-600/20 dark:text-danger-100"
        role="alert"
      >
        {t("inHerWords.loadError")}
      </div>
    );
  }

  const dirty =
    !serverDraft ||
    serverDraft.length !== draft.length ||
    draft.some((d, i) => {
      const s = serverDraft[i];
      return !s || s.id !== d.id || s.text !== d.text || s.said_on !== d.said_on;
    });

  function addPhrase() {
    setAddError(null);
    setFeedback("idle");
    const text = newText.trim();
    if (!text) {
      setAddError(t("inHerWords.errors.empty"));
      return;
    }
    if (text.length > IN_HER_WORDS_MAX_LEN) {
      setAddError(t("inHerWords.errors.tooLong", { max: IN_HER_WORDS_MAX_LEN }));
      return;
    }
    if (draft && draft.length >= IN_HER_WORDS_MAX_ITEMS) {
      setAddError(t("inHerWords.errors.tooMany", { max: IN_HER_WORDS_MAX_ITEMS }));
      return;
    }
    if (newDate && newDate > todayISO()) {
      setAddError(t("inHerWords.errors.future"));
      return;
    }
    setDraft((d) => [
      ...(d ?? []),
      { _key: nextKey(), text, said_on: newDate || null },
    ]);
    setNewText("");
    setNewDate("");
  }

  function updatePhrase(key: string, patch: Partial<DraftPhrase>) {
    setFeedback("idle");
    setDraft((d) => (d ? d.map((it) => (it._key === key ? { ...it, ...patch } : it)) : d));
  }

  function removePhrase(key: string) {
    setFeedback("idle");
    setDraft((d) => (d ? d.filter((it) => it._key !== key) : d));
  }

  // A save is allowed only when every row is individually valid.
  const invalid = draft.some(
    (d) => !d.text.trim() || d.text.trim().length > IN_HER_WORDS_MAX_LEN || (d.said_on ? d.said_on > todayISO() : false),
  );

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("inHerWords.intro")}</p>

      {/* Add form. */}
      <form
        className="space-y-3 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40"
        aria-labelledby="ihw-add-title"
        onSubmit={(e) => {
          e.preventDefault();
          addPhrase();
        }}
      >
        <h3 id="ihw-add-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("inHerWords.add.title")}
        </h3>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("inHerWords.add.phrase")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            maxLength={IN_HER_WORDS_MAX_LEN}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            aria-label={t("inHerWords.add.phrase")}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("inHerWords.charCount", { n: newText.trim().length, max: IN_HER_WORDS_MAX_LEN })}
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("inHerWords.add.date")}
          </span>
          <input
            type="date"
            className="input w-full"
            max={todayISO()}
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            aria-label={t("inHerWords.add.date")}
          />
        </label>
        {addError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {addError}
          </p>
        )}
        <button
          type="submit"
          className="btn-secondary"
          disabled={draft.length >= IN_HER_WORDS_MAX_ITEMS}
        >
          {t("inHerWords.add.submit")}
        </button>
      </form>

      {/* Existing phrases. */}
      {draft.length === 0 ? (
        <div
          className="rounded-xl border border-sky-200 bg-snow-100 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400"
          role="status"
        >
          {t("inHerWords.empty")}
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t("inHerWords.listLabel")}>
          {draft.map((phrase) => (
            <PhraseRow
              key={phrase._key}
              phrase={phrase}
              lang={i18n.language}
              onChange={(patch) => updatePhrase(phrase._key, patch)}
              onRemove={() => removePhrase(phrase._key)}
            />
          ))}
        </ul>
      )}

      {/* Save. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || invalid || save.isPending}
          onClick={() => {
            setFeedback("idle");
            if (draft) save.mutate(draft);
          }}
        >
          {save.isPending ? t("inHerWords.saving") : t("inHerWords.save")}
        </button>
        {feedback === "saved" && !dirty && (
          <span className="text-sm font-medium text-success-700" role="status">
            {t("inHerWords.saved")}
          </span>
        )}
        {feedback === "error" && (
          <span className="text-sm font-medium text-danger-700" role="alert">
            {t("inHerWords.saveError")}
          </span>
        )}
      </div>
    </div>
  );
}

/** One editable phrase row: an inline textarea + optional date, with a delete
 * action. Editing mutates the parent draft directly (saved together on PUT). */
function PhraseRow({
  phrase,
  lang,
  onChange,
  onRemove,
}: {
  phrase: DraftPhrase;
  lang: string;
  onChange: (patch: Partial<DraftPhrase>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li className="space-y-3 rounded-xl border border-sky-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-800/40">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("inHerWords.add.phrase")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            maxLength={IN_HER_WORDS_MAX_LEN}
            value={phrase.text}
            onChange={(e) => onChange({ text: e.target.value })}
            aria-label={t("inHerWords.edit.phrase")}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("inHerWords.add.date")}
          </span>
          <input
            type="date"
            className="input w-full"
            max={todayISO()}
            value={phrase.said_on ?? ""}
            onChange={(e) => onChange({ said_on: e.target.value || null })}
            aria-label={t("inHerWords.edit.date")}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
          {t("inHerWords.edit.done")}
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-4 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-0 space-y-1">
        <p className="whitespace-pre-line font-medium text-gray-900 dark:text-gray-100">
          {phrase.text || (
            <span className="italic text-gray-400">{t("inHerWords.errors.empty")}</span>
          )}
        </p>
        {phrase.said_on && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {formatDate(phrase.said_on, lang)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
          {t("inHerWords.actions.edit")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRemove}
          aria-label={t("inHerWords.actions.deleteLabel")}
        >
          {t("inHerWords.actions.delete")}
        </button>
      </div>
    </li>
  );
}
