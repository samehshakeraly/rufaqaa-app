import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { CommunityFollowupReportPage } from "@/pages/CommunityFollowupReportPage";

// Mock only the data source; the rest of the lib stays intact.
vi.mock("@/lib/communityFollowup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityFollowup")>();
  return { ...actual, getCommunityFollowupReport: vi.fn() };
});

import {
  type CommunityFollowupReport,
  getCommunityFollowupReport,
} from "@/lib/communityFollowup";

const reportMock = vi.mocked(getCommunityFollowupReport);

const REPORT: CommunityFollowupReport = {
  total: 10,
  governorates: [
    // 100% on track → good
    { governorate: "Cairo", count: 5, on_track: 5, due_soon: 0, overdue: 0 },
    // 67% on track → fair
    { governorate: "Giza", count: 3, on_track: 2, due_soon: 1, overdue: 0 },
    // 0% on track → needs follow-up
    { governorate: "other", count: 1, on_track: 0, due_soon: 0, overdue: 1 },
    { governorate: "unspecified", count: 1, on_track: 0, due_soon: 0, overdue: 1 },
  ],
  reporting: { cadence_days: 90, grace_days: 7, on_track: 7, due_soon: 1, overdue: 2 },
  lives_with: [
    { key: "mother", label: null, count: 6 },
    { key: "relative", label: null, count: 3 },
    { key: "unspecified", label: null, count: 1 },
  ],
  health: [
    { key: "good", label: null, count: 8 },
    { key: "disability", label: null, count: 2 },
  ],
  sponsorship: { sponsored: 4, unsponsored: 6, sponsored_pct: 40 },
  files: { avg_completion: 72, incomplete_count: 5 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <CommunityFollowupReportPage />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

function governorateNames(): string[] {
  return screen
    .getAllByTestId("cfr-gov-row")
    .map((row) => row.querySelector(".cfr-gov-name")?.textContent ?? "");
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  reportMock.mockReset();
});

describe("CommunityFollowupReportPage", () => {
  it("renders KPI cards, governorate rows with tier badges, panels and alerts", async () => {
    reportMock.mockResolvedValue(REPORT);
    renderPage();

    // KPI cards: total out-of-home, named governorates only (never the
    // synthetic "other"/"unspecified" buckets), % on track (with the honest
    // cadence + grace tag), avg completion.
    expect(await screen.findByText("Out-of-home children")).toBeInTheDocument();
    expect(screen.getByTestId("cfr-kpi-total")).toHaveTextContent("10");
    expect(screen.getByText("Governorates")).toBeInTheDocument();
    expect(screen.getByTestId("cfr-kpi-governorates")).toHaveTextContent("2");
    expect(screen.getByTestId("cfr-kpi-on-track")).toHaveTextContent("70%"); // 7 of 10
    expect(screen.getByText("Every 90 days (+7-day grace)")).toBeInTheDocument();
    expect(screen.getByTestId("cfr-kpi-completion")).toHaveTextContent("72%");

    // Signature panel: server order (most children first), synthetic
    // buckets labelled via i18n, one tier badge per row, all three cadence
    // tallies on every row.
    expect(governorateNames()).toEqual(["Cairo", "Giza", "Other (small groups)", "Unspecified"]);
    expect(screen.getAllByText("Needs follow-up")).toHaveLength(2);
    expect(screen.getByText("Fair")).toBeInTheDocument();
    expect(
      screen.getByText("5/5 on track (100%) · due soon 0 · overdue 0"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("2/3 on track (67%) · due soon 1 · overdue 0"),
    ).toBeInTheDocument();

    // Breakdown panels reuse the shared coded-value vocabulary.
    expect(screen.getByText("Mother")).toBeInTheDocument();
    expect(screen.getByText("Relative")).toBeInTheDocument();
    expect(screen.getByText("Disability")).toBeInTheDocument();
    expect(screen.getByText("Sponsored")).toBeInTheDocument();
    expect(screen.getByText("Not sponsored")).toBeInTheDocument();

    // Alerts: overdue children (with the honest cadence + grace) + the
    // weak-governorate list ("other" is 0% and flagged; "unspecified" is
    // not a governorate and never listed).
    const alerts = screen.getAllByRole("alert");
    expect(
      alerts.some((a) =>
        a.textContent?.includes(
          "2 children are overdue for a report (every 90 days + 7-day grace)",
        ),
      ),
    ).toBe(true);
    const low = alerts.find((a) => a.textContent?.includes("Follow-up below 60%"));
    expect(low?.textContent).toContain("Other (small groups)");
    expect(low?.textContent).not.toContain("Unspecified");
    expect(low?.textContent).not.toContain("Giza");

    // Privacy note: governorate-level only, sub-threshold merged.
    expect(screen.getByText(/merged into "Other"/)).toBeInTheDocument();
  });

  it("toggles the governorate ordering between size and weakest follow-up", async () => {
    reportMock.mockResolvedValue(REPORT);
    renderPage();

    const weakest = await screen.findByRole("button", { name: "Weakest follow-up" });
    const most = screen.getByRole("button", { name: "Most children" });
    expect(most).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(weakest);
    expect(weakest).toHaveAttribute("aria-pressed", "true");
    expect(most).toHaveAttribute("aria-pressed", "false");
    // 0% ties break on count then key; then 67%, then 100%.
    expect(governorateNames()).toEqual(["Other (small groups)", "Unspecified", "Giza", "Cairo"]);

    fireEvent.click(most);
    expect(governorateNames()).toEqual(["Cairo", "Giza", "Other (small groups)", "Unspecified"]);
  });
});
