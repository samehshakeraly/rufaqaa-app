import type { components } from "@/api/schema.gen";

import { api } from "./api";
import type { Page } from "./orphans";

// Mirrors the backend document_type enum (schema.gen.ts). The four trailing
// codes (custody_declaration … displacement_proof) were added server-side for
// the country-driven intake checklist; keep this union in lock-step so callers
// can attach them with a checked document_type.
export type DocumentType =
  | "birth_certificate"
  | "death_certificate"
  | "national_id"
  | "passport"
  | "bank_statement"
  | "school_certificate"
  | "medical_report"
  | "photo_id"
  | "family_record"
  | "other"
  | "custody_declaration"
  | "inheritance_decree"
  | "dwelling_photo"
  | "displacement_proof";

export type VerificationStatus = "pending" | "verified" | "rejected";

export interface DocumentRead {
  id: string;
  orphan_id: string | null;
  guardian_id: string | null;
  family_id: string | null;
  document_type: DocumentType;
  title: string | null;
  description: string | null;
  file_url: string;
  file_name: string | null;
  file_size_bytes: number | null;
  file_mime_type: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issuing_authority: string | null;
  verification_status: VerificationStatus;
  verified_at: string | null;
  created_at: string;
}

export interface FileUploadResponse {
  file_url: string;
  file_name: string;
  file_size_bytes: number;
  file_mime_type: string;
}

export async function uploadFile(file: File): Promise<FileUploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<FileUploadResponse>("/media/file", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export interface DocumentAttachInput {
  document_type: DocumentType;
  title?: string;
  description?: string;
  file_url: string;
  file_name?: string;
  file_size_bytes?: number;
  file_mime_type?: string;
  issue_date?: string;
  expiry_date?: string;
  issuing_authority?: string;
}

export async function listOrphanDocuments(orphanId: string): Promise<Page<DocumentRead>> {
  const { data } = await api.get<Page<DocumentRead>>(
    `/orphans/${orphanId}/documents`,
    { params: { limit: 100 } },
  );
  return data;
}

export async function attachOrphanDocument(
  orphanId: string,
  payload: DocumentAttachInput,
): Promise<DocumentRead> {
  const { data } = await api.post<DocumentRead>(
    `/orphans/${orphanId}/documents`,
    payload,
  );
  return data;
}

export async function listGuardianDocuments(
  guardianId: string,
): Promise<Page<DocumentRead>> {
  const { data } = await api.get<Page<DocumentRead>>(
    `/guardians/${guardianId}/documents`,
    { params: { limit: 100 } },
  );
  return data;
}

export async function attachGuardianDocument(
  guardianId: string,
  payload: DocumentAttachInput,
): Promise<DocumentRead> {
  const { data } = await api.post<DocumentRead>(
    `/guardians/${guardianId}/documents`,
    payload,
  );
  return data;
}

export async function verifyDocument(
  documentId: string,
  status: VerificationStatus,
  notes?: string,
): Promise<DocumentRead> {
  const { data } = await api.post<DocumentRead>(`/documents/${documentId}/verify`, {
    status,
    notes,
  });
  return data;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await api.delete(`/documents/${documentId}`);
}

type DocumentUrlRead = components["schemas"]["DocumentUrlRead"];

/** Short-lived presigned URL for a document's stored file. Documents may be
 * PDFs, so callers open it in a new tab rather than the image lightbox. */
export async function getDocumentUrl(documentId: string): Promise<string> {
  const { data } = await api.get<DocumentUrlRead>(`/documents/${documentId}/url`);
  return data.url;
}

export async function createUnattachedDocument(
  payload: DocumentAttachInput,
): Promise<DocumentRead> {
  const { data } = await api.post<DocumentRead>("/documents", payload);
  return data;
}
