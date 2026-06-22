import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  attachGuardianDocument,
  attachOrphanDocument,
  type DocumentAttachInput,
  type DocumentRead,
  type DocumentType,
  type FileUploadResponse,
  getDocumentUrl,
  listGuardianDocuments,
  listOrphanDocuments,
  uploadFile,
  verifyDocument,
} from "@/lib/documents";
import { toast } from "@/store/toasts";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_BYTES = 10 * 1024 * 1024;

const DOC_TYPES: DocumentType[] = [
  "birth_certificate",
  "death_certificate",
  "national_id",
  "passport",
  "bank_statement",
  "school_certificate",
  "medical_report",
  "photo_id",
  "family_record",
  "custody_declaration",
  "inheritance_decree",
  "dwelling_photo",
  "displacement_proof",
  "other",
];

type Target =
  | { kind: "orphan"; orphanId: string }
  | { kind: "guardian"; guardianId: string };

export function DocumentUploadCard(props: { target: Target }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { target } = props;

  const queryKey =
    target.kind === "orphan"
      ? (["orphan", target.orphanId, "documents"] as const)
      : (["guardian", target.guardianId, "documents"] as const);

  const docsQ = useQuery({
    queryKey,
    queryFn: () =>
      target.kind === "orphan"
        ? listOrphanDocuments(target.orphanId)
        : listGuardianDocuments(target.guardianId),
  });

  const [stagedFile, setStagedFile] = useState<FileUploadResponse | null>(null);
  const [docType, setDocType] = useState<DocumentType>("other");
  const [title, setTitle] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setStagedFile(null);
    setDocType("other");
    setTitle("");
    setIssuingAuthority("");
    setIssueDate("");
    setExpiryDate("");
    setServerError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const uploadM = useMutation({
    mutationFn: (f: File) => uploadFile(f),
    onSuccess: (res) => {
      setStagedFile(res);
      setServerError(null);
    },
    onError: (err) => setServerError(extractMsg(err)),
  });

  const attachM = useMutation({
    mutationFn: async (input: DocumentAttachInput): Promise<DocumentRead> => {
      return target.kind === "orphan"
        ? attachOrphanDocument(target.orphanId, input)
        : attachGuardianDocument(target.guardianId, input);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
      toast.success(t("documents.attached"));
      resetForm();
    },
    onError: (err) => setServerError(extractMsg(err)),
  });

  const verifyM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "verified" | "rejected" }) =>
      verifyDocument(id, status),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(extractMsg(err)),
  });

  // Fetch a short-lived presigned URL and open it in a new tab so reviewers
  // can inspect the file (often a PDF) before verifying.
  const viewM = useMutation({
    mutationFn: (id: string) => getDocumentUrl(id),
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener");
    },
    onError: (err) => toast.error(extractMsg(err)),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setServerError(null);
    if (f.size > MAX_BYTES) {
      setServerError(t("documents.tooLarge"));
      return;
    }
    uploadM.mutate(f);
  }

  function handleAttach() {
    if (!stagedFile) return;
    attachM.mutate({
      document_type: docType,
      title: title.trim() || undefined,
      file_url: stagedFile.file_url,
      file_name: stagedFile.file_name,
      file_size_bytes: stagedFile.file_size_bytes,
      file_mime_type: stagedFile.file_mime_type,
      issue_date: issueDate || undefined,
      expiry_date: expiryDate || undefined,
      issuing_authority: issuingAuthority.trim() || undefined,
    });
  }

  return (
    <div className="card space-y-4" data-testid="documents-card">
      <h2 className="text-lg font-semibold">{t("documents.title")}</h2>

      <div className="rounded-lg border border-sky bg-snow p-3">
        <p className="mb-2 text-sm font-medium text-slate-700">
          {t("documents.stepOne")}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="block w-full text-sm"
          onChange={handleFileChange}
          disabled={uploadM.isPending || !!stagedFile}
          data-testid="documents-file-input"
        />
        {uploadM.isPending && (
          <p className="mt-2 text-xs text-slate-500">{t("documents.uploading")}</p>
        )}
        {stagedFile && (
          <p className="mt-2 text-xs text-emerald-700" data-testid="documents-staged">
            ✓ {stagedFile.file_name} · {Math.round(stagedFile.file_size_bytes / 1024)} KB
          </p>
        )}
      </div>

      {stagedFile && (
        <div className="rounded-lg border border-sky bg-snow p-3 space-y-3">
          <p className="text-sm font-medium text-slate-700">
            {t("documents.stepTwo")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t("documents.type")}
              </span>
              <select
                className="input"
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocumentType)}
                data-testid="documents-type"
              >
                {DOC_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {t(`documents.types.${dt}`, dt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t("documents.fieldTitle")}
              </span>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                data-testid="documents-title"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t("documents.issuingAuthority")}
              </span>
              <input
                className="input"
                value={issuingAuthority}
                onChange={(e) => setIssuingAuthority(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t("documents.issueDate")}
              </span>
              <input
                type="date"
                className="input"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                {t("documents.expiryDate")}
              </span>
              <input
                type="date"
                className="input"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={handleAttach}
              disabled={attachM.isPending}
              data-testid="documents-attach"
            >
              {attachM.isPending ? t("common.saving") : t("documents.attach")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
              onClick={resetForm}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {serverError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{serverError}</p>
      )}

      {docsQ.data && docsQ.data.items.length === 0 && (
        <p className="text-sm text-slate-500">{t("documents.empty")}</p>
      )}

      {docsQ.data && docsQ.data.items.length > 0 && (
        <ul className="space-y-2" data-testid="documents-list">
          {docsQ.data.items.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-sky bg-snow px-3 py-2 text-sm"
            >
              <div className="flex-1">
                <p className="font-medium">
                  {d.title ?? t(`documents.types.${d.document_type}`, d.document_type)}
                </p>
                <p className="text-xs text-slate-500">
                  {d.file_name} · {t(`documents.types.${d.document_type}`, d.document_type)}
                  {d.issuing_authority && ` · ${d.issuing_authority}`}
                </p>
              </div>
              <VerificationBadge status={d.verification_status} />
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded border border-sky px-2 py-1 text-xs text-slate-700 hover:bg-tranquil"
                  onClick={() => viewM.mutate(d.id)}
                  disabled={viewM.isPending && viewM.variables === d.id}
                >
                  {t("documents.view")}
                </button>
                {d.verification_status === "pending" && (
                  <>
                    <button
                      type="button"
                      className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                      onClick={() =>
                        verifyM.mutate({ id: d.id, status: "verified" })
                      }
                    >
                      {t("documents.verify")}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      onClick={() =>
                        verifyM.mutate({ id: d.id, status: "rejected" })
                      }
                    >
                      {t("documents.reject")}
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerificationBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const cls =
    status === "verified"
      ? "bg-emerald-100 text-emerald-800"
      : status === "rejected"
      ? "bg-red-100 text-red-800"
      : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs ${cls}`}>
      {t(`documents.status.${status}`, { defaultValue: status })}
    </span>
  );
}

function extractMsg(err: unknown): string {
  if (err instanceof AxiosError) {
    return err.response?.data?.detail ?? err.message;
  }
  return (err as Error).message ?? "error";
}
