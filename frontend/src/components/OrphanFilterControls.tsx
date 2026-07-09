import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  EDUCATION_STAGES,
  HEALTH_STATUSES,
  PRIORITY_LEVELS,
} from "@/components/NewOrphanForm";
import type { EducationStage, HealthStatus, PriorityLevel } from "@/lib/orphans";
import type { OrphanSliceFilters } from "@/lib/orphanSlice";

// The classes rendered below (ps-filter-select / ps-tags-filter / …) live in
// OrphansPage.css, scoped under a `.ps-orphans` container; every consumer of
// these controls wraps itself in that class.
import "@/pages/OrphansPage.css";

/** The orphan-list filter controls (selects, number bounds, tag chips) as a
 * controlled fragment. Extracted verbatim from OrphansPage so the segments
 * report reuses the exact same panel; hosts render it inside their own
 * `.ps-filter-bar` alongside their page-specific controls (search, sort…). */
export function OrphanFilterControls({
  value,
  onChange,
}: {
  value: OrphanSliceFilters;
  onChange: (next: OrphanSliceFilters) => void;
}) {
  const { t } = useTranslation();
  // Tag entry is UI-local; only committed chips reach the slice value.
  const [tagInput, setTagInput] = useState("");

  function patch(partial: Partial<OrphanSliceFilters>) {
    onChange({ ...value, ...partial });
  }

  // Tags filter chips — same Enter/comma entry UX as NewOrphanForm.
  function addTag() {
    const next = tagInput.trim();
    if (!next || value.tags.includes(next)) {
      setTagInput("");
      return;
    }
    patch({ tags: [...value.tags, next] });
    setTagInput("");
  }

  function removeTag(tag: string) {
    patch({ tags: value.tags.filter((x) => x !== tag) });
  }

  return (
    <>
      <select
        className="ps-filter-select"
        aria-label={t("orphans.filters.educationStage")}
        value={value.educationStage}
        onChange={(e) => patch({ educationStage: e.target.value as EducationStage | "" })}
      >
        <option value="">
          {t("orphans.filters.educationStage")}: {t("orphans.filters.all")}
        </option>
        {EDUCATION_STAGES.map((s) => (
          <option key={s} value={s}>
            {t(`orphans.profile.educationStageOptions.${s}`)}
          </option>
        ))}
      </select>

      <select
        className="ps-filter-select"
        aria-label={t("orphans.filters.healthStatus")}
        value={value.healthStatus}
        onChange={(e) => patch({ healthStatus: e.target.value as HealthStatus | "" })}
      >
        <option value="">
          {t("orphans.filters.healthStatus")}: {t("orphans.filters.all")}
        </option>
        {HEALTH_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`orphans.profile.healthStatusOptions.${s}`)}
          </option>
        ))}
      </select>

      <select
        className="ps-filter-select"
        aria-label={t("orphans.filters.isHafiz")}
        value={value.isHafiz}
        onChange={(e) => patch({ isHafiz: e.target.value as "" | "true" | "false" })}
      >
        <option value="">{t("orphans.filters.isHafizOptions.all")}</option>
        <option value="true">{t("orphans.filters.isHafizOptions.hafiz")}</option>
        <option value="false">{t("orphans.filters.isHafizOptions.notHafiz")}</option>
      </select>

      <input
        type="number"
        min={0}
        max={30}
        step={1}
        className="ps-filter-input ps-filter-num"
        aria-label={t("orphans.filters.minJuz")}
        placeholder={t("orphans.filters.minJuz")}
        value={value.minJuz}
        onChange={(e) => patch({ minJuz: e.target.value })}
      />

      <div className="ps-tags-filter">
        {value.tags.map((tag) => (
          <span key={tag} className="ps-tag-chip">
            {tag}
            <button
              type="button"
              aria-label={t("orphans.profile.tags.remove", { tag })}
              onClick={() => removeTag(tag)}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          aria-label={t("orphans.filters.tags")}
          placeholder={t("orphans.filters.tags")}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
        />
      </div>

      <select
        className="ps-filter-select"
        aria-label={t("orphans.filters.tagsMode")}
        value={value.tagsMode}
        onChange={(e) => patch({ tagsMode: e.target.value as "all" | "any" })}
      >
        <option value="all">{t("orphans.filters.tagsModeOptions.all")}</option>
        <option value="any">{t("orphans.filters.tagsModeOptions.any")}</option>
      </select>

      <select
        className="ps-filter-select"
        aria-label={t("orphans.filters.orphanType")}
        value={value.orphanType}
        onChange={(e) => patch({ orphanType: e.target.value as "" | "single" | "double" })}
      >
        <option value="">
          {t("orphans.filters.orphanType")}: {t("orphans.filters.all")}
        </option>
        <option value="single">{t("orphans.filters.orphanTypeOptions.single")}</option>
        <option value="double">{t("orphans.filters.orphanTypeOptions.double")}</option>
      </select>

      <select
        className="ps-filter-select"
        aria-label={t("orphans.filters.priority")}
        value={value.priority}
        onChange={(e) => patch({ priority: e.target.value as PriorityLevel | "" })}
      >
        <option value="">
          {t("orphans.filters.priority")}: {t("orphans.filters.all")}
        </option>
        {PRIORITY_LEVELS.map((p) => (
          <option key={p} value={p}>
            {t(`orphans.profile.priorityLevelOptions.${p}`)}
          </option>
        ))}
      </select>

      <input
        type="number"
        min={0}
        step={1}
        className="ps-filter-input ps-filter-num"
        aria-label={t("orphans.filters.minWaitingDays")}
        placeholder={t("orphans.filters.minWaitingDays")}
        value={value.minWaitingDays}
        onChange={(e) => patch({ minWaitingDays: e.target.value })}
      />

      <input
        type="number"
        min={0}
        max={100}
        step={1}
        className="ps-filter-input ps-filter-num"
        aria-label={t("orphans.filters.minCompletion")}
        placeholder={t("orphans.filters.minCompletion")}
        value={value.minCompletion}
        onChange={(e) => patch({ minCompletion: e.target.value })}
      />
    </>
  );
}
