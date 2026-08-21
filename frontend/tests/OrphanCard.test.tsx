import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { OrphanCard } from "@/components/donor/OrphanCard";
import i18n from "@/i18n";
import type { OrphanCardData } from "@/lib/donorOrphans";
import { avatarPaletteIndex } from "@/lib/donorOrphans";
import type { Sponsorship } from "@/lib/sponsorships";

const NOW = new Date("2026-08-21T12:00:00Z");

function sponsorship(over: Partial<Sponsorship>): Sponsorship {
  return {
    id: "s-1",
    code: "SPN-1",
    donor_id: "d-1",
    orphan_id: "11111111-1111-1111-1111-111111111111",
    monthly_amount: "30",
    currency: "USD",
    start_date: "2025-06-01",
    end_date: null,
    payment_frequency: "monthly",
    status: "active",
    total_paid: "420",
    payments_count: 14,
    next_payment_date: "2026-09-01",
    created_at: "2025-06-01T00:00:00Z",
    donor_code: "DNR-1",
    donor_name: "كفيل",
    orphan_code: "ORF-99",
    orphan_name: "آدم",
    ...over,
  };
}

function makeCard(
  s: Partial<Sponsorship>,
  over?: Partial<Omit<OrphanCardData, "sponsorship">>,
): OrphanCardData {
  return {
    sponsorship: sponsorship(s),
    unreadCount: 0,
    latestUnreadAt: null,
    latestReport: null,
    ...over,
  };
}

function renderCard(card: OrphanCardData) {
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <OrphanCard card={card} now={NOW} />
      </MemoryRouter>
    </I18nextProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
});

describe("OrphanCard", () => {
  it("REGRESSION: a paused sponsorship never shows a next-payment date", () => {
    // The old page showed "دفعتك القادمة" for paused sponsorships because
    // its condition included status === "paused".
    renderCard(makeCard({ status: "paused", next_payment_date: "2026-09-01" }));
    expect(screen.queryByText(/دفعتك القادمة/)).not.toBeInTheDocument();
    expect(screen.getByText("موقوفة بطلبك")).toBeInTheDocument();
    // Paused primary action is the resume CTA.
    expect(
      screen.getByRole("link", { name: "استأنف الكفالة" }),
    ).toBeInTheDocument();
  });

  it("an active sponsorship still shows its next payment", () => {
    renderCard(makeCard({ status: "active" }));
    expect(screen.getByText(/دفعتك القادمة/)).toBeInTheDocument();
  });

  it("overdue → the primary action is the warm renew CTA on a warning token", () => {
    renderCard(makeCard({ status: "overdue" }));
    const renew = screen.getByRole("link", { name: "جدّد الكفالة الآن" });
    expect(renew).toHaveAttribute("href", "/sponsor/ORF-99/checkout");
    expect(renew.className).toMatch(/warning/);
    expect(renew.className).not.toMatch(/danger/);
  });

  it("an unread message shows the «جديد» badge, the count, and flips the primary action", () => {
    renderCard(
      makeCard(
        { status: "active" },
        { unreadCount: 3, latestUnreadAt: "2026-08-20T10:00:00Z" },
      ),
    );
    expect(screen.getByText("جديد")).toBeInTheDocument();
    expect(screen.getByText("رسالة جديدة من آدم")).toBeInTheDocument();
    // Count badge on the message icon action.
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "اقرأ الرسالة الجديدة" }),
    ).toBeInTheDocument();
  });

  it("the card is an <article> of SEPARATE actions — no link wraps it all", () => {
    const { container } = renderCard(
      makeCard({ status: "active" }, { unreadCount: 1, latestUnreadAt: "2026-08-20T10:00:00Z" }),
    );
    expect(container.querySelector("article")).not.toBeNull();
    // Nothing above the card is clickable: the article's PARENT chain has
    // no anchor, and the card exposes distinct tab stops instead.
    expect(container.querySelector("a > article")).toBeNull();
    const links = screen.getAllByRole("link");
    // name link + primary action + message icon + profile icon.
    expect(links.length).toBe(4);
  });

  it("every icon-only action carries an accessible name and a title", () => {
    renderCard(makeCard({ status: "active" }));
    const message = screen.getByRole("link", { name: "راسل آدم" });
    expect(message).toHaveAttribute("title", "راسل آدم");
    const profile = screen.getByRole("link", { name: "ملف آدم وتقاريره" });
    expect(profile).toHaveAttribute("title", "ملف آدم وتقاريره");
  });

  it("amounts render through formatMoney, not raw '420 USD'", () => {
    renderCard(makeCard({ status: "active", total_paid: "1465.000", currency: "KWD" }));
    // Latin digits, grouped + currency-formatted — never the raw string.
    expect(screen.queryByText(/1465\.000 KWD/)).not.toBeInTheDocument();
    expect(screen.getByText(/1,465/)).toBeInTheDocument();
  });

  it("avatar color derives deterministically from orphan_id", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    expect(avatarPaletteIndex(id, 6)).toBe(avatarPaletteIndex(id, 6));
    expect(avatarPaletteIndex(id, 6)).toBeGreaterThanOrEqual(0);
    expect(avatarPaletteIndex(id, 6)).toBeLessThan(6);
  });

  it("status renders as a pill, never a danger token", () => {
    const { container } = renderCard(makeCard({ status: "overdue" }));
    expect(container.innerHTML).not.toMatch(/danger/);
  });
});
