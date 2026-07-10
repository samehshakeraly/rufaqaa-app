import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { TableSkeleton } from "@/components/Skeleton";
import { countryOptions, flagEmoji } from "@/lib/countries";
import {
  createOrphanage,
  listOrphanages,
  ORPHANAGE_STATUSES,
  updateOrphanage,
  type Orphanage,
  type OrphanageStatus,
} from "@/lib/orphanages";
import { listUsers, type AdminUser } from "@/lib/users";
import { toast } from "@/store/toasts";

import "./adminEntities.css";

const QK = ["orphanages"] as const;
const MANAGERS_QK = ["users", "orphanage_manager"] as const;

// Display name for a manager option / cell — full name, falling back to email.
function managerLabel(u: AdminUser): string {
  const full = `${u.first_name} ${u.last_name}`.trim();
  return full || u.email;
}

// adm-status pill variants, keyed by the dar's lifecycle status.
const STATUS_VARIANT: Record<OrphanageStatus, string> = {
  active: "success",
  inactive: "warning",
  archived: "danger",
};

export function OrphanagesPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const isAr = i18n.language.startsWith("ar");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Orphanage | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listOrphanages({ limit: 100 }),
  });

  // The org's orphanage managers — drives the picker and resolves the name
  // shown in the list. Shared (one query) across the page and both modals.
  const { data: managersData } = useQuery({
    queryKey: MANAGERS_QK,
    queryFn: () => listUsers({ role: "orphanage_manager", limit: 100 }),
  });
  const managers = useMemo(() => managersData?.items ?? [], [managersData]);
  const managerById = useMemo(
    () => new Map(managers.map((m) => [m.id, m])),
    [managers],
  );

  const dfmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  return (
    <div className="adm">
      <div className="adm-head">
        <h1>{t("orphanages.title")}</h1>
        <div className="adm-head-actions">
          {data && (
            <span className="adm-total">
              {t("common.total")}: <span className="latin">{data.total.toLocaleString()}</span>
            </span>
          )}
          <button
            type="button"
            className="adm-btn adm-btn-primary"
            onClick={() => setShowCreate(true)}
          >
            {t("orphanages.create.title")}
          </button>
        </div>
      </div>

      {isLoading && <TableSkeleton columns={8} />}
      {error && <p className="adm-error">{t("common.loadError")}</p>}
      {data && data.items.length === 0 && <div className="adm-empty">{t("common.empty")}</div>}

      {data && data.items.length > 0 && (
        <div className="adm-table-card">
          <div className="adm-table-wrap">
            <table className="adm-t">
              <thead>
                <tr>
                  <th>{t("orphanages.cols.code")}</th>
                  <th>{t("orphanages.cols.name")}</th>
                  <th>{t("orphanages.cols.country")}</th>
                  <th>{t("orphanages.cols.capacity")}</th>
                  <th>{t("orphanages.cols.manager")}</th>
                  <th>{t("orphanages.cols.status")}</th>
                  <th>{t("orphanages.cols.createdAt")}</th>
                  <th className="end">{t("orphanages.cols.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="adm-cell-code">{o.code}</span>
                    </td>
                    <td className="adm-cell-strong">{isAr ? o.name_ar : o.name_en}</td>
                    <td>
                      {o.country_code ? (
                        <>
                          <span aria-hidden="true">{flagEmoji(o.country_code)} </span>
                          <span className="latin">{o.country_code}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {o.capacity != null ? (
                        <span className="latin">{o.capacity.toLocaleString()}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {o.manager_user_id && managerById.has(o.manager_user_id) ? (
                        managerLabel(managerById.get(o.manager_user_id)!)
                      ) : (
                        <span className="adm-cell-muted">{t("orphanages.manager.none")}</span>
                      )}
                    </td>
                    <td>
                      <span className={`adm-status ${STATUS_VARIANT[o.status]}`}>
                        <span className="dot" />
                        {t(`orphanages.status.${o.status}`)}
                      </span>
                    </td>
                    <td className="adm-cell-muted latin">
                      {dfmt.format(new Date(o.created_at))}
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        <button
                          type="button"
                          className="adm-row-btn"
                          onClick={() => setEditing(o)}
                        >
                          {t("orphanages.edit.title")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrphanageModal
          managers={managers}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            await invalidate();
            setShowCreate(false);
          }}
        />
      )}
      {editing && (
        <EditOrphanageModal
          orphanage={editing}
          managers={managers}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await invalidate();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ── Shared form state + payload mapping ───────────────────────────────

interface FormState {
  name_ar: string;
  name_en: string;
  country_code: string;
  governorate: string;
  city: string;
  district: string;
  address_details: string;
  status: OrphanageStatus;
  capacity: string; // "" = not recorded (null)
  notes: string;
  manager_user_id: string; // "" = no manager
}

const EMPTY_FORM: FormState = {
  name_ar: "",
  name_en: "",
  country_code: "KW",
  governorate: "",
  city: "",
  district: "",
  address_details: "",
  status: "active",
  capacity: "",
  notes: "",
  manager_user_id: "",
};

// Trim + collapse empty optional strings to null so we never persist "".
function toPayload(v: FormState) {
  const opt = (s: string): string | null => {
    const trimmed = s.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    name_ar: v.name_ar.trim(),
    name_en: v.name_en.trim(),
    country_code: opt(v.country_code),
    governorate: opt(v.governorate),
    city: opt(v.city),
    district: opt(v.district),
    address_details: opt(v.address_details),
    status: v.status,
    // Empty → null so "not recorded" round-trips as NULL, never 0.
    capacity: v.capacity.trim() === "" ? null : Number(v.capacity),
    notes: opt(v.notes),
  };
}

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const d = err.response?.data?.detail;
    if (typeof d === "string") return d;
  }
  return fallback;
}

// ── Modal shell ───────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="adm-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="adm-modal">
        <div className="adm-modal-head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} className="adm-modal-close" aria-label={title}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Field labels are shared between create + edit (only the modal title,
// submit label and toast differ), so both forms render this block.
function OrphanageFields({
  v,
  setV,
  managers,
}: {
  v: FormState;
  setV: (next: FormState) => void;
  managers: AdminUser[];
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="adm-form-grid">
      <label className="adm-field">
        <span>{t("orphanages.create.nameAr")}</span>
        <input required value={v.name_ar} onChange={(e) => setV({ ...v, name_ar: e.target.value })} />
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.nameEn")}</span>
        <input required value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} />
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.country")}</span>
        <select
          value={v.country_code}
          onChange={(e) => setV({ ...v, country_code: e.target.value })}
        >
          <option value="">—</option>
          {countryOptions(i18n.language).map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.status")}</span>
        <select
          value={v.status}
          onChange={(e) => setV({ ...v, status: e.target.value as OrphanageStatus })}
        >
          {ORPHANAGE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`orphanages.status.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.manager")}</span>
        <select
          value={v.manager_user_id}
          onChange={(e) => setV({ ...v, manager_user_id: e.target.value })}
        >
          <option value="">{t("orphanages.manager.none")}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {managerLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.governorate")}</span>
        <input
          value={v.governorate}
          onChange={(e) => setV({ ...v, governorate: e.target.value })}
        />
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.city")}</span>
        <input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} />
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.district")}</span>
        <input value={v.district} onChange={(e) => setV({ ...v, district: e.target.value })} />
      </label>
      <label className="adm-field">
        <span>{t("orphanages.create.capacity")}</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          placeholder={t("orphanages.create.capacityPlaceholder")}
          value={v.capacity}
          onChange={(e) => setV({ ...v, capacity: e.target.value })}
        />
      </label>
      <label className="adm-field full">
        <span>{t("orphanages.create.address")}</span>
        <input
          value={v.address_details}
          onChange={(e) => setV({ ...v, address_details: e.target.value })}
        />
      </label>
      <label className="adm-field full">
        <span>{t("orphanages.create.notes")}</span>
        <input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </label>
    </div>
  );
}

// ── Create ────────────────────────────────────────────────────────────

function CreateOrphanageModal({
  managers,
  onClose,
  onCreated,
}: {
  managers: AdminUser[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState<FormState>(EMPTY_FORM);
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    // Omit manager_user_id entirely when none is chosen (vs sending null).
    mutationFn: () =>
      createOrphanage({
        ...toPayload(v),
        ...(v.manager_user_id ? { manager_user_id: v.manager_user_id } : {}),
      }),
    onSuccess: async () => {
      toast.success(t("orphanages.create.created"));
      await onCreated();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell title={t("orphanages.create.title")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
      >
        <OrphanageFields v={v} setV={setV} managers={managers} />
        {serverError && <p className="adm-error">{serverError}</p>}
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn" onClick={onClose} disabled={mut.isPending}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("orphanages.create.submit")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Edit ──────────────────────────────────────────────────────────────

function EditOrphanageModal({
  orphanage,
  managers,
  onClose,
  onSaved,
}: {
  orphanage: Orphanage;
  managers: AdminUser[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isAr = i18n.language.startsWith("ar");
  const [v, setV] = useState<FormState>({
    name_ar: orphanage.name_ar,
    name_en: orphanage.name_en,
    country_code: orphanage.country_code ?? "",
    governorate: orphanage.governorate ?? "",
    city: orphanage.city ?? "",
    district: orphanage.district ?? "",
    address_details: orphanage.address_details ?? "",
    status: orphanage.status,
    capacity: orphanage.capacity != null ? String(orphanage.capacity) : "",
    notes: orphanage.notes ?? "",
    manager_user_id: orphanage.manager_user_id ?? "",
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const mut = useMutation({
    // Empty → null clears the existing assignment (vs omitting it).
    mutationFn: () =>
      updateOrphanage(orphanage.id, {
        ...toPayload(v),
        manager_user_id: v.manager_user_id || null,
      }),
    onSuccess: async () => {
      toast.success(t("orphanages.edit.updated"));
      await onSaved();
    },
    onError: (err) => setServerError(errMsg(err, t("common.createError"))),
  });

  return (
    <ModalShell
      title={`${t("orphanages.edit.title")} — ${isAr ? orphanage.name_ar : orphanage.name_en}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setServerError(null);
          mut.mutate();
        }}
      >
        <OrphanageFields v={v} setV={setV} managers={managers} />
        {serverError && <p className="adm-error">{serverError}</p>}
        <div className="adm-modal-actions">
          <button type="button" className="adm-btn" onClick={onClose} disabled={mut.isPending}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="adm-btn adm-btn-primary" disabled={mut.isPending}>
            {mut.isPending ? t("common.saving") : t("orphanages.edit.submit")}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
