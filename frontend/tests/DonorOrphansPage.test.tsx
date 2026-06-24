import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorOrphansPage } from "@/pages/DonorOrphansPage";

// The page derives every card from /me/sponsorships; mock it so we can
// drive the relationship copy from a fixed list.
vi.mock("@/lib/sponsorships", () => ({ listMySponsorships: vi.fn() }));

import { listMySponsorships } from "@/lib/sponsorships";

const sponsorshipsMock = vi.mocked(listMySponsorships);

// ~14 months ago, so the "since" line resolves to "1 yr 2 mo".
function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

const ACTIVE = {
  id: "s-1",
  code: "SPN-1",
  donor_id: "d-1",
  orphan_id: "11111111-1111-1111-1111-111111111111",
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

const OVERDUE = {
  ...ACTIVE,
  id: "s-2",
  code: "SPN-2",
  orphan_id: "22222222-2222-2222-2222-222222222222",
  status: "overdue",
  orphan_code: "ORF-77",
  orphan_name: "مريم",
};

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
  sponsorshipsMock.mockReset();
});

describe("DonorOrphansPage — relationship cards", () => {
  it("renders the warm relationship copy for an active sponsorship", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sponsorshipsMock.mockResolvedValue(page([ACTIVE]) as any);
    renderPage();

    // Headline name.
    expect(await screen.findByText("آدم")).toBeInTheDocument();
    // "since" line names the child.
    expect(screen.getByText(/ترعى آدم منذ/)).toBeInTheDocument();
    // Warm contribution line, built from total_paid.
    expect(screen.getByText(/ساهمتَ بـ 420 USD من أجل آدم/)).toBeInTheDocument();
    // Gentle next-payment line (active + next_payment_date present).
    expect(screen.getByText(/دفعتك القادمة:/)).toBeInTheDocument();
  });

  it("shows a warm, non-alarming reminder for an overdue sponsorship", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sponsorshipsMock.mockResolvedValue(page([OVERDUE]) as any);
    renderPage();

    const reminder = await screen.findByText(
      /حان موعد تجديد كفالتك لتستمرّ رعاية مريم/,
    );
    expect(reminder).toBeInTheDocument();
    // Calm amber accent, never an alarming red badge.
    expect(reminder.className).toMatch(/warning/);
    expect(reminder.className).not.toMatch(/danger|red/);
    // The harsh next-payment line is replaced by the gentle reminder.
    expect(screen.queryByText(/دفعتك القادمة:/)).not.toBeInTheDocument();
  });

  it("shows the warm empty state when there are no live sponsorships", async () => {
    // A cancelled sponsorship is not "live", so the list is empty.
    const cancelled = { ...ACTIVE, status: "cancelled" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sponsorshipsMock.mockResolvedValue(page([cancelled]) as any);
    renderPage();

    expect(
      await screen.findByText(/لم تكفل طفلًا بعد/),
    ).toBeInTheDocument();
    expect(screen.getByText("تصفّح الأيتام المتاحين")).toBeInTheDocument();
  });
});
