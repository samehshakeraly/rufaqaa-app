import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  createNeed,
  deleteNeed,
  listNeeds,
  NEED_CATEGORIES,
  NEED_STATUSES,
  NEED_TITLE_MAX_LEN,
  updateNeed,
  type NeedRead,
  type NeedUpdate,
} from "@/lib/needs";

const queryKey = (orphanId: string) => ["orphan", orphanId, "needs"];

const CURRENCY_RE = /^[A-Za-z]{3}$/;

/** Progress toward the target, clamped 0–100 (mirrors the backend derivation). */
function progressOf(raised: string, target: string): number {
  const t = Number(target);
  const r = Number(raised);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(r)) return 0;
  return Math.max(0, Math.min(100, Math.round((r / t) * 100)));
}

/** Staff/manager editor for a child's donor-fundable material needs
 * (احتياجاتها).
 *
 * Per-item CRUD mirroring the wishes manager, plus the coded `category`
 * vocabulary the backend enforces (rent/medicine/supplies/…). `status` is the
 * coded lifecycle (open/met/archived) and transitions only via edit;
 * `raised_amount` is SYSTEM-managed (R8's payment webhook) and rendered
 * READ-ONLY with a progress bar; `internal_note` is STAFF-ONLY free text that
 * never reaches a donor. Hiding the whole block is governed separately by the
 * profile-visibility panel. */
export function OrphanNeedsManager({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: queryKey(orphanId),
    queryFn: () => listNeeds(orphanId),
    enabled: Boolean(orphanId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKey(orphanId) });
  const [feedback, setFeedback] = useState<"idle" | "saved" | "error">("idle");

  // Add-form state.
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newNote, setNewNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      createNeed(orphanId, {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        internal_note: newNote.trim() || null,
        category: (newCategory || null) as NeedUpdate["category"],
        target_amount: newAmount.trim(),
        currency: newCurrency.trim().toUpperCase(),
      }),
    onSuccess: async () => {
      setNewTitle("");
      setNewCategory("");
      setNewAmount("");
      setNewCurrency("");
      setNewDescription("");
      setNewNote("");
      setFeedback("saved");
      await invalidate();
    },
    onError: () => setFeedback("error"),
  });

  const remove = useMutation({
    mutationFn: (needId: string) => deleteNeed(needId),
    onSuccess: async () => {
      setFeedback("saved");
      await invalidate();
    },
    onError: () => setFeedback("error"),
  });

  const patch = useMutation({
    mutationFn: ({ needId, body }: { needId: string; body: NeedUpdate }) =>
      updateNeed(needId, body),
    onSuccess: async () => {
      setFeedback("saved");
      await invalidate();
    },
    onError: () => setFeedback("error"),
  });

  if (listQ.isLoading) {
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
        {t("orphanNeeds.loadError")}
      </div>
    );
  }

  const needs = listQ.data ?? [];

  function submitAdd() {
    setAddError(null);
    setFeedback("idle");
    const title = newTitle.trim();
    if (!title) {
      setAddError(t("orphanNeeds.errors.empty"));
      return;
    }
    if (title.length > NEED_TITLE_MAX_LEN) {
      setAddError(t("orphanNeeds.errors.tooLong", { max: NEED_TITLE_MAX_LEN }));
      return;
    }
    const amount = Number(newAmount.trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      setAddError(t("orphanNeeds.errors.amount"));
      return;
    }
    if (!CURRENCY_RE.test(newCurrency.trim())) {
      setAddError(t("orphanNeeds.errors.currency"));
      return;
    }
    add.mutate();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("orphanNeeds.intro")}</p>

      {/* Add form. */}
      <form
        className="space-y-3 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40"
        aria-labelledby="onm-add-title"
        onSubmit={(e) => {
          e.preventDefault();
          submitAdd();
        }}
      >
        <h3 id="onm-add-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("orphanNeeds.add.title")}
        </h3>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanNeeds.fields.title")}
          </span>
          <input
            type="text"
            className="input w-full"
            maxLength={NEED_TITLE_MAX_LEN}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            aria-label={t("orphanNeeds.fields.title")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.category")}
            </span>
            <select
              className="input w-full"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              aria-label={t("orphanNeeds.fields.category")}
            >
              <option value="">{t("orphanNeeds.category.none")}</option>
              {NEED_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`orphanNeeds.category.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.targetAmount")}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              aria-label={t("orphanNeeds.fields.targetAmount")}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.currency")}
            </span>
            <input
              type="text"
              className="input w-full uppercase"
              maxLength={3}
              value={newCurrency}
              onChange={(e) => setNewCurrency(e.target.value)}
              aria-label={t("orphanNeeds.fields.currency")}
              placeholder="KWD"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanNeeds.fields.description")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            aria-label={t("orphanNeeds.fields.description")}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanNeeds.descriptionHint")}
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanNeeds.fields.internalNote")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            aria-label={t("orphanNeeds.fields.internalNote")}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanNeeds.noteHint")}
          </span>
        </label>
        {addError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {addError}
          </p>
        )}
        <button type="submit" className="btn-secondary" disabled={add.isPending}>
          {add.isPending ? t("orphanNeeds.add.submitting") : t("orphanNeeds.add.submit")}
        </button>
      </form>

      {/* Existing needs. */}
      {needs.length === 0 ? (
        <div
          className="rounded-xl border border-sky-200 bg-snow-100 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400"
          role="status"
        >
          {t("orphanNeeds.empty")}
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t("orphanNeeds.listLabel")}>
          {needs.map((need) => (
            <NeedRow
              key={need.id}
              need={need}
              saving={patch.isPending}
              onSave={(body) => {
                setFeedback("idle");
                patch.mutate({ needId: need.id, body });
              }}
              onRemove={() => {
                setFeedback("idle");
                remove.mutate(need.id);
              }}
            />
          ))}
        </ul>
      )}

      {feedback === "saved" && (
        <span className="text-sm font-medium text-success-700" role="status">
          {t("orphanNeeds.saved")}
        </span>
      )}
      {feedback === "error" && (
        <span className="text-sm font-medium text-danger-700" role="alert">
          {t("orphanNeeds.saveError")}
        </span>
      )}
    </div>
  );
}

/** One need row: read view (title + localized category/status chips +
 * read-only raised progress + donor pitch + staff note) with edit/delete
 * actions; edit mode patches just this row. `raised_amount` is never
 * editable — it is system-managed and only displayed. */
function NeedRow({
  need,
  saving,
  onSave,
  onRemove,
}: {
  need: NeedRead;
  saving: boolean;
  onSave: (body: NeedUpdate) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(need.title);
  const [category, setCategory] = useState(need.category ?? "");
  const [amount, setAmount] = useState(need.target_amount);
  const [currency, setCurrency] = useState(need.currency);
  const [status, setStatus] = useState(need.status);
  const [description, setDescription] = useState(need.description ?? "");
  const [note, setNote] = useState(need.internal_note ?? "");
  const [rowError, setRowError] = useState<string | null>(null);

  const progress = progressOf(need.raised_amount, need.target_amount);

  function startEdit() {
    setTitle(need.title);
    setCategory(need.category ?? "");
    setAmount(need.target_amount);
    setCurrency(need.currency);
    setStatus(need.status);
    setDescription(need.description ?? "");
    setNote(need.internal_note ?? "");
    setRowError(null);
    setEditing(true);
  }

  function save() {
    setRowError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setRowError(t("orphanNeeds.errors.empty"));
      return;
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setRowError(t("orphanNeeds.errors.amount"));
      return;
    }
    if (!CURRENCY_RE.test(currency.trim())) {
      setRowError(t("orphanNeeds.errors.currency"));
      return;
    }
    onSave({
      title: trimmed,
      description: description.trim() || null,
      internal_note: note.trim() || null,
      category: (category || null) as NeedUpdate["category"],
      target_amount: amount,
      currency: currency.trim().toUpperCase(),
      status: status as NeedUpdate["status"],
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-3 rounded-xl border border-sky-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-800/40">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanNeeds.fields.title")}
          </span>
          <input
            type="text"
            className="input w-full"
            maxLength={NEED_TITLE_MAX_LEN}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={t("orphanNeeds.edit.title")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.category")}
            </span>
            <select
              className="input w-full"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("orphanNeeds.edit.category")}
            >
              <option value="">{t("orphanNeeds.category.none")}</option>
              {NEED_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`orphanNeeds.category.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.status")}
            </span>
            <select
              className="input w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label={t("orphanNeeds.edit.status")}
            >
              {NEED_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`orphanNeeds.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.targetAmount")}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t("orphanNeeds.edit.targetAmount")}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanNeeds.fields.currency")}
            </span>
            <input
              type="text"
              className="input w-full uppercase"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label={t("orphanNeeds.edit.currency")}
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanNeeds.fields.description")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label={t("orphanNeeds.edit.description")}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanNeeds.fields.internalNote")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t("orphanNeeds.edit.internalNote")}
          />
        </label>
        {rowError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {rowError}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {t("orphanNeeds.edit.save")}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
            {t("orphanNeeds.edit.cancel")}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-4 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
          {need.title}
          {need.category && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
              {t(`orphanNeeds.category.${need.category}`, { defaultValue: need.category })}
            </span>
          )}
          <span className="rounded-full bg-trust-100 px-2 py-0.5 text-xs font-medium text-trust-800 dark:bg-trust-900/40 dark:text-trust-100">
            {t(`orphanNeeds.status.${need.status}`, { defaultValue: need.status })}
          </span>
        </p>
        {/* Read-only, system-managed money trail + progress bar. */}
        <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span>
            {t("orphanNeeds.raised", {
              raised: need.raised_amount,
              target: need.target_amount,
              currency: need.currency,
            })}
          </span>
          <span
            aria-hidden="true"
            className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
          >
            <span
              className="block h-full rounded-full bg-success-500"
              style={{ width: `${progress}%` }}
            />
          </span>
          <span>{progress}%</span>
        </p>
        {need.description && (
          <p className="text-xs text-gray-600 dark:text-gray-300">{need.description}</p>
        )}
        {need.internal_note && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanNeeds.notePrefix")} {need.internal_note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn-secondary" onClick={startEdit}>
          {t("orphanNeeds.actions.edit")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRemove}
          aria-label={t("orphanNeeds.actions.deleteLabel")}
        >
          {t("orphanNeeds.actions.delete")}
        </button>
      </div>
    </li>
  );
}
