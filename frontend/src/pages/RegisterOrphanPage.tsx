import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { listOrphanages } from "@/lib/orphanages";
import { createOrphan, type OrphanCreateInput } from "@/lib/orphans";
import { listPartners } from "@/lib/partners";
import { toast } from "@/store/toasts";

import "./RegisterOrphanPage.css";

// PS-03 collects a multi-step file (father, family/guardian, economic/health,
// documents). Only the fields below exist in the create-orphan data model, so
// this form renders the mockup's "basic data" step faithfully and reuses the
// existing createOrphan mutation — it never fabricates inputs for child data
// the backend can't yet store. Remaining details are added from the case page
// after the record exists.
// TODO(backend): a single-call multi-section intake (deceased-father, guardian,
// economic/health) needs an extended /orphans payload before those steps land.

// Partner-issued orphan codes look like ORP-12345 / ORF-ABCDE; if the backend
// embeds the existing record's code in a 409 detail, surface a "view existing"
// link so staff can jump straight to the duplicate.
const ORPHAN_CODE_PATTERN = /\bOR[FP]-[A-Z0-9]{3,}\b/;

const schema = z.object({
  first_name: z.string().trim().min(1),
  family_name: z.string().trim().min(1),
  date_of_birth: z.string().min(4),
  gender: z.enum(["M", "F"]),
  partner_organization_id: z.string().uuid(),
  // Required domain field — an orphan is defined by their father (matches the
  // shared NewOrphanForm and the OrphanCreate API contract).
  father_name: z.string().trim().min(1),
  nationality: z
    .string()
    .length(2)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Optional dar (orphanage) assignment — empty = family home.
  orphanage_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type FormValues = z.infer<typeof schema>;

const ICON = {
  back: <polyline points="9 18 15 12 9 6" />,
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  check: <polyline points="20 6 9 17 4 12" />,
};

function Icon({ children, sm = true }: { children: ReactNode; sm?: boolean }) {
  return (
    <svg className={`ps-icon${sm ? " ps-icon-sm" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function RegisterOrphanPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateCode, setDuplicateCode] = useState<string | null>(null);

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: () => listPartners(),
  });
  const partners = partnersQuery.data?.items ?? [];

  const orphanagesQuery = useQuery({
    queryKey: ["orphanages"],
    queryFn: () => listOrphanages({ limit: 100 }),
  });
  const orphanages = orphanagesQuery.data?.items ?? [];

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { gender: "M" },
  });

  const mutation = useMutation({
    mutationFn: (v: OrphanCreateInput) => createOrphan(v),
    onSuccess: async (created) => {
      toast.success(t("common.save"));
      navigate(`/admin/orphans/${created.id}`);
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        const detail = err.response?.data?.detail;
        if (status === 409) {
          setDuplicateError(
            typeof detail === "string" ? detail : t("orphans.register.duplicate"),
          );
          const match = typeof detail === "string" ? detail.match(ORPHAN_CODE_PATTERN) : null;
          setDuplicateCode(match ? match[0] : null);
          return;
        }
        setServerError(typeof detail === "string" ? detail : t("common.createError"));
      } else {
        setServerError(t("common.createError"));
      }
    },
  });

  function submit(v: FormValues) {
    setServerError(null);
    setDuplicateError(null);
    setDuplicateCode(null);
    const payload: OrphanCreateInput = {
      first_name: v.first_name,
      family_name: v.family_name,
      date_of_birth: v.date_of_birth,
      gender: v.gender,
      partner_organization_id: v.partner_organization_id,
      father_name: v.father_name,
      ...(v.nationality ? { nationality: v.nationality } : {}),
      ...(v.orphanage_id ? { orphanage_id: v.orphanage_id } : {}),
    };
    mutation.mutate(payload);
  }

  return (
    <div className="ps-register">
      <div className="ps-reg-header">
        <div className="ps-reg-titles">
          <h1>{t("orphans.register.title")}</h1>
          <p>{t("orphans.register.subtitle")}</p>
        </div>
        <Link to="/admin/orphans" className="ps-reg-back">
          <Icon>{ICON.back}</Icon>
          {t("orphans.register.back")}
        </Link>
      </div>

      <div className="ps-reg-panel">
        <div className="ps-reg-head">
          <h2>
            <Icon>{ICON.user}</Icon>
            {t("orphans.register.sectionBasic")}
          </h2>
          <p>{t("orphans.register.sectionBasicDesc")}</p>
        </div>

        <form className="ps-reg-form" onSubmit={handleSubmit(submit)} noValidate>
          {duplicateError && (
            <div className="ps-dup-result" role="alert">
              <span className="ps-dup-icon" aria-hidden="true">
                <Icon>{ICON.info}</Icon>
              </span>
              <div className="ps-dup-text">
                <div className="ps-dup-title">{t("orphans.register.duplicate")}</div>
                <div className="ps-dup-sub">{duplicateError}</div>
              </div>
              {duplicateCode && (
                <Link
                  to={`/admin/orphans?q=${encodeURIComponent(duplicateCode)}`}
                  className="ps-dup-btn"
                >
                  {t("orphans.register.viewExisting")} ({duplicateCode})
                </Link>
              )}
            </div>
          )}

          {/* ── Name ─────────────────────────────────────────── */}
          <div className="ps-section-title">
            <Icon>{ICON.user}</Icon>
            {t("orphans.register.sectionName")}
          </div>
          <div className="ps-field-grid">
            <div className="ps-field">
              <label htmlFor="first_name">
                {t("orphans.firstName")} <span className="ps-req" aria-hidden="true">*</span>
              </label>
              <input
                id="first_name"
                autoComplete="off"
                aria-invalid={errors.first_name ? true : undefined}
                aria-describedby={errors.first_name ? "first_name-err" : undefined}
                {...register("first_name")}
              />
              {errors.first_name && (
                <p className="ps-field-err" id="first_name-err">
                  {t("common.required")}
                </p>
              )}
            </div>
            <div className="ps-field">
              <label htmlFor="father_name">
                {t("orphans.fatherName")} <span className="ps-req" aria-hidden="true">*</span>
              </label>
              <input
                id="father_name"
                autoComplete="off"
                aria-invalid={errors.father_name ? true : undefined}
                aria-describedby={errors.father_name ? "father_name-err" : undefined}
                {...register("father_name")}
              />
              {errors.father_name && (
                <p className="ps-field-err" id="father_name-err">
                  {t("common.required")}
                </p>
              )}
            </div>
            <div className="ps-field">
              <label htmlFor="family_name">
                {t("orphans.familyName")} <span className="ps-req" aria-hidden="true">*</span>
              </label>
              <input
                id="family_name"
                autoComplete="off"
                aria-invalid={errors.family_name ? true : undefined}
                aria-describedby={errors.family_name ? "family_name-err" : undefined}
                {...register("family_name")}
              />
              {errors.family_name && (
                <p className="ps-field-err" id="family_name-err">
                  {t("common.required")}
                </p>
              )}
            </div>
          </div>

          {/* ── Personal information ─────────────────────────── */}
          <div className="ps-section-title">{t("orphans.register.sectionPersonal")}</div>
          <div className="ps-field-grid">
            <div className="ps-field">
              <label htmlFor="date_of_birth">
                {t("orphans.dateOfBirth")} <span className="ps-req" aria-hidden="true">*</span>
              </label>
              <input
                id="date_of_birth"
                type="date"
                className="latin"
                aria-invalid={errors.date_of_birth ? true : undefined}
                aria-describedby={errors.date_of_birth ? "dob-err" : undefined}
                {...register("date_of_birth")}
              />
              {errors.date_of_birth && (
                <p className="ps-field-err" id="dob-err">
                  {t("common.required")}
                </p>
              )}
            </div>
            <div className="ps-field">
              <span className="ps-field-label" id="gender-label">
                {t("orphans.gender")} <span className="ps-req" aria-hidden="true">*</span>
              </span>
              <div className="ps-radio-pills" role="radiogroup" aria-labelledby="gender-label">
                <label className="ps-radio-pill">
                  <input type="radio" value="F" {...register("gender")} />
                  <span>{t("orphans.female")}</span>
                </label>
                <label className="ps-radio-pill">
                  <input type="radio" value="M" {...register("gender")} />
                  <span>{t("orphans.male")}</span>
                </label>
              </div>
            </div>
            <div className="ps-field">
              <label htmlFor="nationality">{t("orphans.nationality")}</label>
              <input
                id="nationality"
                className="latin"
                placeholder="KW"
                maxLength={2}
                aria-describedby="nationality-hint"
                {...register("nationality")}
              />
              <p className="ps-field-hint" id="nationality-hint">
                {t("orphans.register.nationalityHint")}
              </p>
            </div>
          </div>

          {/* ── Organization ─────────────────────────────────── */}
          <div className="ps-section-title">{t("orphans.register.sectionOrg")}</div>
          <div className="ps-field-grid">
            <div className="ps-field full">
              <label htmlFor="partner_organization_id">
                {t("orphans.partner")} <span className="ps-req" aria-hidden="true">*</span>
              </label>
              <select
                id="partner_organization_id"
                aria-invalid={errors.partner_organization_id ? true : undefined}
                aria-describedby={
                  errors.partner_organization_id ? "partner-err" : undefined
                }
                defaultValue=""
                {...register("partner_organization_id")}
              >
                <option value="" disabled>
                  {t("orphans.selectPartner")}
                </option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {i18n.language === "ar" ? p.name_ar : p.name_en ?? p.name_ar}
                  </option>
                ))}
              </select>
              {errors.partner_organization_id && (
                <p className="ps-field-err" id="partner-err">
                  {t("common.required")}
                </p>
              )}
            </div>
            <div className="ps-field full">
              <label htmlFor="orphanage_id">{t("orphans.orphanage.label")}</label>
              <select id="orphanage_id" defaultValue="" {...register("orphanage_id")}>
                <option value="">{t("orphans.orphanage.familyHome")}</option>
                {orphanages.map((o) => (
                  <option key={o.id} value={o.id}>
                    {i18n.language === "ar" ? o.name_ar : o.name_en ?? o.name_ar}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {serverError && (
            <p className="ps-reg-error" role="alert">
              {serverError}
            </p>
          )}

          {/* Privacy reassurance — a new case stays in review and is never
              shown to donors until a manager approves it. */}
          <div className="ps-reg-note">
            <Icon>{ICON.shield}</Icon>
            <span>{t("orphans.register.privacyNote")}</span>
          </div>

          <div className="ps-reg-foot">
            <Link to="/admin/orphans" className="ps-reg-cancel">
              {t("common.cancel")}
            </Link>
            <button type="submit" className="ps-reg-submit" disabled={isSubmitting}>
              <Icon>{ICON.check}</Icon>
              {isSubmitting ? t("common.saving") : t("orphans.register.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
