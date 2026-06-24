import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { OrphanageManagerReportPage } from "@/pages/OrphanageManagerReportPage";

// The page talks to the orphanage self-service client; mock both calls so the
// test drives the form in isolation and can inspect the submitted payload.
vi.mock("@/lib/orphanageSelf", () => ({
  createOrphanageReport: vi.fn(),
  listOrphanageResidents: vi.fn(),
}));

import { createOrphanageReport, listOrphanageResidents } from "@/lib/orphanageSelf";

const createMock = vi.mocked(createOrphanageReport);
const listMock = vi.mocked(listOrphanageResidents);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";
const RESIDENT = {
  id: ORPHAN_ID,
  code: "ORF-12345",
  first_name: "سعيد",
  family_name: "الهاشمي",
  date_of_birth: "2015-04-01",
  gender: "M",
  case_status: "active",
  profile_completion_percentage: 50,
};

// Arabic labels under orphanageManager.report — the suite pins Arabic so these
// are stable regardless of jsdom's navigator language or suite order.
const SECTION_TITLES = {
  education: "التعليم",
  quran: "القرآن الكريم",
  activities: "الأنشطة",
  health: "الصحة",
  psychological: "الحالة النفسية",
};
const PERIOD_START = "بداية الفترة";
const PERIOD_END = "نهاية الفترة";
const SUBMIT = "إرسال للمراجعة";
const PERIOD_ERROR = "يجب أن يكون تاريخ النهاية في تاريخ البداية أو بعده.";
const MILESTONE_ERROR = "أضِف وصفاً مختصراً للإنجاز.";
const EDU_RATING = "التقييم العام";
const DONOR_MESSAGE = "كلمة إلى الكافل";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/orphanage-manager/orphans/${ORPHAN_ID}/report`]}>
          <Routes>
            <Route
              path="/orphanage-manager/orphans/:id/report"
              element={<OrphanageManagerReportPage />}
            />
            <Route path="/orphanage-manager/orphans/:id" element={<div>orphan detail</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  createMock.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMock.mockResolvedValue({ id: "report-1" } as any);
  listMock.mockReset();
  listMock.mockResolvedValue([RESIDENT]);
});

describe("OrphanageManagerReportPage — structure", () => {
  it("renders every canonical section card once the resident loads", async () => {
    renderPage();

    // The orphan context header confirms the page mounted with the resident.
    expect(await screen.findByText("سعيد الهاشمي")).toBeInTheDocument();

    // All five content sections render as named regions (aria-labelledby head).
    for (const title of Object.values(SECTION_TITLES)) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    // Report meta (type + period) and the submit action are present.
    expect(screen.getByLabelText(PERIOD_START)).toBeInTheDocument();
    expect(screen.getByLabelText(PERIOD_END)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SUBMIT })).toBeInTheDocument();
  });

  it("defaults every section to visible (sponsor-shown)", async () => {
    renderPage();
    await screen.findByText("سعيد الهاشمي");
    // Each section toggle is a switch, checked = shown to sponsor.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(5);
    for (const sw of switches) expect(sw).toHaveAttribute("aria-checked", "true");
  });
});

describe("OrphanageManagerReportPage — validation", () => {
  it("blocks submit when the period end precedes the start", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("سعيد الهاشمي");

    // End before start → inline error, no network call.
    fireEvent.change(screen.getByLabelText(PERIOD_START), { target: { value: "2026-05-20" } });
    fireEvent.change(screen.getByLabelText(PERIOD_END), { target: { value: "2026-05-01" } });
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    expect(await screen.findByText(PERIOD_ERROR)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("requires a milestone label when the report is flagged as a milestone", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("سعيد الهاشمي");

    // The milestone checkbox is the only checkbox on the form.
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    expect(await screen.findByText(MILESTONE_ERROR)).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("OrphanageManagerReportPage — submission", () => {
  it("sends a correctly shaped payload, with hidden sections marked false", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("سعيد الهاشمي");

    // Fill one education field so the section is built (not null)…
    await user.selectOptions(screen.getByLabelText(EDU_RATING), "good");
    // …add a note to the sponsor (label carries a hint, so match by substring)…
    await user.type(screen.getByLabelText(new RegExp(DONOR_MESSAGE)), "ابنكم بخير ويشكر دعمكم");
    // …and hide the Health section from the sponsor.
    const healthRegion = screen.getByRole("region", { name: SECTION_TITLES.health });
    await user.click(within(healthRegion).getByRole("switch"));
    expect(within(healthRegion).getByRole("switch")).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("button", { name: SUBMIT }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const payload = createMock.mock.calls[0]?.[0];
    if (!payload) throw new Error("createOrphanageReport was not called");

    // Report meta + identity.
    expect(payload.orphan_id).toBe(ORPHAN_ID);
    expect(payload.report_type).toBe("monthly");
    expect(typeof payload.period_start).toBe("string");
    expect(payload.period_end >= payload.period_start).toBe(true);

    // Filled section is a typed object; untouched ones are null.
    expect(payload.educational_progress).toMatchObject({ overall_rating: "good" });
    expect(payload.quran_progress).toBeNull();
    expect(payload.activities).toBeNull();
    expect(payload.health_status).toBeNull();
    expect(payload.psychological_status).toBeNull();

    // Donor extras + milestone defaults.
    expect(payload.donor_message).toBe("ابنكم بخير ويشكر دعمكم");
    expect(payload.is_milestone).toBe(false);
    expect(payload.milestone_label).toBeNull();

    // Only the hidden section is recorded; visible ones stay out of the map.
    expect(payload.section_visibility).toEqual({ health: false });
  });
});
