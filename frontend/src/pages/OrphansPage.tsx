import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import { Pagination } from "@/components/Pagination";
import { TableSkeleton } from "@/components/Skeleton";
import { useRole } from "@/hooks/useRole";
import {
  approveOrphan,
  archiveOrphan,
  exportOrphansCsv,
  listOrphans,
  rejectOrphan,
} from "@/lib/orphans";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

const PAGE_SIZE = 20;

const orphanQueryKey = (q: string, caseStatus: string, offset: number) =>
  ["orphans", { limit: PAGE_SIZE, offset, q, caseStatus }] as const;

const CASE_STATUS_OPTIONS = [
  "",
  "pending_review",
  "approved",
  "available",
  "reserved",
  "sponsored",
  "graduated",
] as const;

export function OrphansPage() {
  const { t } = useTranslation();
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
  }, [debouncedSearch, caseStatus]);

  // Clear bulk selection when the filter / page changes — selected IDs
  // would otherwise refer to rows that aren't visible anymore.
  useEffect(() => {
    setSelected(new Set());
  }, [debouncedSearch, caseStatus, offset]);

  function onCaseStatusChange(next: string) {
    setCaseStatus(next);
    const sp = new URLSearchParams(searchParams);
    if (next) sp.set("status", next);
    else sp.delete("status");
    setSearchParams(sp, { replace: true });
  }

  const queryKey = orphanQueryKey(debouncedSearch, caseStatus, offset);
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () =>
      listOrphans({
        limit: PAGE_SIZE,
        offset,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        ...(caseStatus ? { case_status: caseStatus } : {}),
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("orphans.title")}</h1>
          {isApprovalView && (
            <p className="text-sm text-gray-500">
              {t("orphans.subtitle.approvals")}
            </p>
          )}
        </div>
        <div className="flex flex-1 items-center justify-end gap-4">
          <input
            type="search"
            className="input max-w-xs"
            placeholder={t("orphans.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <select
            className="input max-w-[10rem]"
            value={caseStatus}
            onChange={(e) => onCaseStatusChange(e.target.value)}
          >
            {CASE_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "" ? t("orphans.allStatuses") : t(`orphans.caseStatus.${s}`, s)}
              </option>
            ))}
          </select>
          {data && (
            <span className="text-sm text-gray-500">
              {t("common.total")}: {data.total.toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil"
            onClick={async () => {
              try {
                const blob = await exportOrphansCsv(
                  caseStatus ? { case_status: caseStatus } : {},
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "rufaqaa-orphans.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch {
                toast.error(t("common.loadError"));
              }
            }}
          >
            {t("orphans.exportCsv")}
          </button>
          {(isPartner || isAdmin) && (
            <Link
              to="/admin/orphans/new"
              className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil"
            >
              {t("nav.registerOrphan")}
            </Link>
          )}
          {(isPartner || isAdmin) && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? t("common.cancel") : t("orphans.addNew")}
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <NewOrphanForm
          partners={partners?.items ?? []}
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey });
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {isLoading && <TableSkeleton columns={6} />}
      {error && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
          {t("common.loadError")}
        </p>
      )}

      {data && data.items.length === 0 && (
        <div className="card text-center text-gray-500">{t("common.empty")}</div>
      )}

      {data && (
        <Pagination
          total={data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
        />
      )}

      {data && data.items.length > 0 && (
        <>
          {/* Bulk-archive is admin-only — partner staff/managers don't get it. */}
          {isAdmin && selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-trust bg-tranquil/40 px-4 py-2 text-sm">
              <span className="font-medium text-trust">
                {t("orphans.bulkSelected", { count: selected.size })}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-sky px-3 py-1 text-gray-700 hover:bg-snow"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkBusy}
                >
                  {t("orphans.bulkClear")}
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-danger-600 px-3 py-1 text-white hover:bg-danger-700 disabled:opacity-50"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        t("orphans.bulkArchiveConfirm", { count: selected.size }),
                      )
                    ) {
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
                    if (fail === 0) {
                      toast.success(t("orphans.bulkArchiveDone", { ok }));
                    } else {
                      toast.error(
                        t("orphans.bulkArchivePartial", { ok, fail }),
                      );
                    }
                  }}
                  disabled={bulkBusy}
                >
                  {bulkBusy
                    ? t("common.saving")
                    : t("orphans.bulkArchive")}
                </button>
              </div>
            </div>
          )}

          <div className="card overflow-x-auto p-0">
            <table className="min-w-full text-start">
              <thead className="border-b border-sky bg-tranquil/40 text-sm text-gray-700">
                <tr>
                  {isAdmin && (
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label="select-all"
                        checked={
                          data.items.length > 0 &&
                          data.items.every((o) => selected.has(o.id))
                        }
                        onChange={(e) => {
                          const next = new Set(selected);
                          if (e.target.checked) {
                            data.items.forEach((o) => next.add(o.id));
                          } else {
                            data.items.forEach((o) => next.delete(o.id));
                          }
                          setSelected(next);
                        }}
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">{t("orphans.code")}</th>
                  <th className="px-4 py-3 font-medium">{t("orphans.name")}</th>
                  <th className="px-4 py-3 font-medium">{t("orphans.dateOfBirth")}</th>
                  <th className="px-4 py-3 font-medium">{t("orphans.gender")}</th>
                  <th className="px-4 py-3 font-medium">{t("orphans.status")}</th>
                  {isPartnerApprover && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-sky/40 text-sm">
                {data.items.map((o) => (
                  <tr
                    key={o.id}
                    className={`hover:bg-snow ${
                      selected.has(o.id) ? "bg-tranquil/30" : ""
                    }`}
                  >
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`select-${o.code}`}
                          checked={selected.has(o.id)}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(o.id);
                            else next.delete(o.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link to={`/admin/orphans/${o.id}`} className="text-trust hover:underline">
                        {o.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {o.first_name} {o.family_name}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{o.date_of_birth}</td>
                    <td className="px-4 py-3">
                      {o.gender === "M" ? t("orphans.male") : t("orphans.female")}
                    </td>
                    <td className="px-4 py-3">
                      {t(`orphans.caseStatus.${o.case_status}`, o.case_status)}
                    </td>
                    {isPartnerApprover && (
                      <td className="px-4 py-3 text-end">
                        {o.case_status === "pending_review" && (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              aria-label={t("orphans.actions.approve")}
                              className="rounded-lg bg-success-600 px-3 py-1 text-xs text-white hover:bg-success-700 disabled:opacity-50"
                              onClick={() => approveMut.mutate(o.id)}
                              disabled={approveMut.isPending}
                            >
                              {t("orphans.actions.approve")}
                            </button>
                            <button
                              type="button"
                              aria-label={t("orphans.actions.reject")}
                              className="rounded-lg bg-danger-600 px-3 py-1 text-xs text-white hover:bg-danger-700 disabled:opacity-50"
                              onClick={() => setRejectingId(o.id)}
                              disabled={rejectMut.isPending}
                            >
                              {t("orphans.actions.reject")}
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold">{title}</h2>
        <textarea
          className="input"
          rows={4}
          autoFocus
          maxLength={1000}
          placeholder={placeholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-1 text-sm text-gray-700 hover:bg-tranquil"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-danger-600 px-3 py-1 text-sm text-white hover:bg-danger-700 disabled:opacity-50"
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
