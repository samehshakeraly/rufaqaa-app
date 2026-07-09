import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { OrphanSegmentsReportPage } from "@/pages/OrphanSegmentsReportPage";

// Mock only the segments fetch; keep the rest of the lib intact (the shared
// filter controls import enum constants through the module graph).
vi.mock("@/lib/orphans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orphans")>();
  return { ...actual, getOrphanSegments: vi.fn() };
});

import { type OrphanSegments, getOrphanSegments } from "@/lib/orphans";

const segmentsMock = vi.mocked(getOrphanSegments);

const BY_CASE_STATUS: OrphanSegments = {
  dimension: "case_status",
  total: 5,
  buckets: [
    { key: "available", label: null, count: 3 },
    { key: "pending_review", label: null, count: 2 },
  ],
};

const BY_GOVERNORATE: OrphanSegments = {
  dimension: "governorate",
  total: 5,
  buckets: [
    { key: "القاهرة", label: "القاهرة", count: 4 },
    { key: "other", label: null, count: 1 },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/admin/reports/segments"]}>
          <OrphanSegmentsReportPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  segmentsMock.mockReset();
});

describe("OrphanSegmentsReportPage", () => {
  it("renders summary cards, bars and the detail table for the default dimension", async () => {
    segmentsMock.mockResolvedValue(BY_CASE_STATUS);
    renderPage();

    // Defaults to grouping by case_status.
    await waitFor(() =>
      expect(segmentsMock).toHaveBeenCalledWith(expect.objectContaining({ by: "case_status" })),
    );

    // Coded buckets i18n-map their keys (bar label + table row).
    expect((await screen.findAllByText("Available")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pending review").length).toBeGreaterThan(0);

    // Summary cards: total in slice, #categories, top category.
    expect(screen.getByText("Orphans in slice")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Largest category")).toBeInTheDocument();

    // No privacy note for a coded, low-cardinality dimension.
    expect(screen.queryByText(/fewer than 3/)).not.toBeInTheDocument();

    // Each table row deep-links into the orphan list, pinned to its bucket.
    const links = screen.getAllByRole("link", { name: "View orphans" });
    expect(links[0]).toHaveAttribute("href", "/admin/orphans?status=available");
    expect(links[1]).toHaveAttribute("href", "/admin/orphans?status=pending_review");
  });

  it("switches dimensions and shows the privacy note for sensitive ones", async () => {
    segmentsMock.mockResolvedValue(BY_CASE_STATUS);
    renderPage();
    await screen.findAllByText("Available");

    segmentsMock.mockResolvedValue(BY_GOVERNORATE);
    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "governorate" },
    });

    await waitFor(() =>
      expect(segmentsMock).toHaveBeenCalledWith(expect.objectContaining({ by: "governorate" })),
    );

    // Joined buckets render their label; the collapsed bucket i18n-maps.
    expect((await screen.findAllByText("القاهرة")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Other (small groups)").length).toBeGreaterThan(0);

    // The k-anonymity note appears only for governorate / orphanage.
    expect(screen.getByText(/fewer than 3/)).toBeInTheDocument();

    // The collapsed "other" bucket cannot pin a filter — the link carries
    // only the slice (which is empty here).
    const links = screen.getAllByRole("link", { name: "View orphans" });
    expect(links[1]).toHaveAttribute("href", "/admin/orphans");
  });

  it("passes the slice filters through to the report query", async () => {
    segmentsMock.mockResolvedValue(BY_CASE_STATUS);
    renderPage();
    await screen.findAllByText("Available");

    fireEvent.change(screen.getByLabelText("Health status"), {
      target: { value: "disability" },
    });

    await waitFor(() =>
      expect(segmentsMock).toHaveBeenCalledWith(
        expect.objectContaining({ by: "case_status", health_status: "disability" }),
      ),
    );

    // The deep-links now carry the slice too.
    const links = screen.getAllByRole("link", { name: "View orphans" });
    expect(links[0]).toHaveAttribute(
      "href",
      "/admin/orphans?health_status=disability&status=available",
    );
  });
});
