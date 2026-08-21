import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorPaymentsPage } from "@/pages/DonorPaymentsPage";

// Replace only the two donor-scoped fetchers (and fetchMe for the App-
// level redirect test); everything else in those modules stays real.
vi.mock("@/lib/payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments")>()),
  listMyPayments: vi.fn(),
}));
vi.mock("@/lib/sponsorships", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sponsorships")>()),
  listMySponsorships: vi.fn(),
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  fetchMe: vi.fn(),
}));

import { App } from "@/App";
import { fetchMe } from "@/lib/auth";
import type { PaymentDonorRead } from "@/lib/payments";
import { listMyPayments } from "@/lib/payments";
import type { Sponsorship } from "@/lib/sponsorships";
import { listMySponsorships } from "@/lib/sponsorships";
import { useAuthStore } from "@/store/auth";

const paymentsMock = vi.mocked(listMyPayments);
const sponsorshipsMock = vi.mocked(listMySponsorships);
const fetchMeMock = vi.mocked(fetchMe);

let seq = 0;

function payment(over: Partial<PaymentDonorRead>): PaymentDonorRead {
  seq += 1;
  return {
    id: `p-${seq}`,
    code: `PAY-${1000 + seq}`,
    amount: "45.000",
    amount_in_default_currency: null,
    currency: "KWD",
    payment_method: "credit_card",
    status: "completed",
    initiated_at: "2026-03-01T10:00:00Z",
    completed_at: "2026-03-01T10:01:00Z",
    receipt_issued_at: null,
    receipt_number: null,
    receipt_url: null,
    sponsorship_id: null,
    orphan_id: null,
    ...over,
  };
}

function sponsorship(over: Partial<Sponsorship>): Sponsorship {
  seq += 1;
  return {
    id: `s-${seq}`,
    code: `SPN-${seq}`,
    donor_id: "d-1",
    orphan_id: `o-${seq}`,
    monthly_amount: "45.000",
    currency: "KWD",
    start_date: "2025-06-01",
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "450.000",
    payments_count: 10,
    next_payment_date: null,
    created_at: "2025-06-01T00:00:00Z",
    donor_code: "DNR-1",
    donor_name: "كفيل",
    orphan_code: `ORF-${seq}`,
    orphan_name: `طفل-${seq}`,
    ...over,
  };
}

function page<T>(items: T[], total = items.length) {
  return { items, total, limit: 25, offset: 0 };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/donor/payments"]}>
          <DonorPaymentsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  seq = 0;
  paymentsMock.mockReset();
  sponsorshipsMock.mockReset();
  fetchMeMock.mockReset();
  sponsorshipsMock.mockResolvedValue(page([]));
});

describe("DonorPaymentsPage — needs completing", () => {
  it("is ABSENT from the DOM when there's nothing pending and nothing failed", async () => {
    paymentsMock.mockResolvedValue(page([payment({})]));
    sponsorshipsMock.mockResolvedValue(page([sponsorship({ status: "active" })]));
    renderPage();

    await screen.findAllByText("PAY-1001", { exact: false });
    expect(screen.queryByText("يحتاج إتمامه")).not.toBeInTheDocument();
  });

  it("a pending sponsorship shows 'أتمّ الدفع' linking to its checkout", async () => {
    paymentsMock.mockResolvedValue(page([payment({})]));
    sponsorshipsMock.mockResolvedValue(
      page([
        sponsorship({
          status: "pending",
          orphan_code: "ORF-77",
          orphan_name: "لُجين",
        }),
      ]),
    );
    renderPage();

    expect(await screen.findByText("يحتاج إتمامه")).toBeInTheDocument();
    expect(screen.getByText("كفالة لُجين لم تكتمل")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "أتمّ الدفع" })).toHaveAttribute(
      "href",
      "/sponsor/ORF-77/checkout",
    );
  });

  it("a failed payment shows a retry exit back to its sponsorship checkout", async () => {
    const s = sponsorship({ id: "s-a", orphan_code: "ORF-9", orphan_name: "أحمد" });
    paymentsMock.mockResolvedValue(
      page([payment({ status: "failed", sponsorship_id: "s-a" })]),
    );
    sponsorshipsMock.mockResolvedValue(page([s]));
    renderPage();

    expect(await screen.findByText("يحتاج إتمامه")).toBeInTheDocument();
    // The attention item + the row action both carry the exit.
    const retries = screen.getAllByRole("link", { name: "أعد المحاولة" });
    expect(retries.length).toBeGreaterThan(0);
    for (const link of retries) {
      expect(link).toHaveAttribute("href", "/sponsor/ORF-9/checkout");
    }
  });
});

describe("DonorPaymentsPage — the record", () => {
  it("a completed payment without receipt_url shows NO receipt action", async () => {
    paymentsMock.mockResolvedValue(
      page([
        payment({ code: "PAY-WITH", receipt_url: "https://r.example/1.pdf" }),
        payment({ code: "PAY-WITHOUT", receipt_url: null }),
      ]),
    );
    renderPage();
    await screen.findAllByText("PAY-WITH", { exact: false });

    // Table + mobile cards each render the row once → 2 links for the
    // one payment that HAS a receipt, none for the other. The accessible
    // name is the aria-label, which carries the payment code.
    const receiptLinks = screen.getAllByRole("link", { name: /تنزيل إيصال/ });
    expect(receiptLinks).toHaveLength(2);
    for (const link of receiptLinks) {
      expect(link).toHaveAttribute("href", "https://r.example/1.pdf");
    }
  });

  it("uncollected amounts (failed / refunded) are struck through", async () => {
    paymentsMock.mockResolvedValue(
      page([
        payment({ code: "PAY-OK", amount: "10.000" }),
        payment({ code: "PAY-BAD", amount: "20.000", status: "failed" }),
        payment({ code: "PAY-REF", amount: "30.000", status: "refunded" }),
      ]),
    );
    renderPage();
    await screen.findAllByText("PAY-OK", { exact: false });

    const struck = (needle: RegExp) =>
      screen
        .getAllByText(needle)
        .filter((el) => el.className.includes("line-through"));
    expect(struck(/10\.000/)).toHaveLength(0);
    expect(struck(/20\.000/).length).toBeGreaterThan(0);
    expect(struck(/30\.000/).length).toBeGreaterThan(0);
  });

  it("filters through chips (zero-count chips hidden) and searches by child name", async () => {
    const s = sponsorship({ id: "s-a", orphan_name: "لُجين" });
    paymentsMock.mockResolvedValue(
      page([
        payment({ code: "PAY-DONE", sponsorship_id: "s-a" }),
        payment({ code: "PAY-FAIL", status: "failed" }),
      ]),
    );
    sponsorshipsMock.mockResolvedValue(page([s]));
    renderPage();
    await screen.findAllByText("PAY-DONE", { exact: false });

    // No refunded/underReview rows → those chips don't exist.
    expect(
      screen.queryByRole("button", { name: /مستردّة/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /قيد المراجعة/ }),
    ).not.toBeInTheDocument();

    // Scope to the table — the failed payment's code legitimately also
    // shows in the "needs completing" section, which filters never touch.
    const table = screen.getByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /لم تتم/ }));
    expect(within(table).queryByText("PAY-DONE")).not.toBeInTheDocument();
    expect(within(table).getByText("PAY-FAIL")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /الكل/ }));
    await userEvent.type(screen.getByRole("searchbox"), "لُجين");
    expect(within(table).getByText("PAY-DONE")).toBeInTheDocument();
    expect(within(table).queryByText("PAY-FAIL")).not.toBeInTheDocument();
  });

  it("no search hits → a distinct no-results state with a clear action", async () => {
    paymentsMock.mockResolvedValue(page([payment({ code: "PAY-A" })]));
    renderPage();
    await screen.findAllByText("PAY-A", { exact: false });

    await userEvent.type(screen.getByRole("searchbox"), "غير موجود");
    expect(
      await screen.findByText("لا نتائج تطابق بحثك أو تصفيتك."),
    ).toBeInTheDocument();
    expect(screen.queryByText("لم تسجَّل أي عملية بعد")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "امسح البحث والتصفية" }),
    );
    expect(screen.getAllByText("PAY-A").length).toBeGreaterThan(0);
  });

  it("paginates with real limit/offset requests", async () => {
    paymentsMock.mockImplementation(async ({ offset = 0 } = {}) =>
      offset === 0
        ? { items: Array.from({ length: 25 }, () => payment({})), total: 30, limit: 25, offset: 0 }
        : { items: [payment({ code: "PAY-P2" })], total: 30, limit: 25, offset: 25 },
    );
    renderPage();
    await screen.findByText(/1–25 من 30/);

    await userEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findAllByText("PAY-P2", { exact: false });
    expect(paymentsMock).toHaveBeenCalledWith({ limit: 25, offset: 25 });
    await screen.findByText(/26–26 من 30/);
  });
});

describe("DonorPaymentsPage — year summary", () => {
  it("never sums mixed currencies: dominant total + a note about the rest", async () => {
    paymentsMock.mockResolvedValue(
      page([
        payment({ amount: "45.000", currency: "KWD" }),
        payment({ amount: "40.000", currency: "KWD" }),
        payment({ amount: "100.00", currency: "USD" }),
      ]),
    );
    renderPage();
    await screen.findAllByText("PAY-1001", { exact: false });

    const summary = screen.getByRole("region", { name: "ملخّص السنة" });
    // 45 + 40 KWD; the USD 100 is a note, never an addend.
    expect(within(summary).getByText(/85\.000/)).toBeInTheDocument();
    expect(within(summary).getByText("+ 1 بعملات أخرى")).toBeInTheDocument();
    expect(within(summary).queryByText(/185/)).not.toBeInTheDocument();
    expect(within(summary).getByText("عبر 3 عملية ناجحة")).toBeInTheDocument();
  });
});

describe("DonorPaymentsPage — the four states", () => {
  it("loading: skeletons, no record yet", () => {
    paymentsMock.mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderPage();
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("error: alert + a retry that refetches", async () => {
    paymentsMock.mockRejectedValueOnce(new Error("boom"));
    paymentsMock.mockResolvedValueOnce(page([payment({ code: "PAY-OK" })]));
    renderPage();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findAllByText("PAY-OK", { exact: false });
    expect(paymentsMock).toHaveBeenCalledTimes(2);
  });

  it("empty: the warm zero state with a browse exit, no toolbar", async () => {
    paymentsMock.mockResolvedValue(page([]));
    renderPage();

    expect(await screen.findByText("لم تسجَّل أي عملية بعد")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "تصفّح الأطفال المنتظرين" }),
    ).toHaveAttribute("href", "/orphans");
  });
});

describe("/donor/sponsorships → /donor/payments", () => {
  it("the old route permanently redirects to My Payments", async () => {
    useAuthStore.setState({ accessToken: "test-token", refreshToken: "test-token" });
    fetchMeMock.mockResolvedValue({
      id: "u-1",
      email: "donor@example.com",
      first_name: "سامي",
      last_name: "المتبرع",
      role: "donor",
      email_verified_at: "2026-01-01T00:00:00Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    paymentsMock.mockResolvedValue(page([]));

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/donor/sponsorships"]}>
            <App />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "مدفوعاتي", level: 1 }),
      ).toBeInTheDocument(),
    );
    useAuthStore.setState({ accessToken: null, refreshToken: null });
  });
});
