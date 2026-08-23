import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorZakatPage } from "@/pages/DonorZakatPage";

// Same shape as DonorWaqfPage.test.tsx: replace only the donor-scoped
// fetchers plus the role hook the page gates its queries on.
vi.mock("@/lib/payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments")>()),
  initiatePayment: vi.fn(),
}));
vi.mock("@/lib/donorAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/donorAuth")>()),
  getDonorMe: vi.fn(),
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ isDonor: true }) }));

import { getDonorMe } from "@/lib/donorAuth";
import { initiatePayment } from "@/lib/payments";

const initiateMock = vi.mocked(initiatePayment);
const meMock = vi.mocked(getDonorMe);

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
        <MemoryRouter initialEntries={["/donor/zakat"]}>
          <DonorZakatPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** Type cash 10,000 at a gold price of 80: nisab = 6,800, base = 10,000,
 * due = 250 — comfortably over the nisab. */
async function reachNisab(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("النقد وأرصدة الحسابات"), "10000");
  await user.type(screen.getByLabelText("سعر جرام الذهب"), "80");
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  initiateMock.mockReset();
  meMock.mockReset();
  meMock.mockResolvedValue(DONOR);
});

// One test stubs window.location; restore it so it can't leak forward.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("DonorZakatPage — the calculator", () => {
  it("entering values renders the result", async () => {
    const user = userEvent.setup();
    renderPage();

    await reachNisab(user);

    // due = 10000 × 0.025 = 250, through formatMoney — assert on the
    // number, never on a currency literal. getAll: once the payment
    // section resolves, the pay button carries the same figure.
    expect(screen.getByText("زكاتك المستحقّة")).toBeInTheDocument();
    expect(screen.getAllByText(/250/).length).toBeGreaterThan(0);
    expect(screen.getByText("بلغ مالك النصاب.")).toBeInTheDocument();
  });

  it("marks a non-numeric field with a message and aria-invalid", async () => {
    const user = userEvent.setup();
    renderPage();

    const cash = screen.getByLabelText("النقد وأرصدة الحسابات");
    await user.type(cash, "abc");

    expect(cash).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("أدخل رقمًا صحيحًا غير سالب."),
    ).toBeInTheDocument();
  });

  it("below the nisab, the payment section is ABSENT from the DOM", async () => {
    const user = userEvent.setup();
    renderPage();

    // base 100 against a nisab of 6,800 (85 × 80).
    await user.type(screen.getByLabelText("النقد وأرصدة الحسابات"), "100");
    await user.type(screen.getByLabelText("سعر جرام الذهب"), "80");

    expect(screen.getByText(/مالك دون النصاب/)).toBeInTheDocument();
    expect(screen.queryByText("وجّه زكاتك")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /ادفع زكاتك/ }),
    ).not.toBeInTheDocument();
  });
});

describe("DonorZakatPage — directing the zakat", () => {
  it("keeps the pay button inert until the acknowledgement is checked", async () => {
    const user = userEvent.setup();
    renderPage();

    await reachNisab(user);
    const pay = await screen.findByRole("button", { name: /ادفع زكاتك/ });

    expect(pay).toBeDisabled();
    await user.click(pay);
    expect(initiateMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: /ادفع زكاتك/ })).toBeEnabled();
  });

  it("submits a payment tagged target_type: zakat, with no child attached", async () => {
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

    await reachNisab(user);
    await screen.findByRole("checkbox");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /ادفع زكاتك/ }));

    await waitFor(() => expect(initiateMock).toHaveBeenCalledTimes(1));
    expect(initiateMock).toHaveBeenCalledWith({
      donor_id: "donor-1",
      amount: "250.00",
      currency: "KWD",
      language: "ar",
      target_type: "zakat",
    });
    const [call] = initiateMock.mock.calls;
    expect(call?.[0]).not.toHaveProperty("sponsorship_id");
    expect(call?.[0]).not.toHaveProperty("orphan_id");
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "https://gateway.example/checkout/INV-1",
      ),
    );
  });

  it("pre-fills the amount with the due figure, editable", async () => {
    const user = userEvent.setup();
    renderPage();

    await reachNisab(user);
    const amount = await screen.findByLabelText("مبلغ الزكاة");
    expect(amount).toHaveValue("250.00");

    await user.clear(amount);
    await user.type(amount, "300");
    expect(amount).toHaveValue("300");
  });

  it("never links to the waqf — zakat must not flow into it", async () => {
    const user = userEvent.setup();
    renderPage();

    // Render the fullest state of the page before asserting.
    await reachNisab(user);
    await screen.findByRole("button", { name: /ادفع زكاتك/ });

    expect(document.body.innerHTML).not.toContain("/donor/waqf");
  });
});
