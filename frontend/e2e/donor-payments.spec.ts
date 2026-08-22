import { expect, test } from "@playwright/test";

/**
 * PR-D08 — the donor "My Payments" page (/donor/payments).
 *
 * Same interception style as donor-my-orphans.spec.ts: sign up a real
 * donor for a valid token, stub the two donor-scoped data endpoints at
 * the network layer, then walk the page: the year summary, the "needs
 * completing" section, status filtering, the receipt link, and the
 * permanent redirect from the old /donor/sponsorships route.
 */
test("donor walks My Payments: summary, needs-completing, filter, receipt, redirect", async ({
  page,
  context,
}) => {
  const RECEIPT_URL = "https://receipts.example.test/PAY-1.pdf";

  await context.route("**/api/v1/me/sponsorships*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "s-active",
            code: "SPN-1",
            donor_id: "d-1",
            orphan_id: "11111111-1111-1111-1111-111111111111",
            monthly_amount: "45.000",
            currency: "KWD",
            start_date: "2025-06-01",
            end_date: null,
            payment_frequency: "monthly",
            status: "active",
            total_paid: "540.000",
            payments_count: 12,
            next_payment_date: "2026-10-01",
            created_at: "2025-06-01T00:00:00Z",
            donor_code: "DNR-1",
            donor_name: "Donor",
            orphan_code: "ORF-1",
            orphan_name: "أحمد",
          },
          {
            id: "s-pending",
            code: "SPN-2",
            donor_id: "d-1",
            orphan_id: "22222222-2222-2222-2222-222222222222",
            monthly_amount: "40.000",
            currency: "KWD",
            start_date: "2026-08-01",
            end_date: null,
            payment_frequency: "monthly",
            status: "pending",
            total_paid: "0.000",
            payments_count: 0,
            next_payment_date: null,
            created_at: "2026-08-01T00:00:00Z",
            donor_code: "DNR-1",
            donor_name: "Donor",
            orphan_code: "ORF-2",
            orphan_name: "لُجين",
          },
        ],
        total: 2,
        limit: 100,
        offset: 0,
      }),
    });
  });

  await context.route("**/api/v1/me/payments*", async (route) => {
    const base = {
      amount_in_default_currency: null,
      currency: "KWD",
      payment_method: "credit_card",
      receipt_issued_at: null,
      receipt_number: null,
      receipt_url: null,
      sponsorship_id: null,
      orphan_id: null,
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            ...base,
            id: "p-1",
            code: "PAY-1",
            amount: "45.000",
            status: "completed",
            initiated_at: "2026-08-10T10:00:00Z",
            completed_at: "2026-08-10T10:01:00Z",
            receipt_number: "RC-1",
            receipt_url: RECEIPT_URL,
            sponsorship_id: "s-active",
            orphan_id: "11111111-1111-1111-1111-111111111111",
          },
          {
            ...base,
            id: "p-2",
            code: "PAY-2",
            amount: "45.000",
            status: "failed",
            initiated_at: "2026-08-03T10:00:00Z",
            completed_at: null,
            sponsorship_id: "s-active",
            orphan_id: "11111111-1111-1111-1111-111111111111",
          },
          {
            ...base,
            id: "p-3",
            code: "PAY-3",
            amount: "100.000",
            status: "processing",
            initiated_at: "2026-07-20T10:00:00Z",
            completed_at: null,
          },
        ],
        total: 3,
        limit: 25,
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
  const email = `my-payments-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();
  await page.locator("#sg-first").fill("MyPayments");
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
  await page.goto("/donor/payments");
  await expect(
    page.getByRole("heading", { name: "مدفوعاتي", level: 1 }),
  ).toBeVisible();

  // Year summary: the single completed KWD payment, never a mixed sum.
  const summary = page.getByRole("region", { name: "ملخّص السنة" });
  await expect(summary.getByText(/45\.000/)).toBeVisible();
  await expect(summary.getByText("عبر 1 عملية ناجحة")).toBeVisible();
  await expect(
    summary.getByRole("button", { name: "تصدير كشف السنة" }),
  ).toBeVisible();

  // "Needs completing" gathers the unpaid sponsorship + the failed
  // payment, each with its own exit. (Heading role — the page subtitle
  // contains the same words.)
  await expect(
    page.getByRole("heading", { name: "يحتاج إتمامه" }),
  ).toBeVisible();
  await expect(page.getByText("كفالة لُجين لم تكتمل")).toBeVisible();
  await expect(page.getByRole("link", { name: "أتمّ الدفع" })).toHaveAttribute(
    "href",
    "/sponsor/ORF-2/checkout",
  );

  // --- Filter. -------------------------------------------------------
  const table = page.getByRole("table");
  await expect(table.getByText("PAY-1")).toBeVisible();
  await page.getByRole("button", { name: /لم تتم/ }).click();
  await expect(table.getByText("PAY-1")).toBeHidden();
  await expect(table.getByText("PAY-2")).toBeVisible();
  await page.getByRole("button", { name: /الكل/ }).click();
  await expect(table.getByText("PAY-1")).toBeVisible();

  // --- Receipt link on the completed row. ---------------------------
  const receipt = page.getByRole("link", { name: /تنزيل إيصال العملية PAY-1/ });
  await expect(receipt.first()).toHaveAttribute("href", RECEIPT_URL);

  // --- The old route permanently redirects. -------------------------
  await page.goto("/donor/sponsorships");
  await page.waitForURL(/\/donor\/payments$/);
  await expect(
    page.getByRole("heading", { name: "مدفوعاتي", level: 1 }),
  ).toBeVisible();
});
