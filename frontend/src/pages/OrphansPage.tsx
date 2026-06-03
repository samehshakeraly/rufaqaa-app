import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { EDUCATION_STAGES, HEALTH_STATUSES, NewOrphanForm } from "@/components/NewOrphanForm";
import { Pagination } from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import {
  type EducationStage,
  type HealthStatus,
  type Orphan,
  approveOrphan,
  archiveOrphan,
  exportOrphansCsv,
  listOrphans,
  rejectOrphan,
} from "@/lib/orphans";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

import "./OrphansPage.css";

const PAGE_SIZE = 20;

// Every filter dimension that narrows the list. Kept as plain strings (""
// = unset) so they slot straight into the react-query key; the listOrphans
// call below maps them to typed params, omitting the empty ones.
interface OrphanFilters {
  q: string;
  caseStatus: string;
  educationStage: string;
  healthStatus: string;
  isHafiz: string;
  minJuz: string;
  tags: string[];
  tagsMode: "all" | "any";
}

const orphanQueryKey = (filters: OrphanFilters, offset: number) =>
  ["orphans", { limit: PAGE_SIZE, offset, ...filters }] as const;

const CASE_STATUS_OPTIONS = [
  "",
  "pending_review",
  "approved",
  "available",
  "reserved",
  "sponsored",
  "graduated",
] as const;

// Map a case_status onto a status-pill variant (PS-02 visual language).
const STATUS_PILL: Record<string, string> = {
  pending_review: "review",
  approved: "active",
  available: "active",
  reserved: "pending",
  sponsored: "active",
  graduated: "graduated",
  deceased: "archived",
  rejected: "archived",
  archived: "archived",
};

function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age >= 0 ? age : null;
}

function initial(name: string | null | undefined): string {
  return name?.trim()?.[0] ?? "—";
}

const ICON_EYE = (
  <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const ICON_SEARCH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export function OrphansPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { isAdmin, isPartner, isPartnerApprover } = useRole();
  const [searchParams, setSearchParams] = useSearchParams();

  // Hydrate caseStatus from URL ?status=… so navigation links land on
  // the filtered view (e.g. Approvals → ?status=pending_review).
  const urlStatus = searchParams.get("status") ?? "";
  const [showForm, setShowForm] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [caseStatus, setCaseStatus] = useState<string>(urlStatus);
  // Segment filters (staff list only). "" means "all" for the selects; the
  // tri-state isHafiz maps ""→undefined, "true"→true, "false"→false.
  const [educationStage, setEducationStage] = useState<EducationStage | "">("");
  const [healthStatus, setHealthStatus] = useState<HealthStatus | "">("");
  const [isHafiz, setIsHafiz] = useState<"" | "true" | "false">("");
  const [minJuz, setMinJuz] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagsMode, setTagsMode] = useState<"all" | "any">("all");
  const [tagInput, setTagInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Keep state in sync with URL changes (e.g. nav links updating ?status=).
  useEffect(() => {
    setCaseStatus(urlStatus);
  }, [urlStatus]);

  // 300ms debounce on the search box so we don't spam the API on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset to page 1 whenever filters change so users don't land on an
  // empty page after narrowing the result set.
  useEffect(() => {
    setOffset(0);
  }, [debouncedSearch, caseStatus, educationStage, healthStatus, isHafiz, minJuz, tags, tagsMode]);

  // Clear bulk selection when the filter / page changes — selected IDs
  // would otherwise refer to rows that aren't visible anymore.
  useEffect(() => {
    setSelected(new Set());
  }, [
    debouncedSearch,
    caseStatus,
    educationStage,
    healthStatus,
    isHafiz,
    minJuz,
    tags,
    tagsMode,
    offset,
  ]);

  function onCaseStatusChange(next: string) {
    setCaseStatus(next);
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("status", next);
    else sp.delete("status");
    setSearchParams(sp, { replace: true });
  }

  // Tags filter chips — same Enter/comma entry UX as NewOrphanForm.
  function addTag() {
    const next = tagInput.trim();
    if (!next || tags.includes(next)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, next]);
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((x) => x !== tag));
  }

  const filters: OrphanFilters = {
    q: debouncedSearch,
    caseStatus,
    educationStage,
    healthStatus,
    isHafiz,
    minJuz,
    tags,
    tagsMode,
  };
  const queryKey = orphanQueryKey(filters, offset);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      listOrphans({
        limit: PAGE_SIZE,
        offset,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        ...(caseStatus ? { case_status: caseStatus } : {}),
        ...(educationStage ? { education_stage: educationStage } : {}),
        ...(healthStatus ? { health_status: healthStatus } : {}),
        ...(isHafiz !== "" ? { is_hafiz: isHafiz === "true" } : {}),
        ...(minJuz !== "" ? { min_juz: Number(minJuz) } : {}),
        ...(tags.length > 0 ? { tags, tags_mode: tagsMode } : {}),
      }),
  });
  const { data: partners } = useQuery({
    queryKey: ["partners"],
    queryFn: () => listPartners(),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveOrphan(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orphans"] });
      toast.success(t("orphans.actions.approved"));
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectOrphan(id, reason),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orphans"] });
      toast.success(t("orphans.actions.rejected"));
      setRejectingId(null);
    },
    onError: (err) => {
      const msg = err instanceof AxiosError ? err.response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : t("common.createError"));
    },
  });

  const isApprovalView = urlStatus === "pending_review" && isPartnerApprover;
  const allChecked =
    !!data && data.items.length > 0 && data.items.every((o) => selected.has(o.id));

  function toggleAll(checked: boolean) {
    const next = new Set(selected);
    if (!data) return;
    if (checked) data.items.forEach((o) => next.add(o.id));
    else data.items.forEach((o) => next.delete(o.id));
    setSelected(next);
  }

  async function onExport() {
    try {
      const blob = await exportOrphansCsv(caseStatus ? { case_status: caseStatus } : {});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "rufaqaa-orphans.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("common.loadError"));
    }
  }

  async function onBulkArchive() {
    if (!window.confirm(t("orphans.bulkArchiveConfirm", { count: selected.size }))) {
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of selected) {
      try {
        await archiveOrphan(id);
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    await qc.invalidateQueries({ queryKey: ["orphans"] });
    if (fail === 0) toast.success(t("orphans.bulkArchiveDone", { ok }));
    else toast.error(t("orphans.bulkArchivePartial", { ok, fail }));
  }

  return (
    <div className="ps-orphans">
      <div className="ps-orphans-header">
        <div>
          <h1>{t("orphans.title")}</h1>
          {isApprovalView && <p>{t("orphans.subtitle.approvals")}</p>}
        </div>
        <div className="ps-orphans-header-actions">
          <button type="button" className="ps-btn" onClick={onExport}>
            <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("orphans.exportCsv")}
          </button>
          {(isPartner || isAdmin) && (
            <Link to="/admin/orphans/new" className="ps-btn">
              {t("nav.registerOrphan")}
            </Link>
          )}
          {(isPartner || isAdmin) && (
            <button
              type="button"
              className="ps-btn ps-btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              <svg className="ps-icon ps-icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {showForm ? t("common.cancel") : t("orphans.addNew")}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div style={{ marginBottom: 16 }}>
          <NewOrphanForm
            audience="staff"
            partners={partners?.items ?? []}
            onCreated={async () => {
              await qc.invalidateQueries({ queryKey });
              setShowForm(false);
            }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Status tabs */}
      <div className="ps-status-tabs" role="tablist" aria-label={t("orphans.status")}>
        {CASE_STATUS_OPTIONS.map((s) => (
          <button
            key={s || "all"}
            type="button"
            role="tab"
            aria-selected={caseStatus === s}
            className={`ps-status-tab${caseStatus === s ? " active" : ""}`}
            onClick={() => onCaseStatusChange(s)}
          >
            {s === "" ? t("orphans.allStatuses") : t(`orphans.caseStatus.${s}`, s)}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="ps-filter-bar">
        <div className="ps-search">
          <input
            type="search"
            placeholder={t("orphans.searchPlaceholder")}
            aria-label={t("orphans.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {ICON_SEARCH}
        </div>

        <select
          className="ps-filter-select"
          aria-label={t("orphans.filters.educationStage")}
          value={educationStage}
          onChange={(e) => setEducationStage(e.target.value as EducationStage | "")}
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
          value={healthStatus}
          onChange={(e) => setHealthStatus(e.target.value as HealthStatus | "")}
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
          value={isHafiz}
          onChange={(e) => setIsHafiz(e.target.value as "" | "true" | "false")}
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
          value={minJuz}
          onChange={(e) => setMinJuz(e.target.value)}
        />

        <div className="ps-tags-filter">
          {tags.map((tag) => (
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
          value={tagsMode}
          onChange={(e) => setTagsMode(e.target.value as "all" | "any")}
        >
          <option value="all">{t("orphans.filters.tagsModeOptions.all")}</option>
          <option value="any">{t("orphans.filters.tagsModeOptions.any")}</option>
        </select>

        {data && (
          <span className="ps-filter-total">
            {t("common.total")}: <span className="latin">{data.total.toLocaleString(i18n.language)}</span>
          </span>
        )}
      </div>

      {/* Bulk-archive is admin-only — partner staff/managers don't get it. */}
      {isAdmin && selected.size > 0 && (
        <div className="ps-bulk-bar">
          <span className="ps-selected-count">
            {t("orphans.bulkSelected", { count: selected.size })}
          </span>
          <div className="ps-bulk-actions">
            <button
              type="button"
              className="ps-bulk-btn"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
            >
              {t("orphans.bulkClear")}
            </button>
            <button
              type="button"
              className="ps-bulk-btn danger"
              onClick={onBulkArchive}
              disabled={bulkBusy}
            >
              {bulkBusy ? t("common.saving") : t("orphans.bulkArchive")}
            </button>
          </div>
        </div>
      )}

      {isLoading && <TableSkeleton columns={6} />}
      {error && <p className="ps-orphans-error">{t("common.loadError")}</p>}

      {data && data.items.length === 0 && (
        <div className="ps-table-card">
          <p className="ps-orphans-msg">{t("common.empty")}</p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="ps-table-card">
          <div className="ps-table-wrap">
            <table className="ps-t">
              <thead>
                <tr>
                  {isAdmin && (
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        className="ps-row-check"
                        aria-label="select-all"
                        checked={allChecked}
                        onChange={(e) => toggleAll(e.target.checked)}
                      />
                    </th>
                  )}
                  <th>{t("orphans.code")}</th>
                  <th>{t("orphans.name")}</th>
                  <th>{t("orphans.age")}</th>
                  <th>{t("orphans.gender")}</th>
                  <th>{t("orphans.status")}</th>
                  <th>{t("orphans.sponsorship")}</th>
                  <th className="action-col">{t("orphans.actionsCol")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <OrphanRow
                    key={o.id}
                    orphan={o}
                    lang={i18n.language}
                    isAdmin={isAdmin}
                    isApprover={isPartnerApprover}
                    selected={selected.has(o.id)}
                    onToggle={(checked) => {
                      const next = new Set(selected);
                      if (checked) next.add(o.id);
                      else next.delete(o.id);
                      setSelected(next);
                    }}
                    onApprove={() => approveMut.mutate(o.id)}
                    onReject={() => setRejectingId(o.id)}
                    approveDisabled={approveMut.isPending}
                    rejectDisabled={rejectMut.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {data.total > PAGE_SIZE && (
            <div className="ps-table-foot">
              <Pagination
                total={data.total}
                limit={PAGE_SIZE}
                offset={offset}
                onOffsetChange={setOffset}
              />
            </div>
          )}
        </div>
      )}

      {rejectingId && (
        <ReasonDialog
          title={t("orphans.actions.rejectReason")}
          placeholder={t("orphans.actions.rejectReasonPlaceholder")}
          submitLabel={t("orphans.actions.rejectSubmit")}
          isSubmitting={rejectMut.isPending}
          onCancel={() => setRejectingId(null)}
          onSubmit={(reason) => rejectMut.mutate({ id: rejectingId, reason })}
        />
      )}
    </div>
  );
}

function OrphanRow({
  orphan: o,
  lang,
  isAdmin,
  isApprover,
  selected,
  onToggle,
  onApprove,
  onReject,
  approveDisabled,
  rejectDisabled,
}: {
  orphan: Orphan;
  lang: string;
  isAdmin: boolean;
  isApprover: boolean;
  selected: boolean;
  onToggle: (checked: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  approveDisabled: boolean;
  rejectDisabled: boolean;
}) {
  const { t } = useTranslation();
  const age = ageFromDob(o.date_of_birth);
  const pill = STATUS_PILL[o.case_status] ?? "archived";
  const showApproveReject = isApprover && o.case_status === "pending_review";
  return (
    <tr className={selected ? "selected" : undefined}>
      {isAdmin && (
        <td>
          <input
            type="checkbox"
            className="ps-row-check"
            aria-label={`select-${o.code}`}
            checked={selected}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </td>
      )}
      <td>
        <Link to={`/admin/orphans/${o.id}`} className="ps-cell-code">
          {o.code}
        </Link>
      </td>
      <td>
        <Link to={`/admin/orphans/${o.id}`} className="ps-cell-orphan">
          <span className="ps-orphan-photo" aria-hidden="true">
            {initial(o.first_name)}
          </span>
          <span className="ps-cell-orphan-text">
            <span className="ps-cell-orphan-name">
              {o.first_name} {o.family_name}
            </span>
            <span className="ps-cell-orphan-extra tabular-nums">{o.date_of_birth}</span>
          </span>
        </Link>
      </td>
      <td className="ps-cell-num">
        {age === null ? "—" : age.toLocaleString(lang)}
      </td>
      <td>{o.gender === "M" ? t("orphans.male") : t("orphans.female")}</td>
      <td>
        <span className={`ps-status-pill ${pill}`}>
          <span className="dot" aria-hidden="true" />
          {t(`orphans.caseStatus.${o.case_status}`, o.case_status)}
        </span>
      </td>
      <td>
        <span className={`ps-kafala-pill${o.is_sponsored ? "" : " none"}`}>
          {o.is_sponsored ? t("orphans.sponsored") : t("orphans.notSponsored")}
        </span>
      </td>
      <td className="ps-action-cell">
        {showApproveReject && (
          <>
            <button
              type="button"
              aria-label={t("orphans.actions.approve")}
              className="ps-row-approve"
              onClick={onApprove}
              disabled={approveDisabled}
            >
              {t("orphans.actions.approve")}
            </button>
            <button
              type="button"
              aria-label={t("orphans.actions.reject")}
              className="ps-row-reject"
              onClick={onReject}
              disabled={rejectDisabled}
            >
              {t("orphans.actions.reject")}
            </button>
          </>
        )}
        <Link
          to={`/admin/orphans/${o.id}`}
          className="ps-row-action"
          aria-label={t("orphans.view")}
        >
          {ICON_EYE}
        </Link>
      </td>
    </tr>
  );
}

interface ReasonDialogProps {
  title: string;
  placeholder: string;
  submitLabel: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

function ReasonDialog({
  title,
  placeholder,
  submitLabel,
  isSubmitting,
  onCancel,
  onSubmit,
}: ReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      setError(t("common.required"));
      return;
    }
    if (trimmed.length > 1000) {
      setError(t("common.required"));
      return;
    }
    setError(null);
    onSubmit(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="ps-modal-overlay"
      onClick={onCancel}
    >
      <div className="ps-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <textarea
          rows={4}
          autoFocus
          maxLength={1000}
          placeholder={placeholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <p className="ps-modal-error">{error}</p>}
        <div className="ps-modal-actions">
          <button
            type="button"
            className="ps-btn"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="ps-modal-submit"
            onClick={submit}
            disabled={isSubmitting}
          >
            {isSubmitting ? t("common.saving") : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
