import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorWaqfPage } from "@/pages/DonorWaqfPage";

// Same shape as DonorPaymentsPage.test.tsx: replace only the donor-scoped
// fetchers plus the role/profile hooks the page gates its queries on.
vi.mock("@/lib/payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments")>()),
  listMyPayments: vi.fn(),
  initiatePayment: vi.fn(),
}));
vi.mock("@/lib/donorAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/donorAuth")>()),
  getDonorMe: vi.fn(),
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ isDonor: true }) }));

import { getDonorMe } from "@/lib/donorAuth";
import type { PaymentDonorRead } from "@/lib/payments";
import { initiatePayment, listMyPayments } from "@/lib/payments";

const paymentsMock = vi.mocked(listMyPayments);
const initiateMock = vi.mocked(initiatePayment);
const meMock = vi.mocked(getDonorMe);

let seq = 0;

function payment(over: Partial<PaymentDonorRead>): PaymentDonorRead {
  seq += 1;
  return {
    id: `p-${seq}`,
    code: `PAY-${1000 + seq}`,
    amount: "50.000",
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
    target_type: "waqf",
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

/** One preset chip. Every amount on the page goes through formatMoney,
 * which renders KWD as "د.ك." in Arabic — so chips are addressed by the
 * number they carry, inside the amount group, never by a literal. */
function preset(value: number): HTMLElement {
  const group = screen.getByRole("group", { name: "المبلغ" });
  return within(group).getByRole("button", {
    name: new RegExp(String(value)),
  });
}

const DONOR = {
  id: "donor-1",
  code: "DNR-1",
  user_id: "u-1",
  full_name: "سامي",
  email: "sami@example.com",
  phone: null,
  country_of_residence: null,
  preferred_currency: "KWD",
  status: "active",
  total_sponsorships: 0,
  active_sponsorships: 0,
  total_donated: "0.000",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/donor/waqf"]}>
          <DonorWaqfPage />
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
  initiateMock.mockReset();
  meMock.mockReset();
  meMock.mockResolvedValue(DONOR);
  paymentsMock.mockResolvedValue(page([]));
});

// One test stubs window.location; restore it so it can't leak forward.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("DonorWaqfPage — the contribution form", () => {
  it("picking a preset updates the submit button's amount", async () => {
    const user = userEvent.setup();
    renderPage();

    const submit = await screen.findByRole("button", { name: /أوقِف الآن/ });
    // The first preset (10) is the default. Amounts render through
    // formatMoney, so assert on the number, never on a literal string.
    expect(submit).toHaveAccessibleName(/10/);

    await user.click(preset(500));
    expect(
      screen.getByRole("button", { name: /أوقِف الآن/ }),
    ).toHaveAccessibleName(/500/);
  });

  it("submitting initiates a payment tagged target_type: waqf, with no child", async () => {
    const user = userEvent.setup();
    initiateMock.mockResolvedValue({
      payment_id: "pay-1",
      invoice_id: "INV-1",
      payment_url: "https://gateway.example/checkout/INV-1",
    });
    // The page hands the browser to the gateway on success; jsdom can't
    // navigate, so stand in for it and assert the request instead.
    const replace = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      ...window.location,
      replace,
    } as unknown as Location);
    renderPage();

    await screen.findByRole("button", { name: /أوقِف الآن/ });
    await user.click(preset(100));
    await user.click(screen.getByRole("button", { name: /أوقِف الآن/ }));

    await waitFor(() => expect(initiateMock).toHaveBeenCalledTimes(1));
    expect(initiateMock).toHaveBeenCalledWith({
      donor_id: "donor-1",
      amount: "100",
      currency: "KWD",
      language: "ar",
      target_type: "waqf",
    });
    const [call] = initiateMock.mock.calls;
    expect(call?.[0]).not.toHaveProperty("sponsorship_id");
    expect(call?.[0]).not.toHaveProperty("orphan_id");
  });

  it("a gateway failure shows a message AND a retry button, never a bare description", async () => {
    const user = userEvent.setup();
    initiateMock.mockRejectedValue(new Error("gateway down"));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /أوقِف الآن/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر بدء عملية الدفع الآن.");
    expect(
      screen.getByRole("button", { name: "أعد المحاولة" }),
    ).toBeInTheDocument();
  });

  it("refuses to submit a non-positive amount", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("مبلغ آخر");
    await user.clear(input);
    await user.type(input, "0");

    expect(screen.getByRole("button", { name: /أوقِف الآن/ })).toBeDisabled();
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("states, always, that zakat is not paid here", async () => {
    renderPage();
    expect(
      await screen.findByText(/لا تُؤدّى الزكاة من هنا/),
    ).toBeInTheDocument();
  });
});

describe("DonorWaqfPage — my contribution", () => {
  it("is ABSENT from the DOM when the donor has given nothing", async () => {
    paymentsMock.mockResolvedValue(
      page([payment({ target_type: null }), payment({ status: "pending" })]),
    );
    renderPage();

    await screen.findByRole("button", { name: /أوقِف الآن/ });
    expect(screen.queryByText("وقفك حتى الآن")).not.toBeInTheDocument();
  });

  it("shows the donor's own completed waqf total, formatted", async () => {
    paymentsMock.mockResolvedValue(
      page([payment({ amount: "50" }), payment({ amount: "100" })]),
    );
    renderPage();

    expect(await screen.findByText("وقفك حتى الآن")).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "وقفك حتى الآن" });
    expect(card).toHaveTextContent(/150/);
    expect(card).toHaveTextContent("مساهمتان مكتملتان");
  });

  it("never sums across currencies — it names the dominant one and counts the rest", async () => {
    paymentsMock.mockResolvedValue(
      page([
        payment({ currency: "KWD", amount: "10" }),
        payment({ currency: "KWD", amount: "15" }),
        payment({ currency: "USD", amount: "1000" }),
      ]),
    );
    renderPage();

    const card = await screen.findByRole("region", { name: "وقفك حتى الآن" });
    expect(card).toHaveTextContent(/25/);
    expect(card).not.toHaveTextContent(/1,?025/);
    expect(card).toHaveTextContent("وعملة أخرى واحدة");
  });
});
