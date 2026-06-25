import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorOrphanDetailPage } from "@/pages/DonorOrphanDetailPage";

// The page consumes three donor-scoped clients; mock all so the timeline
// renders in isolation from a fixed ReportDonorRead list.
vi.mock("@/lib/sponsorships", () => ({ listMySponsorships: vi.fn() }));
vi.mock("@/lib/reports", () => ({ listMyReports: vi.fn() }));
vi.mock("@/lib/public", () => ({ getSponsoredOrphanProfile: vi.fn() }));

import { getSponsoredOrphanProfile } from "@/lib/public";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

const sponsorshipsMock = vi.mocked(listMySponsorships);
const reportsMock = vi.mocked(listMyReports);
const orphanMock = vi.mocked(getSponsoredOrphanProfile);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

// Roughly 14 months ago, so the "since" line resolves to "1 yr 2 mo".
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

const SPONSORSHIP = {
  id: "s-1",
  code: "SPN-1",
  donor_id: "d-1",
  orphan_id: ORPHAN_ID,
  monthly_amount: "30",
  currency: "USD",
  start_date: monthsAgo(14),
  end_date: null,
  payment_frequency: "monthly",
  status: "active",
  total_paid: "420",
  payments_count: 14,
  next_payment_date: "2026-07-01",
  created_at: monthsAgo(14),
  donor_code: "DNR-1",
  donor_name: "كفيل",
  orphan_code: "ORF-99",
  orphan_name: "آدم",
};

// Newest report: milestone, donor_message, health hidden (null), psych shown.
const REPORT_NEW = {
  id: "r-new",
  orphan_id: ORPHAN_ID,
  report_type: "monthly",
  period_start: "2026-05-01",
  period_end: "2026-05-31",
  summary: "كان شهراً مباركاً ومليئاً بالإنجاز.",
  donor_message: "دعمكم غيّر عامه — جزاكم الله خيراً.",
  is_milestone: true,
  milestone_label: "أتمّ حفظ جزء عمّ",
  educational_progress: {
    overall_rating: "excellent",
    attendance_percent: 95,
    stage: null,
    school_name: null,
    subjects: null,
    note: null,
  },
  quran_progress: {
    juz_memorized: 12,
    current_juz: 13,
    evaluation: "mastered",
    recent: null,
    note: null,
  },
  activities: null,
  health_status: null,
  psychological_status: { mood: "good", social: "excellent", note: null },
  status: "published_to_donor",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  submitted_at: "2026-06-01T00:00:00Z",
  partner_approved_at: "2026-06-02T00:00:00Z",
  org_approved_at: "2026-06-03T00:00:00Z",
  published_at: "2026-06-04T00:00:00Z",
  photos_count: 0,
  videos_count: 0,
  documents_count: 0,
};

// Older report: not a milestone, carries juz_memorized=8 for the trend.
const REPORT_OLD = {
  ...REPORT_NEW,
  id: "r-old",
  period_start: "2026-02-01",
  period_end: "2026-02-28",
  summary: "بداية طيبة للفصل الدراسي.",
  donor_message: null,
  is_milestone: false,
  milestone_label: null,
  educational_progress: {
    overall_rating: "good",
    attendance_percent: 88,
    stage: null,
    school_name: null,
    subjects: null,
    note: null,
  },
  quran_progress: {
    juz_memorized: 8,
    current_juz: 9,
    evaluation: "good",
    recent: null,
    note: null,
  },
  activities: { items: [{ title: "رحلة علميّة", note: null }], note: null },
  health_status: { general: "good", note: null },
  psychological_status: null,
};

const ORPHAN_INFO = {
  code: "ORF-99",
  first_name: "آدم",
  age_years: 9,
  gender: "M" as const,
  country: "اليمن",
  case_status: "active",
  partner_organization_name: null,
  short_description: "طفل مجتهد يحبّ القراءة.",
  aspiration: "أن يصبح طبيباً",
  education_stage: "primary",
  quran_juz_memorized: 12,
  is_hafiz: false,
  tags: ["مجتهد"],
};

function page<T>(items: T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/donor/orphans/${ORPHAN_ID}`]}>
          <Routes>
            <Route path="/donor/orphans/:id" element={<DonorOrphanDetailPage />} />
            <Route path="/donor/orphans" element={<div>orphans list</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  sponsorshipsMock.mockReset();
  reportsMock.mockReset();
  orphanMock.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sponsorshipsMock.mockResolvedValue(page([SPONSORSHIP]) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reportsMock.mockResolvedValue(page([REPORT_NEW, REPORT_OLD]) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orphanMock.mockResolvedValue(ORPHAN_INFO as any);
});

describe("DonorOrphanDetailPage — child journey", () => {
  it("renders sections as human labels/chips, never raw keys", async () => {
    renderPage();

    // Story header mounted with the child's name.
    expect(await screen.findByText("آدم")).toBeInTheDocument();

    // Section headings are warm labels, and enum codes are translated chips.
    expect(screen.getAllByText("التقدّم الدراسي").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ممتاز").length).toBeGreaterThan(0); // excellent
    expect(screen.getByText("الحضور 95٪")).toBeInTheDocument();
    expect(screen.getByText("حفظ 12 جزءًا")).toBeInTheDocument(); // juz_memorized
    expect(screen.getByText("متقن")).toBeInTheDocument(); // mastered

    // No raw schema keys leak into the DOM.
    expect(screen.queryByText(/overall_rating/)).not.toBeInTheDocument();
    expect(screen.queryByText(/juz_memorized/)).not.toBeInTheDocument();
    expect(screen.queryByText(/attendance_percent/)).not.toBeInTheDocument();
  });

  it("omits a hidden (null) section from its card", async () => {
    renderPage();

    // The milestone card is the newest report, whose health_status is null.
    const milestoneBadge = await screen.findByText("أتمّ حفظ جزء عمّ");
    const card = milestoneBadge.closest("article");
    expect(card).not.toBeNull();
    const utils = within(card as HTMLElement);

    // Health section is hidden here…
    expect(utils.queryByText("الحالة الصحية")).not.toBeInTheDocument();
    // …but the psychological section (present) does render.
    expect(utils.getByText("الحالة النفسية")).toBeInTheDocument();
  });

  it("gives a milestone report its highlight + label", async () => {
    renderPage();

    const label = await screen.findByText("أتمّ حفظ جزء عمّ");
    const card = label.closest("article");
    expect(card).not.toBeNull();
    expect(card?.className).toMatch(/success/);
  });

  it("renders donor_message in its quote block", async () => {
    renderPage();

    expect(await screen.findByText("كلمة من المشرف إليك")).toBeInTheDocument();
    expect(
      screen.getByText(/دعمكم غيّر عامه/),
    ).toBeInTheDocument();
  });

  it("computes the journey strip 'since' line and Qur'an progress", async () => {
    renderPage();

    // "since" line names the child.
    const since = await screen.findByText(/ترعى آدم منذ/);
    expect(since).toBeInTheDocument();

    // Latest juz toward 30, plus the gain across the two reports (12 − 8).
    expect(screen.getByText("12 من 30 جزءًا")).toBeInTheDocument();
    expect(screen.getByText("+4 جزءًا منذ بدأت كفالتك")).toBeInTheDocument();
  });

  it("shows a warm empty state when no reports exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reportsMock.mockResolvedValue(page([]) as any);
    renderPage();

    expect(await screen.findByText("لم يصل تقرير بعد")).toBeInTheDocument();
    // The empty body names the child.
    expect(
      screen.getByText(/سيظهر هنا أوّل تحديث عن آدم/),
    ).toBeInTheDocument();
  });
});
