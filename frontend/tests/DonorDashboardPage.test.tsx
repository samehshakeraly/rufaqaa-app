import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorDashboardPage } from "@/pages/DonorDashboardPage";

// The dashboard joins four donor-scoped endpoints on the client; mock
// all four (plus the role/user hooks that gate them) so each state is
// drivable.
vi.mock("@/lib/sponsorships", () => ({ listMySponsorships: vi.fn() }));
vi.mock("@/lib/reports", () => ({ listMyReports: vi.fn() }));
vi.mock("@/lib/messages", () => ({ listDonorMessages: vi.fn() }));
vi.mock("@/lib/payments", () => ({ listMyPayments: vi.fn() }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { first_name: "سامي", role: "donor" } }),
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ isDonor: true }) }));

import { listDonorMessages } from "@/lib/messages";
import { listMyPayments } from "@/lib/payments";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

const sponsorshipsMock = vi.mocked(listMySponsorships);
const reportsMock = vi.mocked(listMyReports);
const messagesMock = vi.mocked(listDonorMessages);
const paymentsMock = vi.mocked(listMyPayments);

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
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
    start_date: "2025-06-01",
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "420",
    payments_count: 14,
    next_payment_date: inDays(20),
    created_at: "2025-06-01T00:00:00Z",
    donor_code: "DNR-1",
    donor_name: "كفيل",
    orphan_code: `ORF-${seq}`,
    orphan_name: `طفل-${seq}`,
    ...over,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payment(over: Record<string, unknown>): any {
  seq += 1;
  return {
    id: `p-${seq}`,
    code: `PAY-${1000 + seq}`,
    amount: "30",
    amount_in_default_currency: null,
    currency: "USD",
    payment_method: "credit_card",
    status: "completed",
    initiated_at: daysAgo(30),
    completed_at: daysAgo(30),
    receipt_issued_at: null,
    receipt_number: null,
    receipt_url: null,
    sponsorship_id: null,
    orphan_id: null,
    gateway_transaction_id: null,
    bank_reference: null,
    orphan_name: null,
    orphan_code: null,
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
        <MemoryRouter initialEntries={["/donor/dashboard"]}>
          <DonorDashboardPage />
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
  paymentsMock.mockReset();
  reportsMock.mockResolvedValue(page([]));
  messagesMock.mockResolvedValue(page([]));
  paymentsMock.mockResolvedValue(page([]));
});

describe("DonorDashboardPage — the duplicated lists are gone", () => {
  it("renders neither the sponsorships list nor the payments list", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({})]));
    paymentsMock.mockResolvedValue(page([payment({})]));
    renderPage();
    await screen.findByText("دفعتك القادمة");

    // The two removed sections and their per-row codes never render.
    expect(screen.queryByText("كفالاتك")).not.toBeInTheDocument();
    expect(screen.queryByText("آخر المدفوعات")).not.toBeInTheDocument();
    expect(screen.queryByText("SPN-1")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("PAY-");
  });
});

describe("DonorDashboardPage — attention bar", () => {
  it("an overdue sponsorship raises the bar with the warm renew CTA", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({
          status: "overdue",
          orphan_name: "مريم",
          next_payment_date: daysAgo(40).slice(0, 10),
        }),
        sponsorship({ orphan_name: "آدم" }),
      ]),
    );
    renderPage();

    const renew = await screen.findByRole("link", { name: "جدّد كفالة مريم" });
    expect(renew).toHaveAttribute("href", "/sponsor/ORF-1/checkout");
    expect(renew.className).toMatch(/warning/);
    expect(renew.className).not.toMatch(/danger/);
    expect(screen.getByText(/تأخّرت دفعة مريم منذ 40 يوماً/)).toBeInTheDocument();
  });

  it("unread messages raise the bar with the «جديد» badge in the feed", async () => {
    const s = sponsorship({ orphan_name: "عائشة" });
    sponsorshipsMock.mockResolvedValue(page([s]));
    messagesMock.mockResolvedValue(
      page([
        {
          id: "m-1",
          orphan_code: s.orphan_code,
          is_mine: false,
          is_read: false,
          created_at: daysAgo(1),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ]),
    );
    renderPage();

    expect(
      await screen.findByRole("link", { name: "اقرأ الرسائل" }),
    ).toHaveAttribute("href", "/donor/messages");
    expect(screen.getByText(/رسالة جديدة واحدة من عائشة/)).toBeInTheDocument();
    // The timeline row for the same message carries the badge.
    expect(screen.getByText("جديد")).toBeInTheDocument();
    expect(screen.getByText("عائشة أرسل إليك رسالة")).toBeInTheDocument();
  });

  it("more than 3 overdue collapse into one aggregated row", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({ status: "overdue", next_payment_date: daysAgo(10).slice(0, 10) }),
        sponsorship({ status: "overdue", next_payment_date: daysAgo(20).slice(0, 10) }),
        sponsorship({ status: "overdue", next_payment_date: daysAgo(30).slice(0, 10) }),
        sponsorship({ status: "overdue", next_payment_date: daysAgo(40).slice(0, 10) }),
      ]),
    );
    renderPage();

    expect(
      await screen.findByText("4 كفالات تأخّرت دفعاتها"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "راجع كفالاتك" }),
    ).toHaveAttribute("href", "/donor/orphans");
    expect(screen.queryByText(/جدّد كفالة/)).not.toBeInTheDocument();
  });

  it("no signals → the green CalmBar and NO orange bar", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({})]));
    renderPage();

    expect(await screen.findByText("كل شيء على ما يرام.")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /يحتاج انتباهك/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/تأخّرت دفعة/)).not.toBeInTheDocument();
  });
});

describe("DonorDashboardPage — welcome state", () => {
  it("zero live sponsorships → the welcome card ALONE (no impact, feed, or next payment)", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({ status: "cancelled" })]));
    renderPage();

    expect(await screen.findByText("أهلاً بك بين رفقاء")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "تصفّح الأطفال المنتظرين" }),
    ).toHaveAttribute("href", "/orphans");
    expect(
      screen.getByRole("link", { name: "كيف تعمل الكفالة؟" }),
    ).toHaveAttribute("href", "/how-it-works");
    expect(screen.queryByText("دفعتك القادمة")).not.toBeInTheDocument();
    expect(screen.queryByText("التزامك الشهري")).not.toBeInTheDocument();
    expect(screen.queryByText("جديد أطفالك")).not.toBeInTheDocument();
    // No invented minimum amount anywhere in the welcome.
    expect(screen.queryByText(/أقلّ مبلغ/)).not.toBeInTheDocument();
  });
});

describe("DonorDashboardPage — fetch contract", () => {
  it("reports/messages failure hides the timeline WITHOUT any alert", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({ orphan_name: "آدم" })]));
    reportsMock.mockRejectedValue(new Error("reports down"));
    messagesMock.mockRejectedValue(new Error("messages down"));
    renderPage();

    await screen.findByText("دفعتك القادمة");
    await waitFor(() => expect(reportsMock).toHaveBeenCalled());
    expect(screen.queryByText("جديد أطفالك")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("payments failure keeps the page; the year cell shows — and no statement button", async () => {
    sponsorshipsMock.mockResolvedValue(page([sponsorship({})]));
    paymentsMock.mockRejectedValue(new Error("payments down"));
    renderPage();

    await screen.findByText("دفعتك القادمة");
    expect(screen.getByText("ما قدّمتَه هذا العام")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/كشف تبرّعاتي \d/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sponsorships failure blocks the page: alert + a retry that refetches", async () => {
    sponsorshipsMock.mockRejectedValueOnce(new Error("boom"));
    sponsorshipsMock.mockResolvedValueOnce(page([sponsorship({ orphan_name: "آدم" })]));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر تحميل لوحتك الآن");
    expect(
      screen.getByRole("link", { name: "افتح أيتامي" }),
    ).toHaveAttribute("href", "/donor/orphans");

    await userEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("دفعتك القادمة")).toBeInTheDocument();
    expect(sponsorshipsMock).toHaveBeenCalledTimes(2);
  });
});

describe("DonorDashboardPage — no raw status ever reaches the DOM", () => {
  it("chargeback/disputed payments and raw sponsorship statuses never render", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({}),
        sponsorship({ status: "paused", next_payment_date: null }),
      ]),
    );
    paymentsMock.mockResolvedValue(
      page([
        payment({ status: "chargeback" }),
        payment({ status: "disputed" }),
        payment({ status: "completed" }),
      ]),
    );
    renderPage();

    await screen.findByText("دفعتك القادمة");
    expect(document.body.textContent).not.toContain("chargeback");
    expect(document.body.textContent).not.toContain("disputed");
    expect(document.body.textContent).not.toContain("active");
    expect(document.body.textContent).not.toContain("paused");
  });
});

describe("DonorDashboardPage — next payment", () => {
  it("REGRESSION: a paused sponsorship shows «لا دفعات مجدولة حالياً.» — and the card stays", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([sponsorship({ status: "paused", next_payment_date: inDays(5) })]),
    );
    renderPage();

    expect(await screen.findByText("دفعتك القادمة")).toBeInTheDocument();
    expect(screen.getByText("لا دفعات مجدولة حالياً.")).toBeInTheDocument();
  });

  it("an active sponsorship shows its amount and child", async () => {
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({
          orphan_name: "آدم",
          monthly_amount: "30",
          next_payment_date: inDays(5),
        }),
      ]),
    );
    renderPage();

    expect(await screen.findByText("لأجل آدم")).toBeInTheDocument();
    expect(screen.queryByText("لا دفعات مجدولة حالياً.")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "كل مدفوعاتي" }),
    ).toHaveAttribute("href", "/donor/payments");
  });
});
