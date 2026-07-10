import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { OrphanageReportPage } from "@/pages/OrphanageReportPage";

// Mock the role hook (drives the manager-pinned vs admin-picker branch) and
// the two data sources; keep the rest of each lib intact.
vi.mock("@/hooks/useRole", () => ({ useRole: vi.fn() }));
vi.mock("@/lib/orphanages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orphanages")>();
  return { ...actual, listOrphanages: vi.fn(), getOrphanageReport: vi.fn() };
});
vi.mock("@/lib/orphanageSelf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orphanageSelf")>();
  return { ...actual, getOrphanageMe: vi.fn() };
});

import { useRole } from "@/hooks/useRole";
import {
  type Orphanage,
  type OrphanageReport,
  getOrphanageReport,
  listOrphanages,
} from "@/lib/orphanages";
import { getOrphanageMe } from "@/lib/orphanageSelf";

const roleMock = vi.mocked(useRole);
const listMock = vi.mocked(listOrphanages);
const reportMock = vi.mocked(getOrphanageReport);
const meMock = vi.mocked(getOrphanageMe);

function mockRole(role: string) {
  roleMock.mockReturnValue({
    role,
    isOrphanageManager: role === "orphanage_manager",
  } as unknown as ReturnType<typeof useRole>);
}

function dar(id: string, nameEn: string): Orphanage {
  return {
    id,
    name_ar: `دار ${nameEn}`,
    name_en: nameEn,
    code: `DAR-${id}`,
    status: "active",
    capacity: null,
  } as Orphanage;
}

const REPORT: OrphanageReport = {
  orphanage_id: "dar-1",
  occupancy: { capacity: 10, residents: 12, occupancy_pct: 120, free: -2, over: true },
  health: [
    { key: "good", label: null, count: 9 },
    { key: "unspecified", label: null, count: 3 },
  ],
  education: [
    { key: "primary", label: null, count: 8 },
    { key: "secondary", label: null, count: 4 },
  ],
  sponsorship: { sponsored: 3, unsponsored: 9, sponsored_pct: 25 },
  files: { avg_completion: 74, incomplete_count: 5 },
  reports_window: { window_days: 90, reported: 7, not_reported: 5 },
};

function renderPage(initialEntry = "/admin/reports/house") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <OrphanageReportPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  roleMock.mockReset();
  listMock.mockReset();
  reportMock.mockReset();
  meMock.mockReset();
});

describe("OrphanageReportPage", () => {
  it("admin: picks from the org's orphanages and renders the report", async () => {
    mockRole("org_admin");
    listMock.mockResolvedValue({
      items: [dar("dar-1", "Alpha House"), dar("dar-2", "Beta House")],
      total: 2,
      limit: 100,
      offset: 0,
    });
    reportMock.mockResolvedValue(REPORT);
    renderPage();

    // The picker offers every dar and auto-selects the first one.
    const picker = await screen.findByRole("combobox");
    expect(picker).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Alpha House" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta House" })).toBeInTheDocument();
    await waitFor(() => expect(reportMock).toHaveBeenCalledWith("dar-1"));
    expect(meMock).not.toHaveBeenCalled();

    // KPI cards + coded breakdown labels (reused i18n vocab).
    expect(await screen.findByText("Avg. file completion")).toBeInTheDocument();
    expect(screen.getByText("74%")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Unspecified")).toBeInTheDocument();

    // Over-capacity surfaces as an alert AND on the gauge; the reporting
    // panel is labelled with the honest window (no "late" bucket).
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.includes("Over capacity"))).toBe(true);
    expect(alerts.some((a) => a.textContent?.includes("below 80%"))).toBe(true);
    expect(screen.getByText("Over capacity by 2")).toBeInTheDocument();
    // The window is labelled honestly on the KPI card AND the panel title.
    expect(screen.getAllByText(/Last 90 days/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/late/i)).not.toBeInTheDocument();
  });

  it("manager: pinned to their own house — no picker, report fetched for it", async () => {
    mockRole("orphanage_manager");
    meMock.mockResolvedValue(dar("dar-9", "My House"));
    reportMock.mockResolvedValue({
      ...REPORT,
      orphanage_id: "dar-9",
      occupancy: { capacity: null, residents: 4, occupancy_pct: null, free: null, over: false },
      files: { avg_completion: 90, incomplete_count: 0 },
    });
    renderPage("/orphanage-manager/house-report");

    // Pinned house, never a combobox, and the staff list is never queried.
    const pinned = await screen.findByTestId("ohr-pinned-house");
    await waitFor(() => expect(pinned).toHaveTextContent("My House"));
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await waitFor(() => expect(reportMock).toHaveBeenCalledWith("dar-9"));
    expect(listMock).not.toHaveBeenCalled();

    // Unrecorded capacity renders the honest label instead of a percentage,
    // and with nothing over/incomplete there are no alerts.
    expect(await screen.findByText("Capacity not recorded")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
