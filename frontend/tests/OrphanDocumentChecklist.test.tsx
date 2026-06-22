import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrphanDocumentChecklist } from "@/components/OrphanDocumentChecklist";
import i18n from "@/i18n";

// The checklist resolves the orphan's country requirements (which document
// types are required) and lists existing documents + photos. Stub each lib so
// the test is hermetic; the badge/slot logic under test depends only on these.
const getCountryRequirements = vi.fn();
const listOrphanDocuments = vi.fn();
const listOrphanPhotos = vi.fn();

vi.mock("@/lib/countries", () => ({
  getCountryRequirements: (code: string) => getCountryRequirements(code),
}));

vi.mock("@/lib/documents", () => ({
  listOrphanDocuments: (id: string) => listOrphanDocuments(id),
  uploadFile: vi.fn(),
  attachOrphanDocument: vi.fn(),
  deleteDocument: vi.fn(),
  verifyDocument: vi.fn(),
  getDocumentUrl: vi.fn(() => Promise.resolve("blob:preview")),
}));

vi.mock("@/lib/media", () => ({
  listOrphanPhotos: (id: string) => listOrphanPhotos(id),
  uploadOrphanPhoto: vi.fn(),
}));

function renderChecklist(nationality?: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <OrphanDocumentChecklist orphanId="orphan-1" nationality={nationality} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

// Pin Arabic so the label/badge assertions are stable across suite order.
beforeEach(async () => {
  await i18n.changeLanguage("ar");
  getCountryRequirements.mockReset();
  listOrphanDocuments.mockReset();
  listOrphanPhotos.mockReset();
  listOrphanPhotos.mockResolvedValue([]);
  listOrphanDocuments.mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
});

const REQUIRED = "مطلوب"; // documents.checklist.required
const OPTIONAL = "اختياري"; // documents.checklist.optional

describe("OrphanDocumentChecklist — guided slots", () => {
  it("renders the photo slot and the five document slots", async () => {
    getCountryRequirements.mockResolvedValue({ required_documents: [] });
    renderChecklist("PS");

    // Photo slot (OrphanPhotoUpload reused as-is).
    expect(screen.getByText(i18n.t("orphans.photo.title"))).toBeInTheDocument();
    // The five fixed document slots.
    for (const type of [
      "national_id",
      "birth_certificate",
      "death_certificate",
      "custody_declaration",
      "inheritance_decree",
    ]) {
      expect(await screen.findByTestId(`doc-slot-${type}`)).toBeInTheDocument();
    }
    // The "other document" affordance keeps arbitrary types uploadable.
    expect(screen.getByTestId("doc-slot-other")).toBeInTheDocument();
  });

  it("badges each document slot Required/Optional from the country requirements", async () => {
    getCountryRequirements.mockResolvedValue({
      required_documents: ["national_id", "death_certificate"],
    });
    renderChecklist("PS");

    // Wait for the requirements to resolve and flip the badge to Required.
    const idSlot = await screen.findByTestId("doc-slot-national_id");
    expect(await within(idSlot).findByText(REQUIRED)).toBeInTheDocument();

    const deathSlot = screen.getByTestId("doc-slot-death_certificate");
    expect(await within(deathSlot).findByText(REQUIRED)).toBeInTheDocument();

    // Not listed in required_documents → Optional (stable before and after load).
    const birthSlot = screen.getByTestId("doc-slot-birth_certificate");
    expect(within(birthSlot).getByText(OPTIONAL)).toBeInTheDocument();
    const custodySlot = screen.getByTestId("doc-slot-custody_declaration");
    expect(within(custodySlot).getByText(OPTIONAL)).toBeInTheDocument();
  });

  it("treats every slot as optional when the country has no requirements", async () => {
    // No 2-letter nationality → requirements query never runs (baseline).
    renderChecklist(null);

    const idSlot = await screen.findByTestId("doc-slot-national_id");
    expect(within(idSlot).getByText(OPTIONAL)).toBeInTheDocument();
    expect(getCountryRequirements).not.toHaveBeenCalled();
  });

  it("shows an uploaded document with its verification status and a replace/delete affordance", async () => {
    getCountryRequirements.mockResolvedValue({ required_documents: ["national_id"] });
    listOrphanDocuments.mockResolvedValue({
      items: [
        {
          id: "doc-1",
          orphan_id: "orphan-1",
          guardian_id: null,
          family_id: null,
          document_type: "national_id",
          title: null,
          description: null,
          file_url: "s3://x",
          file_name: "id-card.pdf",
          file_size_bytes: 2048,
          file_mime_type: "application/pdf",
          issue_date: null,
          expiry_date: null,
          issuing_authority: null,
          verification_status: "pending",
          verified_at: null,
          created_at: new Date().toISOString(),
        },
      ],
      total: 1,
      limit: 100,
      offset: 0,
    });
    renderChecklist("PS");

    // Wait for the document to load into its slot (exact filename text).
    const idSlot = await screen.findByTestId("doc-slot-national_id");
    expect(await within(idSlot).findByText("id-card.pdf")).toBeInTheDocument();
    // Replace control present (delete also rendered).
    expect(
      within(idSlot).getByText(i18n.t("documents.checklist.replace")),
    ).toBeInTheDocument();
    // Verification status badge reflected (pending).
    expect(
      within(idSlot).getAllByText(i18n.t("documents.status.pending")).length,
    ).toBeGreaterThan(0);

    // The full "all documents" list also surfaces it (filename + type combined).
    const list = screen.getByTestId("documents-list");
    expect(within(list).getByText(/id-card\.pdf/)).toBeInTheDocument();
  });
});
