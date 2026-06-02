import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { TableSkeleton } from "@/components/Skeleton";
import {
  createFamily,
  type FamilyCreateInput,
  listFamilies,
} from "@/lib/families";

import "./adminEntities.css";

const QK = ["families"] as const;
const HOUSING_OPTIONS = ["owned", "rented", "donated", "homeless"] as const;

export function FamiliesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: QK,
    queryFn: () => listFamilies({ limit: 100 }),
  });

  return (
    <div className="adm">
      <div className="adm-head">
        <h1>{t("families.title")}</h1>
        <div className="adm-head-actions">
          {data && (
            <span className="adm-total">
              {t("common.total")}: <span className="latin">{data.total.toLocaleString()}</span>
            </span>
          )}
          <button
            type="button"
            className="adm-btn adm-btn-primary"
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? t("common.cancel") : t("families.addNew")}
          </button>
        </div>
      </div>

      {showForm && (
        <NewFamilyForm
          onCreated={async () => {
            await qc.invalidateQueries({ queryKey: QK });
            setShowForm(false);
          }}
        />
      )}

      {isLoading && <TableSkeleton columns={5} />}
      {error && <p className="adm-error">{t("common.loadError")}</p>}

      {data && data.items.length === 0 && (
        <div className="adm-empty">{t("common.empty")}</div>
      )}

      {data && data.items.length > 0 && (
        <div className="adm-table-card">
          <div className="adm-table-wrap">
            <table className="adm-t">
              <thead>
                <tr>
                  <th>{t("families.code")}</th>
                  <th>{t("families.familyName")}</th>
                  <th>{t("families.deceasedFather")}</th>
                  <th>{t("families.country")}</th>
                  <th>{t("families.housing")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <Link to={`/admin/families/${f.id}`} className="adm-link mono">
                        {f.code}
                      </Link>
                    </td>
                    <td className="adm-cell-strong">{f.family_name ?? "—"}</td>
                    <td>{f.deceased_father_name ?? "—"}</td>
                    <td>{f.country_code ?? "—"}</td>
                    <td>
                      {f.housing_status
                        ? t(`families.housingStatus.${f.housing_status}`, f.housing_status)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function NewFamilyForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [v, setV] = useState<FamilyCreateInput>({
    family_name: "",
    deceased_father_name: "",
    country_code: "KW",
    city: "",
    housing_status: "rented",
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => createFamily(v),
    onSuccess: () => {
      setV({
        family_name: "",
        deceased_father_name: "",
        country_code: "KW",
        city: "",
        housing_status: "rented",
      });
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
        mut.mutate();
      }}
      className="adm-card"
    >
      <div className="adm-form-grid">
        <label className="adm-field">
          <span>{t("families.familyName")}</span>
          <input
            value={v.family_name ?? ""}
            onChange={(e) => setV({ ...v, family_name: e.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("families.deceasedFather")}</span>
          <input
            value={v.deceased_father_name ?? ""}
            onChange={(e) => setV({ ...v, deceased_father_name: e.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("families.country")}</span>
          <input
            maxLength={2}
            value={v.country_code ?? ""}
            onChange={(e) => setV({ ...v, country_code: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="adm-field">
          <span>{t("families.city")}</span>
          <input
            value={v.city ?? ""}
            onChange={(e) => setV({ ...v, city: e.target.value })}
          />
        </label>
        <label className="adm-field">
          <span>{t("families.housing")}</span>
          <select
            value={v.housing_status ?? "rented"}
            onChange={(e) =>
              setV({
                ...v,
                housing_status: e.target.value as FamilyCreateInput["housing_status"],
              })
            }
          >
            {HOUSING_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {t(`families.housingStatus.${h}`, h)}
              </option>
            ))}
          </select>
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
