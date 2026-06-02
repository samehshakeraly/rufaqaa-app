import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { DocumentUploadCard } from "@/components/DocumentUploadCard";
import {
  createGuardian,
  getFamily,
  type GuardianCreateInput,
  listFamilyGuardians,
} from "@/lib/families";

import "./adminEntities.css";

const RELATIONS = [
  "mother",
  "grandfather",
  "grandmother",
  "uncle",
  "aunt",
  "sibling",
  "other",
] as const;

export function FamilyDetailPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const familyQ = useQuery({
    queryKey: ["family", id],
    queryFn: () => getFamily(id),
    enabled: !!id,
  });
  const guardiansQ = useQuery({
    queryKey: ["family", id, "guardians"],
    queryFn: () => listFamilyGuardians(id),
    enabled: !!id,
  });

  const [showForm, setShowForm] = useState(false);

  if (familyQ.isLoading) {
    return (
      <div className="adm">
        <p className="adm-loading">{t("common.loading")}</p>
      </div>
    );
  }
  if (familyQ.error || !familyQ.data) {
    return (
      <div className="adm">
        <p className="adm-error">{t("common.loadError")}</p>
      </div>
    );
  }
  const f = familyQ.data;

  return (
    <div className="adm">
      <div>
        <Link to="/admin/families" className="adm-back">
          ← {t("families.backToList")}
        </Link>
      </div>

      <div className="adm-card">
        <h1 className="adm-card-title">{f.family_name ?? f.code}</h1>
        <dl className="adm-dl">
          <Row label={t("families.code")} value={f.code} mono />
          <Row label={t("families.deceasedFather")} value={f.deceased_father_name ?? "—"} />
          <Row label={t("families.country")} value={f.country_code ?? "—"} />
          <Row label={t("families.city")} value={f.city ?? "—"} />
          <Row
            label={t("families.housing")}
            value={
              f.housing_status
                ? t(`families.housingStatus.${f.housing_status}`, f.housing_status)
                : "—"
            }
          />
        </dl>
      </div>

      <div className="adm-section">
        <div className="adm-section-head">
          <h2>{t("families.guardians")}</h2>
          <button
            type="button"
            className="adm-btn adm-btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("families.addGuardian")}
          </button>
        </div>

        {showForm && (
          <NewGuardianForm
            familyId={id}
            onCreated={async () => {
              await qc.invalidateQueries({ queryKey: ["family", id, "guardians"] });
              setShowForm(false);
            }}
          />
        )}

        {guardiansQ.isLoading && <p className="adm-loading">{t("common.loading")}</p>}

        {guardiansQ.data && guardiansQ.data.items.length === 0 && (
          <div className="adm-empty">{t("common.empty")}</div>
        )}

        {guardiansQ.data && guardiansQ.data.items.length > 0 && (
          <div className="adm-table-card">
            <div className="adm-table-wrap">
              <table className="adm-t">
                <thead>
                  <tr>
                    <th>{t("families.guardianName")}</th>
                    <th>{t("families.relation")}</th>
                    <th>{t("families.phone")}</th>
                    <th>{t("families.email")}</th>
                  </tr>
                </thead>
                <tbody>
                  {guardiansQ.data.items.map((g) => (
                    <tr key={g.id}>
                      <td className="adm-cell-strong">{g.full_name}</td>
                      <td>{t(`families.relations.${g.relation}`, g.relation)}</td>
                      <td className="latin">{g.phone ?? "—"}</td>
                      <td className="latin">{g.email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {guardiansQ.data && guardiansQ.data.items.length > 0 && (
          <div className="adm-section">
            {guardiansQ.data.items.map((g) => (
              <details key={`docs-${g.id}`} className="adm-details">
                <summary>
                  {t("documents.title")} — {g.full_name}
                </summary>
                <div className="adm-details-body">
                  <DocumentUploadCard target={{ kind: "guardian", guardianId: g.id }} />
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewGuardianForm({
  familyId,
  onCreated,
}: {
  familyId: string;
  onCreated: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState<GuardianCreateInput>({
    full_name: "",
    relation: "mother",
    phone: "",
    email: "",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () =>
      createGuardian(familyId, {
        full_name: v.full_name,
        relation: v.relation,
        ...(v.phone ? { phone: v.phone } : {}),
        ...(v.email ? { email: v.email } : {}),
      }),
    onSuccess: () => {
      setV({ full_name: "", relation: "mother", phone: "", email: "" });
      onCreated();
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        setServerError(err.response?.data?.detail ?? t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setServerError(null);
        if (!v.full_name.trim()) return;
        mut.mutate();
      }}
      className="adm-card"
    >
      <div className="adm-form-grid">
        <label className="adm-field">
          <span>{t("families.guardianName")}</span>
          <input
            value={v.full_name}
            onChange={(e) => setV({ ...v, full_name: e.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("families.relation")}</span>
          <select
            value={v.relation}
            onChange={(e) =>
              setV({ ...v, relation: e.target.value as GuardianCreateInput["relation"] })
            }
          >
            {RELATIONS.map((r) => (
              <option key={r} value={r}>
                {t(`families.relations.${r}`, r)}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>{t("families.phone")}</span>
          <input
            value={v.phone ?? ""}
            onChange={(e) => setV({ ...v, phone: e.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("families.email")}</span>
          <input
            type="email"
            value={v.email ?? ""}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
        </label>
      </div>
      {serverError && <p className="adm-error">{serverError}</p>}
      <div className="adm-form-foot">
        <button type="submit" className="adm-btn adm-btn-primary" disabled={mut.isPending}>
          {mut.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="adm-dt">{label}</dt>
      <dd className={`adm-dd${mono ? " mono" : ""}`}>{value}</dd>
    </div>
  );
}
