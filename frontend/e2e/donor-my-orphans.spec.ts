import { expect, test } from "@playwright/test";

/**
 * PR-D06 — the redesigned donor "My Orphans" list (/donor/orphans).
 *
 * Same interception style as donor-orphan-journey.spec.ts: sign up a real
 * donor for a valid token, stub the three donor-scoped data endpoints at
 * the network layer, then walk the page: impact bar, priority order
 * (overdue → unread message → active), the "تحتاج انتباهك" filter chip,
 * opening a card through its named link, and coming back to the list.
 */
test("donor walks My Orphans: impact bar, priority, filter, open card, back", async ({
  page,
  context,
}) => {
  const OVERDUE_ID = "11111111-1111-1111-1111-111111111111";
  const MESSAGE_ID = "22222222-2222-2222-2222-222222222222";
  const PLAIN_ID = "33333333-3333-3333-3333-333333333333";

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthsFromNow = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return iso(d);
  };

  const base = {
    donor_id: "d-1",
    monthly_amount: "30",
    currency: "USD",
    end_date: null,
    payment_frequency: "monthly",
    payments_count: 10,
    created_at: "2025-01-01T00:00:00Z",
    donor_code: "DNR-1",
    donor_name: "Donor",
  };

  await context.route("**/api/v1/me/sponsorships*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            ...base,
            id: "s-plain",
            code: "SPN-3",
            orphan_id: PLAIN_ID,
            orphan_code: "ORF-3",
            orphan_name: "آدم",
            status: "active",
            start_date: "2025-01-01",
            total_paid: "510",
            next_payment_date: monthsFromNow(1),
          },
          {
            ...base,
            id: "s-message",
            code: "SPN-2",
            orphan_id: MESSAGE_ID,
            orphan_code: "ORF-2",
            orphan_name: "عائشة",
            status: "active",
            start_date: "2025-03-01",
            total_paid: "330",
            next_payment_date: monthsFromNow(2),
          },
          {
            ...base,
            id: "s-overdue",
            code: "SPN-1",
            orphan_id: OVERDUE_ID,
            orphan_code: "ORF-1",
            orphan_name: "مريم",
            status: "overdue",
            start_date: "2025-02-01",
            total_paid: "240",
            next_payment_date: monthsFromNow(-2),
          },
        ],
        total: 3,
        limit: 100,
        offset: 0,
      }),
    });
  });

  await context.route("**/api/v1/me/reports*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
    });
  });

  await context.route("**/api/v1/donor/me/messages*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "m-1",
            from_role: "orphan",
            from_name: "عائشة",
            to_role: "donor",
            to_name: "Donor",
            orphan_code: "ORF-2",
            message_type: "text",
            content: "أنهيت حفظ سورة الملك!",
            moderation_status: "approved",
            moderation_notes: null,
            is_read: false,
            is_mine: false,
            created_at: "2026-08-15T10:00:00Z",
            moderated_at: "2026-08-15T12:00:00Z",
            read_at: null,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    });
  });

  // Minimal detail-page stubs so opening a card renders D-07.
  await context.route("**/api/v1/me/sponsorships/*/profile", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ first_name: "مريم" }),
    });
  });
  await context.route("**/api/v1/me/sponsorships/*/messages*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
    });
  });

  // Pin the app to Arabic before any script runs (see journey spec).
  await context.addInitScript(() => {
    try {
      localStorage.setItem("rufaqaa.lang", "ar");
    } catch {
      /* storage may be unavailable on the very first about:blank */
    }
  });

  // --- Sign up a real donor so the page mounts with a valid token. ---
  const email = `my-orphans-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();
  await page.locator("#sg-first").fill("MyOrphans");
  await page.locator("#sg-last").fill("E2E");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: /(create account|إنشاء الحساب)/i }).click();
  await page
    .getByRole("button", {
      name: /(go to verification page|الذهاب لصفحة التحقّق)/i,
    })
    .click();
  await page.waitForURL(/\/donor\/dashboard$/, { timeout: 15_000 });

  // --- Load. ---------------------------------------------------------
  await page.goto("/donor/orphans");
  await expect(page.getByRole("heading", { name: "أيتامي", level: 1 })).toBeVisible();

  // Impact bar summarizes the live sponsorships.
  const impact = page.getByRole("region", { name: "خلاصة أثرك" });
  await expect(impact.getByText(/ترعى 3 من الأطفال/)).toBeVisible();
  await expect(impact.getByText("التزامك الشهري")).toBeVisible();

  // Priority order: overdue مريم first, then عائشة (unread), then آدم.
  const names = page.getByRole("heading", { level: 3 });
  await expect(names).toHaveText(["مريم", "عائشة", "آدم"]);

  // The overdue card carries the warm renew CTA; the unread card its badge.
  await expect(
    page.getByRole("link", { name: "جدّد الكفالة الآن" }),
  ).toBeVisible();
  await expect(page.getByText("رسالة جديدة من عائشة")).toBeVisible();

  // --- Filter. -------------------------------------------------------
  await page.getByRole("button", { name: /تحتاج انتباهك/ }).click();
  await expect(names).toHaveText(["مريم", "عائشة"]);
  await page.getByRole("button", { name: /الكل/ }).click();
  await expect(names).toHaveText(["مريم", "عائشة", "آدم"]);

  // --- Open a card through its named link, then come back. ----------
  // exact: the icon actions ("راسل مريم", "ملف مريم وتقاريره") also
  // contain the name, so a substring match would be ambiguous.
  await page.getByRole("link", { name: "مريم", exact: true }).click();
  await page.waitForURL(new RegExp(`/donor/orphans/${OVERDUE_ID}$`));

  await page.goBack();
  await page.waitForURL(/\/donor\/orphans$/);
  await expect(names).toHaveText(["مريم", "عائشة", "آدم"]);
});
