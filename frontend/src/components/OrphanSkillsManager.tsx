import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";
import {
  createSkill,
  deleteSkill,
  listSkills,
  SKILL_CATEGORIES,
  SKILL_LEVELS,
  SKILL_NAME_MAX_LEN,
  updateSkill,
  type SkillRead,
  type SkillUpdate,
} from "@/lib/skills";

const queryKey = (orphanId: string) => ["orphan", orphanId, "skills"];

/** Staff/manager editor for a child's skills and talents (مهاراتها).
 *
 * Per-item CRUD (unlike the replace-array In-Her-Words editor): add posts one
 * skill, edit patches it, delete removes it — each action refreshes the list.
 * `category`/`level` are the coded vocabularies the backend enforces (the
 * donor page localizes them); `note` is STAFF-ONLY free text that never
 * reaches a donor. Hiding the whole block is governed separately by the
 * profile-visibility panel. */
export function OrphanSkillsManager({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: queryKey(orphanId),
    queryFn: () => listSkills(orphanId),
    enabled: Boolean(orphanId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKey(orphanId) });
  const [feedback, setFeedback] = useState<"idle" | "saved" | "error">("idle");

  // Add-form state.
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newLevel, setNewLevel] = useState("");
  const [newNote, setNewNote] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      createSkill(orphanId, {
        name: newName.trim(),
        category: (newCategory || null) as SkillUpdate["category"],
        level: (newLevel || null) as SkillUpdate["level"],
        note: newNote.trim() || null,
      }),
    onSuccess: async () => {
      setNewName("");
      setNewCategory("");
      setNewLevel("");
      setNewNote("");
      setFeedback("saved");
      await invalidate();
    },
    onError: () => setFeedback("error"),
  });

  const remove = useMutation({
    mutationFn: (skillId: string) => deleteSkill(skillId),
    onSuccess: async () => {
      setFeedback("saved");
      await invalidate();
    },
    onError: () => setFeedback("error"),
  });

  const patch = useMutation({
    mutationFn: ({ skillId, body }: { skillId: string; body: SkillUpdate }) =>
      updateSkill(skillId, body),
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
        {t("orphanSkills.loadError")}
      </div>
    );
  }

  const skills = listQ.data ?? [];

  function submitAdd() {
    setAddError(null);
    setFeedback("idle");
    const name = newName.trim();
    if (!name) {
      setAddError(t("orphanSkills.errors.empty"));
      return;
    }
    if (name.length > SKILL_NAME_MAX_LEN) {
      setAddError(t("orphanSkills.errors.tooLong", { max: SKILL_NAME_MAX_LEN }));
      return;
    }
    add.mutate();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("orphanSkills.intro")}</p>

      {/* Add form. */}
      <form
        className="space-y-3 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40"
        aria-labelledby="osk-add-title"
        onSubmit={(e) => {
          e.preventDefault();
          submitAdd();
        }}
      >
        <h3 id="osk-add-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t("orphanSkills.add.title")}
        </h3>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanSkills.fields.name")}
          </span>
          <input
            type="text"
            className="input w-full"
            maxLength={SKILL_NAME_MAX_LEN}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label={t("orphanSkills.fields.name")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanSkills.fields.category")}
            </span>
            <select
              className="input w-full"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              aria-label={t("orphanSkills.fields.category")}
            >
              <option value="">{t("orphanSkills.category.none")}</option>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`orphanSkills.category.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanSkills.fields.level")}
            </span>
            <select
              className="input w-full"
              value={newLevel}
              onChange={(e) => setNewLevel(e.target.value)}
              aria-label={t("orphanSkills.fields.level")}
            >
              <option value="">{t("orphanSkills.level.none")}</option>
              {SKILL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`orphanSkills.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanSkills.fields.note")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            aria-label={t("orphanSkills.fields.note")}
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanSkills.noteHint")}
          </span>
        </label>
        {addError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {addError}
          </p>
        )}
        <button type="submit" className="btn-secondary" disabled={add.isPending}>
          {add.isPending ? t("orphanSkills.add.submitting") : t("orphanSkills.add.submit")}
        </button>
      </form>

      {/* Existing skills. */}
      {skills.length === 0 ? (
        <div
          className="rounded-xl border border-sky-200 bg-snow-100 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40 dark:text-gray-400"
          role="status"
        >
          {t("orphanSkills.empty")}
        </div>
      ) : (
        <ul className="space-y-3" aria-label={t("orphanSkills.listLabel")}>
          {skills.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              saving={patch.isPending}
              onSave={(body) => {
                setFeedback("idle");
                patch.mutate({ skillId: skill.id, body });
              }}
              onRemove={() => {
                setFeedback("idle");
                remove.mutate(skill.id);
              }}
            />
          ))}
        </ul>
      )}

      {feedback === "saved" && (
        <span className="text-sm font-medium text-success-700" role="status">
          {t("orphanSkills.saved")}
        </span>
      )}
      {feedback === "error" && (
        <span className="text-sm font-medium text-danger-700" role="alert">
          {t("orphanSkills.saveError")}
        </span>
      )}
    </div>
  );
}

/** One skill row: read view (name + localized category/level chips + staff
 * note) with edit/delete actions; edit mode patches just this row. */
function SkillRow({
  skill,
  saving,
  onSave,
  onRemove,
}: {
  skill: SkillRead;
  saving: boolean;
  onSave: (body: SkillUpdate) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(skill.name);
  const [category, setCategory] = useState(skill.category ?? "");
  const [level, setLevel] = useState(skill.level ?? "");
  const [note, setNote] = useState(skill.note ?? "");
  const [rowError, setRowError] = useState<string | null>(null);

  function startEdit() {
    setName(skill.name);
    setCategory(skill.category ?? "");
    setLevel(skill.level ?? "");
    setNote(skill.note ?? "");
    setRowError(null);
    setEditing(true);
  }

  function save() {
    setRowError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setRowError(t("orphanSkills.errors.empty"));
      return;
    }
    onSave({
      name: trimmed,
      category: (category || null) as SkillUpdate["category"],
      level: (level || null) as SkillUpdate["level"],
      note: note.trim() || null,
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <li className="space-y-3 rounded-xl border border-sky-200 bg-snow-100 p-4 dark:border-gray-700 dark:bg-gray-800/40">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanSkills.fields.name")}
          </span>
          <input
            type="text"
            className="input w-full"
            maxLength={SKILL_NAME_MAX_LEN}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("orphanSkills.edit.name")}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanSkills.fields.category")}
            </span>
            <select
              className="input w-full"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("orphanSkills.edit.category")}
            >
              <option value="">{t("orphanSkills.category.none")}</option>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`orphanSkills.category.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              {t("orphanSkills.fields.level")}
            </span>
            <select
              className="input w-full"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              aria-label={t("orphanSkills.edit.level")}
            >
              <option value="">{t("orphanSkills.level.none")}</option>
              {SKILL_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`orphanSkills.level.${l}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            {t("orphanSkills.fields.note")}
          </span>
          <textarea
            className="input w-full"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t("orphanSkills.edit.note")}
          />
        </label>
        {rowError && (
          <p className="text-sm font-medium text-danger-700 dark:text-danger-100" role="alert">
            {rowError}
          </p>
        )}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={saving} onClick={save}>
            {t("orphanSkills.edit.save")}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
            {t("orphanSkills.edit.cancel")}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-4 rounded-xl border border-sky-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-gray-900 dark:text-gray-100">{skill.name}</p>
        {(skill.category || skill.level) && (
          <p className="flex flex-wrap gap-2 text-xs">
            {skill.category && (
              <span className="rounded-full bg-trust-100 px-2 py-0.5 font-medium text-trust-800 dark:bg-trust-900/40 dark:text-trust-100">
                {t(`orphanSkills.category.${skill.category}`, {
                  defaultValue: skill.category,
                })}
              </span>
            )}
            {skill.level && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {t(`orphanSkills.level.${skill.level}`, { defaultValue: skill.level })}
              </span>
            )}
          </p>
        )}
        {skill.note && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("orphanSkills.notePrefix")} {skill.note}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className="btn-secondary" onClick={startEdit}>
          {t("orphanSkills.actions.edit")}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={onRemove}
          aria-label={t("orphanSkills.actions.deleteLabel")}
        >
          {t("orphanSkills.actions.delete")}
        </button>
      </div>
    </li>
  );
}
