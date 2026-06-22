import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { TFunction } from "i18next";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Lightbox } from "@/components/Lightbox";
import { OrphanPhotoUpload } from "@/components/OrphanPhotoUpload";
import { getCountryRequirements } from "@/lib/countries";
import {
  attachOrphanDocument,
  deleteDocument,
  type DocumentRead,
  type DocumentType,
  getDocumentUrl,
  listOrphanDocuments,
  uploadFile,
  verifyDocument,
  type VerificationStatus,
} from "@/lib/documents";
import { toast } from "@/store/toasts";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp";
const ACCEPTED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

// The five guided document slots, in the order the spec lays them out. Each is
// badged Required/Optional against the orphan's country requirements.
const DOC_SLOTS: DocumentType[] = [
  "national_id",
  "birth_certificate",
  "death_certificate",
  "custody_declaration",
  "inheritance_decree",
];

// The "other document" picker covers every remaining DocumentType, so any type
// the backend accepts stays uploadable even though it has no fixed slot.
const OTHER_DOC_TYPES: DocumentType[] = [
  "passport",
  "school_certificate",
  "medical_report",
  "photo_id",
  "family_record",
  "bank_statement",
  "dwelling_photo",
  "displacement_proof",
  "other",
];

/**
 * Guided, country-driven document uploader for an existing orphan.
 *
 * Renders six fixed slots — the personal photo (reusing OrphanPhotoUpload as-is)
 * plus five document slots — each badged Required or Optional from the orphan's
 * country `required_documents`. Every slot takes a drag-and-drop or click
 * upload, previews the stored file, and (since lib/documents exposes a delete)
 * supports replace + delete. An "other document" affordance and a full list of
 * already-uploaded documents keep arbitrary types reachable.
 */
export function OrphanDocumentChecklist({
  orphanId,
  nationality,
}: {
  orphanId: string;
  nationality?: string | null;
}) {
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Reuse the same requirements query NewOrphanForm uses so the cache is shared:
  // the orphan's stored `nationality` is the ISO alpha-2 country code.
  const countryCode = (nationality ?? "").trim();
  const requirementsQuery = useQuery({
    queryKey: ["country-requirements", countryCode],
    queryFn: () => getCountryRequirements(countryCode),
    enabled: countryCode.length === 2,
    retry: false, // a 404 / unconfigured country just falls through to baseline
  });
  const requiredDocs = requirementsQuery.data?.required_documents ?? [];

  const docsQuery = useQuery({
    queryKey: ["orphan", orphanId, "documents"],
    queryFn: () => listOrphanDocuments(orphanId),
    enabled: !!orphanId,
  });
  // Newest first, so each slot shows the most recent file of its type and the
  // full list reads chronologically from the top.
  const docs = [...(docsQuery.data?.items ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : -1,
  );
  const latestOfType = (type: DocumentType) =>
    docs.find((d) => d.document_type === type);

  return (
    <>
      {/* Slot 1 — personal photo. Reused as-is: always optional, with its own
          presigned-URL preview + Lightbox. */}
      <OrphanPhotoUpload orphanId={orphanId} />

      <section className="card space-y-4" data-testid="orphan-document-checklist">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("documents.checklist.title")}</h2>
          <p className="text-sm text-gray-500">{t("documents.checklist.subtitle")}</p>
        </div>

        <div className="space-y-3">
          {DOC_SLOTS.map((type) => (
            <DocumentSlot
              key={type}
              orphanId={orphanId}
              docType={type}
              required={requiredDocs.includes(type)}
              doc={latestOfType(type)}
              onPreview={setLightbox}
            />
          ))}
        </div>

        <OtherDocumentSlot orphanId={orphanId} />

        <AllDocumentsList
          orphanId={orphanId}
          docs={docs}
          loading={docsQuery.isLoading}
          onPreview={setLightbox}
        />
      </section>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

// ── One fixed document slot ────────────────────────────────────────────────
function DocumentSlot({
  orphanId,
  docType,
  required,
  doc,
  onPreview,
}: {
  orphanId: string;
  docType: DocumentType;
  required: boolean;
  doc?: DocumentRead;
  onPreview: (url: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["orphan", orphanId, "documents"] });

  const uploadM = useMutation({
    mutationFn: (file: File) => uploadAndAttach(orphanId, docType, file),
    onSuccess: async () => {
      setError(null);
      await invalidate();
      toast.success(t("documents.attached"));
    },
    onError: (err) => setError(extractMsg(err)),
  });

  const deleteM = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: async () => {
      setError(null);
      await invalidate();
      toast.success(t("documents.checklist.deleted"));
    },
    onError: (err) => setError(extractMsg(err)),
  });

  function onFile(file: File) {
    const validation = validateFile(file, t);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    uploadM.mutate(file);
  }

  const busy = uploadM.isPending || deleteM.isPending;

  return (
    <div
      className="space-y-2 rounded-lg border border-sky-200 bg-snow p-3"
      data-testid={`doc-slot-${docType}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">
          {t(`documents.types.${docType}`, docType)}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            required ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"
          }`}
        >
          {required
            ? t("documents.checklist.required")
            : t("documents.checklist.optional")}
        </span>
      </div>

      {doc ? (
        <UploadedDoc
          doc={doc}
          busy={busy}
          onPreview={onPreview}
          onReplace={onFile}
          onDelete={() => deleteM.mutate(doc.id)}
        />
      ) : (
        <Dropzone onFile={onFile} busy={uploadM.isPending} />
      )}

      {error && (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}

// ── "Other document" affordance — type picker + upload ─────────────────────
function OtherDocumentSlot({ orphanId }: { orphanId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<DocumentType>("other");
  const [error, setError] = useState<string | null>(null);

  const uploadM = useMutation({
    mutationFn: (file: File) => uploadAndAttach(orphanId, docType, file),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ["orphan", orphanId, "documents"] });
      toast.success(t("documents.attached"));
    },
    onError: (err) => setError(extractMsg(err)),
  });

  function onFile(file: File) {
    const validation = validateFile(file, t);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    uploadM.mutate(file);
  }

  return (
    <div
      className="space-y-2 rounded-lg border border-dashed border-sky-200 bg-snow p-3"
      data-testid="doc-slot-other"
    >
      <span className="text-sm font-medium text-gray-700">
        {t("documents.checklist.otherTitle")}
      </span>
      <label className="block">
        <span className="sr-only">{t("documents.type")}</span>
        <select
          className="input"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocumentType)}
          aria-label={t("documents.type")}
        >
          {OTHER_DOC_TYPES.map((dt) => (
            <option key={dt} value={dt}>
              {t(`documents.types.${dt}`, dt)}
            </option>
          ))}
        </select>
      </label>
      <Dropzone onFile={onFile} busy={uploadM.isPending} />
      {error && (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      )}
    </div>
  );
}

// ── Drag-and-drop + click upload zone ──────────────────────────────────────
function Dropzone({
  onFile,
  busy,
}: {
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy}
      aria-label={t("documents.checklist.dropHint")}
      className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-center text-xs transition ${
        over ? "border-trust-400 bg-tranquil-200" : "border-sky-200 bg-white"
      } ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-trust-300"}`}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (busy) return;
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      {busy ? (
        <span className="text-gray-500">{t("documents.uploading")}</span>
      ) : (
        <>
          <span className="font-medium text-gray-600">
            {t("documents.checklist.dropHint")}
          </span>
          <span className="text-gray-400">{t("documents.checklist.acceptHint")}</span>
        </>
      )}
    </div>
  );
}

// ── Uploaded-file row: thumbnail/preview + replace + delete ────────────────
function UploadedDoc({
  doc,
  busy,
  onPreview,
  onReplace,
  onDelete,
}: {
  doc: DocumentRead;
  busy: boolean;
  onPreview: (url: string) => void;
  onReplace: (file: File) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const replaceRef = useRef<HTMLInputElement>(null);
  const isImage = (doc.file_mime_type ?? "").startsWith("image/");

  // For images, eagerly fetch a short-lived presigned URL for the thumbnail +
  // Lightbox. PDFs (and anything non-image) open in a new tab on demand.
  const urlQuery = useQuery({
    queryKey: ["document", doc.id, "url"],
    queryFn: () => getDocumentUrl(doc.id),
    enabled: isImage,
    staleTime: 60_000,
  });

  const viewM = useMutation({
    mutationFn: () => getDocumentUrl(doc.id),
    onSuccess: (url) => window.open(url, "_blank", "noopener"),
    onError: (err) => toast.error(extractMsg(err)),
  });

  return (
    <div className="flex items-start gap-3">
      {isImage && urlQuery.data ? (
        <button
          type="button"
          className="h-14 w-14 shrink-0 overflow-hidden rounded border border-sky-200"
          aria-label={t("common.viewFullSize")}
          onClick={() => onPreview(urlQuery.data!)}
        >
          <img
            src={urlQuery.data}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-sky-200 bg-white text-[10px] font-medium uppercase text-gray-400">
          {isImage ? "…" : "PDF"}
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-1">
        <p
          className="truncate text-sm font-medium text-gray-700"
          title={doc.file_name ?? undefined}
        >
          {doc.file_name ??
            doc.title ??
            t(`documents.types.${doc.document_type}`, doc.document_type)}
        </p>
        <VerificationBadge status={doc.verification_status} />
        <div className="flex flex-wrap items-center gap-3 pt-0.5">
          {!isImage && (
            <button
              type="button"
              className="text-xs font-medium text-trust-600 hover:underline disabled:opacity-50"
              onClick={() => viewM.mutate()}
              disabled={viewM.isPending}
            >
              {t("documents.view")}
            </button>
          )}
          <button
            type="button"
            className="text-xs font-medium text-trust-600 hover:underline disabled:opacity-50"
            onClick={() => replaceRef.current?.click()}
            disabled={busy}
          >
            {t("documents.checklist.replace")}
          </button>
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
            onClick={onDelete}
            disabled={busy}
          >
            {t("documents.checklist.delete")}
          </button>
          <input
            ref={replaceRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onReplace(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Full record of every uploaded document (any type) ──────────────────────
function AllDocumentsList({
  orphanId,
  docs,
  loading,
  onPreview,
}: {
  orphanId: string;
  docs: DocumentRead[];
  loading: boolean;
  onPreview: (url: string) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["orphan", orphanId, "documents"] });

  const verifyM = useMutation({
    mutationFn: ({ id, status }: { id: string; status: VerificationStatus }) =>
      verifyDocument(id, status),
    onSuccess: () => invalidate(),
    onError: (err) => toast.error(extractMsg(err)),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("documents.checklist.deleted"));
    },
    onError: (err) => toast.error(extractMsg(err)),
  });
  const viewM = useMutation({
    mutationFn: (id: string) => getDocumentUrl(id),
    onSuccess: (url) => window.open(url, "_blank", "noopener"),
    onError: (err) => toast.error(extractMsg(err)),
  });

  return (
    <div className="space-y-2 border-t border-sky-200 pt-3">
      <h3 className="text-sm font-semibold text-gray-700">
        {t("documents.checklist.allTitle")}
      </h3>

      {loading && <p className="text-sm text-gray-500">{t("common.loading")}</p>}
      {!loading && docs.length === 0 && (
        <p className="text-sm text-gray-500">{t("documents.empty")}</p>
      )}

      {docs.length > 0 && (
        <ul className="space-y-2" data-testid="documents-list">
          {docs.map((d) => {
            const isImage = (d.file_mime_type ?? "").startsWith("image/");
            return (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-sky-200 bg-snow px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {d.title ?? t(`documents.types.${d.document_type}`, d.document_type)}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {d.file_name} ·{" "}
                    {t(`documents.types.${d.document_type}`, d.document_type)}
                  </p>
                </div>
                <VerificationBadge status={d.verification_status} />
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded border border-sky-200 px-2 py-1 text-xs text-gray-700 hover:bg-tranquil-200"
                    onClick={() =>
                      isImage ? openImage(d.id, onPreview) : viewM.mutate(d.id)
                    }
                    disabled={viewM.isPending && viewM.variables === d.id}
                  >
                    {t("documents.view")}
                  </button>
                  {d.verification_status === "pending" && (
                    <>
                      <button
                        type="button"
                        className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                        onClick={() => verifyM.mutate({ id: d.id, status: "verified" })}
                      >
                        {t("documents.verify")}
                      </button>
                      <button
                        type="button"
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        onClick={() => verifyM.mutate({ id: d.id, status: "rejected" })}
                      >
                        {t("documents.reject")}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                    onClick={() => deleteM.mutate(d.id)}
                    disabled={deleteM.isPending && deleteM.variables === d.id}
                  >
                    {t("documents.checklist.delete")}
                  </button>
                </div>
              </li>
            );
          })}
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

// Upload the raw file, then attach it to the orphan under `docType`.
async function uploadAndAttach(
  orphanId: string,
  docType: DocumentType,
  file: File,
): Promise<DocumentRead> {
  const up = await uploadFile(file);
  return attachOrphanDocument(orphanId, {
    document_type: docType,
    file_url: up.file_url,
    file_name: up.file_name,
    file_size_bytes: up.file_size_bytes,
    file_mime_type: up.file_mime_type,
  });
}

// Open an image document in the Lightbox via its presigned URL.
async function openImage(id: string, onPreview: (url: string) => void) {
  try {
    onPreview(await getDocumentUrl(id));
  } catch (err) {
    toast.error(extractMsg(err));
  }
}

// Shared size/type validation; returns a localized error string or null.
function validateFile(file: File, t: TFunction): string | null {
  if (file.size > MAX_BYTES) return t("documents.tooLarge");
  // Some browsers leave file.type empty for odd extensions — fall back to the
  // name so a valid file is never rejected on a missing MIME type.
  const ok = file.type
    ? ACCEPTED_TYPES.has(file.type)
    : /\.(pdf|jpe?g|png|webp)$/i.test(file.name);
  return ok ? null : t("documents.checklist.invalidType");
}

function extractMsg(err: unknown): string {
  if (err instanceof AxiosError) {
    return err.response?.data?.detail ?? err.message;
  }
  return (err as Error).message ?? "error";
}
