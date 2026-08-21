import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorOrphansPage } from "@/pages/DonorOrphansPage";

// The page joins three donor-scoped endpoints on the client; mock all
// three so each state (priority, signals, failures) is drivable.
vi.mock("@/lib/sponsorships", () => ({ listMySponsorships: vi.fn() }));
vi.mock("@/lib/reports", () => ({ listMyReports: vi.fn() }));
vi.mock("@/lib/messages", () => ({ listDonorMessages: vi.fn() }));

import { listDonorMessages } from "@/lib/messages";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

const sponsorshipsMock = vi.mocked(listMySponsorships);
const reportsMock = vi.mocked(listMyReports);
const messagesMock = vi.mocked(listDonorMessages);

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

let seq = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sponsorship(over: Record<string, unknown>): any {
  seq += 1;
  return {
    id: `s-${seq}`,
    code: `SPN-${seq}`,
    donor_id: "d-1",
    orphan_id: `orphan-${seq}`,
    monthly_amount: "30",
    currency: "USD",
    start_date: monthsAgo(14),
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "420",
    payments_count: 14,
    next_payment_date: inDays(20),
    created_at: monthsAgo(14),
    donor_code: "DNR-1",
    donor_name: "كفيل",
    orphan_code: `ORF-${seq}`,
    orphan_name: `طفل-${seq}`,
    ...over,
  };
}

function page<T>(items: T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/donor/orphans"]}>
          <DonorOrphansPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  seq = 0;
  sponsorshipsMock.mockReset();
  reportsMock.mockReset();
  messagesMock.mockReset();
  reportsMock.mockResolvedValue(page([]));
  messagesMock.mockResolvedValue(page([]));
});

function cardNames(): string[] {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent ?? "");
}

describe("DonorOrphansPage — priority order", () => {
  it("sorts overdue → unread message → fresh report → active → paused", async () => {
    const overdue = sponsorship({
      status: "overdue",
      orphan_name: "وديان",
      next_payment_date: monthsAgo(2),
    });
    const withMessage = sponsorship({ orphan_name: "صاحبة الرسالة" });
    const withReport = sponsorship({ orphan_name: "صاحب التقرير" });
    const plain = sponsorship({ orphan_name: "نشط" });
    const paused = sponsorship({
      status: "paused",
      orphan_name: "سلمى",
      next_payment_date: null,
    });
    // Deliberately shuffled input.
    sponsorshipsMock.mockResolvedValue(
      page([paused, plain, withReport, withMessage, overdue]),
    );
    reportsMock.mockResolvedValue(
      page([
        {
          id: "r-1",
          orphan_id: withReport.orphan_id,
          milestone_label: "أتمّ حفظ جزء عمّ",
          published_at: daysAgo(5),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
    );
    messagesMock.mockResolvedValue(
      page([
        {
          id: "m-1",
          orphan_code: withMessage.orphan_code,
          is_mine: false,
          is_read: false,
          created_at: daysAgo(1),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
    );

    renderPage();
    await screen.findByText("وديان");
    await waitFor(() =>
      expect(cardNames()).toEqual([
        "وديان",
        "صاحبة الرسالة",
        "صاحب التقرير",
        "نشط",
        "سلمى",
      ]),
    );
    // Relationship signals rendered from the joined data.
    expect(screen.getByText("رسالة جديدة من صاحبة الرسالة")).toBeInTheDocument();
    expect(screen.getByText(/وصل أتمّ حفظ جزء عمّ/)).toBeInTheDocument();
  });
});

describe("DonorOrphansPage — toolbar", () => {
  it("search narrows by name", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([sponsorship({ orphan_name: "آدم" }), sponsorship({ orphan_name: "مريم" })]),
    );
    renderPage();
    await screen.findByText("آدم");

    await userEvent.type(screen.getByRole("searchbox"), "مريم");
    await waitFor(() => expect(cardNames()).toEqual(["مريم"]));
  });

  it("the 'تحتاج انتباهك' chip keeps only overdue + unread cards", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({ orphan_name: "نشط" }),
        sponsorship({ status: "overdue", orphan_name: "وديان" }),
      ]),
    );
    renderPage();
    await screen.findByText("نشط");

    await userEvent.click(screen.getByRole("button", { name: /تحتاج انتباهك/ }));
    await waitFor(() => expect(cardNames()).toEqual(["وديان"]));
  });

  it("no search hits → a DISTINCT no-results state (not the empty state) with a clear action", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([sponsorship({ orphan_name: "آدم" }), sponsorship({ orphan_name: "مريم" })]),
    );
    renderPage();
    await screen.findByText("آدم");

    await userEvent.type(screen.getByRole("searchbox"), "غير موجود");
    expect(
      await screen.findByText("لا نتائج تطابق بحثك أو تصفيتك."),
    ).toBeInTheDocument();
    // NOT the zero-sponsorships welcome.
    expect(screen.queryByText("صفحتك تنتظر أول طفل")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "امسح البحث والتصفية" }),
    );
    await waitFor(() => expect(cardNames()).toEqual(expect.arrayContaining(["آدم", "مريم"])));
  });

  it("a single sponsorship renders without any toolbar", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({ orphan_name: "آدم" })]));
    renderPage();
    await screen.findByText("آدم");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });
});

describe("DonorOrphansPage — fetch contract", () => {
  it("reports/messages failure does NOT break the page — cards render without signals", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({ orphan_name: "آدم" }), sponsorship({ orphan_name: "مريم" })]));
    reportsMock.mockRejectedValue(new Error("reports down"));
    messagesMock.mockRejectedValue(new Error("messages down"));

    renderPage();
    expect(await screen.findByText("آدم")).toBeInTheDocument();
    expect(screen.getByText("مريم")).toBeInTheDocument();
    // No error surfaces for the progressive enhancements.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sponsorships failure blocks the page: alert + a retry that refetches", async () => {
    sponsorshipsMock.mockRejectedValueOnce(new Error("boom"));
    sponsorshipsMock.mockResolvedValueOnce(page([sponsorship({ orphan_name: "آدم" })]));

    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("آدم")).toBeInTheDocument();
    expect(sponsorshipsMock).toHaveBeenCalledTimes(2);
  });

  it("zero live sponsorships → the warm empty state, with NO toolbar", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({ status: "cancelled" })]));
    renderPage();

    expect(await screen.findByText("صفحتك تنتظر أول طفل")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    // Both first steps are present.
    expect(
      screen.getByRole("link", { name: "تصفّح الأطفال المنتظرين" }),
    ).toHaveAttribute("href", "/orphans");
    expect(
      screen.getByRole("link", { name: "كيف تعمل الكفالة؟" }),
    ).toHaveAttribute("href", "/how-it-works");
    // The reassurance line never invents a minimum amount.
    const reassurance = screen.getByText("يمكنك إيقاف الكفالة متى شئت.");
    expect(reassurance.textContent).not.toMatch(/\d/);
  });
});

describe("DonorOrphansPage — impact bar", () => {
  it("summarizes the live sponsorships client-side", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({ orphan_name: "آدم", total_paid: "300", monthly_amount: "30" }),
        sponsorship({ orphan_name: "مريم", total_paid: "120", monthly_amount: "20" }),
      ]),
    );
    renderPage();
    await screen.findByText("آدم");

    const bar = screen.getByRole("region", { name: "خلاصة أثرك" });
    expect(within(bar).getByText(/ترعى 2 من الأطفال/)).toBeInTheDocument();
    // 300 + 120 USD formatted via formatMoney (Latin digits, symbol).
    expect(within(bar).getByText(/420\.00/)).toBeInTheDocument();
    // Monthly commitment = active only = 30 + 20.
    expect(within(bar).getByText(/50\.00/)).toBeInTheDocument();
  });
});
