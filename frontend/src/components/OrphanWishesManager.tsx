import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  createWish,
  deleteWish,
  listWishes,
  updateWish,
  WISH_STATUSES,
  WISH_TITLE_MAX_LEN,
  type WishRead,
  type WishUpdate,
} from "@/lib/wishes";

const queryKey = (orphanId: string) => ["orphan", orphanId, "wishes"];

const CURRENCY_RE = /^[A-Za-z]{3}$/;

/** Progress toward the target, clamped 0–100 (mirrors the backend derivation). */
function progressOf(raised: string, target: string): number {
  const t = Number(target);
  const r = Number(raised);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(r)) return 0;
  return Math.max(0, Math.min(100, Math.round((r / t) * 100)));
}

/** Staff/manager editor for a child's donor-fundable wishes (أمنياتها).
 *
 * Per-item CRUD mirroring the skills manager: add posts one wish, edit
 * patches it, delete removes it — each action refreshes the list. `status`
 * is the coded lifecycle the backend enforces (open/fulfilled/archived) and
 * transitions only via edit; `raised_amount` is SYSTEM-managed (R8's payment
 * webhook) and rendered READ-ONLY with a progress bar; `internal_note` is
 * STAFF-ONLY free text that never reaches a donor. Hiding the whole block is
 * governed separately by the profile-visibility panel. */
export function OrphanWishesManager({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: queryKey(orphanId),
    queryFn: () => listWishes(orphanId),
    enabled: Boolean(orphanId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKey(orphanId) });
  const [feedback, setFeedback] = useState<"idle" | "saved" | "error">("idle");

  // Add-form state.
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newNote, setNewNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      createWish(orphanId, {
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        internal_note: newNote.trim() || null,
        target_amount: newAmount.trim(),
        currency: newCurrency.trim().toUpperCase(),
      }),
    onSuccess: async () => {
      setNewTitle("");
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
    mutationFn: (wishId: string) => deleteWish(wishId),
    onSuccess: async () => {
      setFeedback("saved");
      await invalidate();
    },
    onError: () => setFeedback("error"),
  });

  const patch = useMutation({
    mutationFn: ({ wishId, body }: { wishId: string; body: WishUpdate }) =>
      updateWish(wishId, body),
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
        {t("orphanWishes.loadError")}
      </div>
    );
  }

  const wishes = listQ.data ?? [];

  function submitAdd() {
    setAddError(null);
    setFeedback("idle");
    const title = newTitle.trim();
    if (!title) {
      setAddError(t("orphanWishes.errors.empty"));
      return;
    }
    if (title.length > WISH_TITLE_MAX_LEN) {
      setAddError(t("orphanWishes.errors.tooLong", { max: WISH_TITLE_MAX_LEN }));
      return;
    }
    const amount = Number(newAmount.trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      setAddError(t("orphanWishes.errors.amount"));
      return;
    }
    if (!CURRENCY_RE.test(newCurrency.trim())) {
      setAddError(t("orphanWishes.errors.currency"));
      return;
    }
    add.mutate();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("orphanWishes.intro")}</p>

      {/* Add form. */}
      <form
        className="space-y-3 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40"
        aria-labelledby="owm-add-title"
        onSubmit={(e) => {
          e.preventDefault();
          submitAdd();
        }}
      >
        <h3 id="owm-add-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("orphanWishes.add.title")}
        </h3>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanWishes.fields.title")}
          </span>
          <input
            type="text"
            className="input w-full"
            maxLength={WISH_TITLE_MAX_LEN}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            aria-label={t("orphanWishes.fields.title")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanWishes.fields.targetAmount")}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              aria-label={t("orphanWishes.fields.targetAmount")}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanWishes.fields.currency")}
            </span>
            <input
              type="text"
              className="input w-full uppercase"
              maxLength={3}
              value={newCurrency}
              onChange={(e) => setNewCurrency(e.target.value)}
              aria-label={t("orphanWishes.fields.currency")}
              placeholder="KWD"
            />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanWishes.fields.description")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            aria-label={t("orphanWishes.fields.description")}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanWishes.descriptionHint")}
          </span>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanWishes.fields.internalNote")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            aria-label={t("orphanWishes.fields.internalNote")}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanWishes.noteHint")}
          </span>
        </label>
        {addError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {addError}
          </p>
        )}
        <button type="submit" className="btn-secondary" disabled={add.isPending}>
          {add.isPending ? t("orphanWishes.add.submitting") : t("orphanWishes.add.submit")}
        </button>
      </form>

      {/* Existing wishes. */}
      {wishes.length === 0 ? (
        <div
          className="rounded-xl border border-sky-200 bg-snow-100 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400"
          role="status"
        >
          {t("orphanWishes.empty")}
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t("orphanWishes.listLabel")}>
          {wishes.map((wish) => (
            <WishRow
              key={wish.id}
              wish={wish}
              saving={patch.isPending}
              onSave={(body) => {
                setFeedback("idle");
                patch.mutate({ wishId: wish.id, body });
              }}
              onRemove={() => {
                setFeedback("idle");
                remove.mutate(wish.id);
              }}
            />
          ))}
        </ul>
      )}

      {feedback === "saved" && (
        <span className="text-sm font-medium text-success-700" role="status">
          {t("orphanWishes.saved")}
        </span>
      )}
      {feedback === "error" && (
        <span className="text-sm font-medium text-danger-700" role="alert">
          {t("orphanWishes.saveError")}
        </span>
      )}
    </div>
  );
}

/** One wish row: read view (title + localized status chip + read-only raised
 * progress + donor pitch + staff note) with edit/delete actions; edit mode
 * patches just this row. `raised_amount` is never editable — it is
 * system-managed and only displayed. */
function WishRow({
  wish,
  saving,
  onSave,
  onRemove,
}: {
  wish: WishRead;
  saving: boolean;
  onSave: (body: WishUpdate) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(wish.title);
  const [amount, setAmount] = useState(wish.target_amount);
  const [currency, setCurrency] = useState(wish.currency);
  const [status, setStatus] = useState(wish.status);
  const [description, setDescription] = useState(wish.description ?? "");
  const [note, setNote] = useState(wish.internal_note ?? "");
  const [rowError, setRowError] = useState<string | null>(null);

  const progress = progressOf(wish.raised_amount, wish.target_amount);

  function startEdit() {
    setTitle(wish.title);
    setAmount(wish.target_amount);
    setCurrency(wish.currency);
    setStatus(wish.status);
    setDescription(wish.description ?? "");
    setNote(wish.internal_note ?? "");
    setRowError(null);
    setEditing(true);
  }

  function save() {
    setRowError(null);
    const trimmed = title.trim();
    if (!trimmed) {
      setRowError(t("orphanWishes.errors.empty"));
      return;
    }
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setRowError(t("orphanWishes.errors.amount"));
      return;
    }
    if (!CURRENCY_RE.test(currency.trim())) {
      setRowError(t("orphanWishes.errors.currency"));
      return;
    }
    onSave({
      title: trimmed,
      description: description.trim() || null,
      internal_note: note.trim() || null,
      target_amount: amount,
      currency: currency.trim().toUpperCase(),
      status: status as WishUpdate["status"],
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-3 rounded-xl border border-sky-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-800/40">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanWishes.fields.title")}
          </span>
          <input
            type="text"
            className="input w-full"
            maxLength={WISH_TITLE_MAX_LEN}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={t("orphanWishes.edit.title")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanWishes.fields.targetAmount")}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t("orphanWishes.edit.targetAmount")}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanWishes.fields.currency")}
            </span>
            <input
              type="text"
              className="input w-full uppercase"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label={t("orphanWishes.edit.currency")}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanWishes.fields.status")}
            </span>
            <select
              className="input w-full"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label={t("orphanWishes.edit.status")}
            >
              {WISH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`orphanWishes.status.${s}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanWishes.fields.description")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-label={t("orphanWishes.edit.description")}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanWishes.fields.internalNote")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t("orphanWishes.edit.internalNote")}
          />
        </label>
        {rowError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {rowError}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {t("orphanWishes.edit.save")}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
            {t("orphanWishes.edit.cancel")}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-4 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
          {wish.title}
          <span className="rounded-full bg-trust-100 px-2 py-0.5 text-xs font-medium text-trust-800 dark:bg-trust-900/40 dark:text-trust-100">
            {t(`orphanWishes.status.${wish.status}`, { defaultValue: wish.status })}
          </span>
        </p>
        {/* Read-only, system-managed money trail + progress bar. */}
        <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span>
            {t("orphanWishes.raised", {
              raised: wish.raised_amount,
              target: wish.target_amount,
              currency: wish.currency,
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
        {wish.description && (
          <p className="text-xs text-gray-600 dark:text-gray-300">{wish.description}</p>
        )}
        {wish.internal_note && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanWishes.notePrefix")} {wish.internal_note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn-secondary" onClick={startEdit}>
          {t("orphanWishes.actions.edit")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRemove}
          aria-label={t("orphanWishes.actions.deleteLabel")}
        >
          {t("orphanWishes.actions.delete")}
        </button>
      </div>
    </li>
  );
}
