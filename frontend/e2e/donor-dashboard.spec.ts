import { expect, test } from "@playwright/test";

/**
 * PR-D01 — the rebuilt donor dashboard (/donor/dashboard) as the
 * "today" screen.
 *
 * Same interception style as donor-my-orphans.spec.ts: sign up a real
 * donor for a valid token, stub the four donor-scoped data endpoints at
 * the network layer, then walk the page: attention bar → impact strip →
 * children timeline → next payment → and out to My Payments and My
 * Orphans through the dashboard's own links.
 */
test("donor walks the dashboard: attention, impact, timeline, next payment, exits", async ({
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
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString();

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
      body: JSON.stringify({
        items: [
          {
            id: "r-1",
            orphan_id: PLAIN_ID,
            milestone_label: "أتمّ حفظ سورة الملك",
            published_at: daysAgo(5),
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
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
            created_at: daysAgo(1),
            moderated_at: daysAgo(1),
            read_at: null,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    });
  });

  await context.route("**/api/v1/me/payments*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "p-1",
            code: "PAY-1001",
            amount: "90",
            amount_in_default_currency: null,
            currency: "USD",
            payment_method: "credit_card",
            status: "completed",
            initiated_at: daysAgo(20),
            completed_at: daysAgo(20),
            receipt_issued_at: null,
            receipt_number: null,
            receipt_url: null,
            sponsorship_id: "s-plain",
            orphan_id: PLAIN_ID,
            gateway_transaction_id: null,
            bank_reference: null,
            orphan_name: "آدم",
            orphan_code: "ORF-3",
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
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
  const email = `dashboard-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();
  await page.locator("#sg-first").fill("Dashboard");
  await page.locator("#sg-last").fill("E2E");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: /(create account|إنشاء الحساب)/i }).click();
  await page
    .getByRole("button", {
      name: /(go to verification page|الذهاب لصفحة التحقّق)/i,
    })
    .click();
  await page.waitForURL(/\/donor\/dashboard$/, { timeout: 15_000 });

  // --- Attention bar: the overdue child leads with the warm renew CTA. ---
  const renew = page.getByRole("link", { name: "جدّد كفالة مريم" });
  await expect(renew).toBeVisible();
  await expect(renew).toHaveAttribute("href", "/sponsor/ORF-1/checkout");
  await expect(page.getByText(/تأخّرت دفعة مريم/)).toBeVisible();
  // The unread-messages row names the child and links to messages.
  await expect(page.getByText(/رسالة جديدة واحدة من عائشة/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "اقرأ الرسائل" }),
  ).toHaveAttribute("href", "/donor/messages");

  // --- Impact strip: totals through formatMoney, never raw numbers. ---
  const impact = page.getByRole("region", { name: "خلاصة عطائك" });
  await expect(impact.getByText("التزامك الشهري")).toBeVisible();
  // total_paid 510+330+240 USD = 1,080.00.
  await expect(impact.getByText(/1,080\.00/)).toBeVisible();
  // This year's completed payment (90 USD).
  await expect(impact.getByText(/90\.00/)).toBeVisible();

  // --- Children timeline: message + milestone wording. ---
  await expect(page.getByText("عائشة أرسل إليك رسالة")).toBeVisible();
  await expect(
    page.getByText("إنجاز جديد لـآدم: أتمّ حفظ سورة الملك"),
  ).toBeVisible();

  // --- Next payment: the soonest ACTIVE payment (آدم, not the overdue). ---
  await expect(page.getByText("دفعتك القادمة")).toBeVisible();
  await expect(page.getByText("لأجل آدم")).toBeVisible();

  // --- Exit 1: to My Payments through the next-payment card. ---
  await page.getByRole("link", { name: "كل مدفوعاتي" }).click();
  await page.waitForURL(/\/donor\/payments$/);
  await expect(
    page.getByRole("heading", { name: "مدفوعاتي", level: 1 }),
  ).toBeVisible();

  // --- Back, then exit 2: to My Orphans through the timeline header. ---
  await page.goBack();
  await page.waitForURL(/\/donor\/dashboard$/);
  await page.getByRole("link", { name: "كل أيتامي" }).click();
  await page.waitForURL(/\/donor\/orphans$/);
  await expect(
    page.getByRole("heading", { name: "أيتامي", level: 1 }),
  ).toBeVisible();
});
