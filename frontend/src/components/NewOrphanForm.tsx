import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";

import { createOrphan, type OrphanCreateInput } from "@/lib/orphans";
import { listPartners } from "@/lib/partners";

// Matches partner-issued orphan codes like ORF-12345 or ORF-ABCDE. The backend
// embeds the existing record's code in the 409 detail string; we surface it as
// a "view existing" link (where the caller allows one — see `duplicateHref`).
const ORPHAN_CODE_PATTERN = /\bORF-[A-Z0-9]{3,}\b/;

// father_name is REQUIRED (domain rule: an orphan is defined by their father).
// partner_organization_id is only collected on the staff path; the guardian
// portal derives it server-side, so it is dropped from validation there.
function makeSchema(requirePartner: boolean) {
  return z.object({
    first_name: z.string().trim().min(1),
    family_name: z.string().trim().min(1),
    date_of_birth: z.string().min(4),
    gender: z.enum(["M", "F"]),
    father_name: z.string().trim().min(1),
    nationality: z
      .string()
      .length(2)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    partner_organization_id: requirePartner
      ? z.string().uuid()
      : z
          .string()
          .uuid()
          .optional()
          .or(z.literal("").transform(() => undefined)),
  });
}

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

/** The subset of a created orphan that both the staff (`Orphan`) and guardian
 * (`GuardianOrphan`) responses share — enough for callers to react to a
 * successful create without coupling the form to either full shape. */
export interface CreatedOrphan {
  id: string;
  code: string;
  case_status: string;
  first_name: string;
  family_name: string;
}

interface NewOrphanFormProps {
  /** Optional partner list. If omitted (and the picker is shown) the form
   * fetches its own. */
  partners?: { id: string; name_ar: string; name_en: string | null }[];
  /** Called on success with the freshly created orphan. */
  onCreated: (orphan: CreatedOrphan) => void | Promise<void>;
  /** Optional cancel handler (e.g. close the inline panel). */
  onCancel?: () => void;
  /** Show the partner picker. Staff: true (default). Guardian: false — the
   * partner is derived from the guardian's family server-side. */
  showPartnerSelect?: boolean;
  /** Create call. Defaults to the staff `createOrphan` (POST /orphans); the
   * guardian portal injects `createMyOrphan` (POST /guardian/me/orphans). */
  submitFn?: (payload: OrphanCreateInput) => Promise<CreatedOrphan>;
  /** Resolve the "view existing" duplicate link target from the existing code.
   * Return null to show the message without a link (e.g. guardians, who have
   * no code-search screen). Defaults to the staff admin search. */
  duplicateHref?: (code: string) => string | null;
}

export function NewOrphanForm({
  partners: partnersProp,
  onCreated,
  onCancel,
  showPartnerSelect = true,
  submitFn,
  duplicateHref = (code) => `/admin/orphans?q=${encodeURIComponent(code)}`,
}: NewOrphanFormProps) {
  const { t, i18n } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicateCode, setDuplicateCode] = useState<string | null>(null);

  const partnersQuery = useQuery({
    queryKey: ["partners"],
    queryFn: () => listPartners(),
    enabled: showPartnerSelect && !partnersProp,
  });
  const partners = partnersProp ?? partnersQuery.data?.items ?? [];

  const schema = useMemo(() => makeSchema(showPartnerSelect), [showPartnerSelect]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { gender: "M" },
  });

  const create: (p: OrphanCreateInput) => Promise<CreatedOrphan> = submitFn ?? createOrphan;

  const mutation = useMutation({
    mutationFn: (v: OrphanCreateInput) => create(v),
    onSuccess: async (created) => {
      reset();
      await onCreated(created);
    },
    onError: (err) => {
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        const detail = err.response?.data?.detail;
        if (status === 409) {
          const message = typeof detail === "string" ? detail : t("orphans.register.duplicate");
          setDuplicateError(message);
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
      father_name: v.father_name,
      ...(showPartnerSelect && v.partner_organization_id
        ? { partner_organization_id: v.partner_organization_id }
        : {}),
      ...(v.nationality ? { nationality: v.nationality } : {}),
    };
    mutation.mutate(payload);
  }

  const duplicateLink = duplicateCode ? duplicateHref(duplicateCode) : null;

  return (
    <form onSubmit={handleSubmit(submit)} className="card space-y-4">
      {duplicateError && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
          <span>{duplicateError}</span>
          {duplicateLink && (
            <Link
              to={duplicateLink}
              className="rounded-lg border border-warning-500 bg-white px-2 py-1 text-xs font-medium text-warning-700 hover:bg-warning-50"
            >
              {t("orphans.register.viewExisting")} ({duplicateCode})
            </Link>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("orphans.firstName")} error={errors.first_name?.message}>
          <input className="input" {...register("first_name")} />
        </Field>
        <Field label={t("orphans.familyName")} error={errors.family_name?.message}>
          <input className="input" {...register("family_name")} />
        </Field>
        <Field label={t("orphans.dateOfBirth")} error={errors.date_of_birth?.message}>
          <input type="date" className="input" {...register("date_of_birth")} />
        </Field>
        <Field label={t("orphans.gender")}>
          <select className="input" {...register("gender")}>
            <option value="M">{t("orphans.male")}</option>
            <option value="F">{t("orphans.female")}</option>
          </select>
        </Field>
        <Field label={t("orphans.fatherName")} error={errors.father_name?.message}>
          <input className="input" {...register("father_name")} />
        </Field>
        <Field label={t("orphans.nationality")}>
          <input className="input" placeholder="KW" maxLength={2} {...register("nationality")} />
        </Field>
        {showPartnerSelect && (
          <Field
            label={t("orphans.partner")}
            error={errors.partner_organization_id?.message}
            className="sm:col-span-2"
          >
            <select className="input" {...register("partner_organization_id")}>
              <option value="">{t("orphans.selectPartner")}</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {i18n.language === "ar" ? p.name_ar : (p.name_en ?? p.name_ar)}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {serverError && (
        <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{serverError}</p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={isSubmitting}>
          {isSubmitting ? t("common.saving") : t("common.save")}
        </button>
        {onCancel && (
          <button
            type="button"
            className="rounded-lg border border-sky px-3 py-2 text-sm text-gray-700 hover:bg-tranquil"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {t("common.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      {children}
      {error && <p className="mt-1 text-xs text-danger-700">{error}</p>}
    </label>
  );
}
