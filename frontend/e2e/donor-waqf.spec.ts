import { expect, test } from "@playwright/test";

/**
 * PR-W01 — the orphans waqf (/donor/waqf).
 *
 * Same interception style as donor-payments.spec.ts: sign up a real
 * donor for a valid token, stub the donor-scoped endpoints at the
 * network layer, then walk the whole path a donor actually takes —
 * dashboard → the header gate → the waqf page → submit — and assert the
 * REQUEST BODY that reaches POST /payments/initiate: tagged for the
 * waqf, and carrying no child and no sponsorship.
 */
test("donor reaches the waqf from the dashboard gate and initiates a tagged payment", async ({
  page,
  context,
}) => {
  const CHECKOUT_URL = "https://gateway.example.test/checkout/INV-WAQF";

  // The dashboard's own four datasets — empty is a legitimate state and
  // the gates must be reachable in it.
  for (const path of [
    "**/api/v1/me/sponsorships*",
    "**/api/v1/me/reports*",
    "**/api/v1/me/messages*",
  ]) {
    await context.route(path, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
      });
    });
  }

  // Two completed waqf payments in one currency + one in another: the
  // "my contribution" card must show the dominant currency's total and
  // count the rest, never a cross-currency sum.
  await context.route("**/api/v1/me/payments*", async (route) => {
    const base = {
      amount_in_default_currency: null,
      payment_method: "credit_card",
      receipt_issued_at: null,
      receipt_number: null,
      receipt_url: null,
      sponsorship_id: null,
      orphan_id: null,
      gateway_transaction_id: null,
      bank_reference: null,
      orphan_name: null,
      orphan_code: null,
      status: "completed",
      target_type: "waqf",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            ...base,
            id: "w-1",
            code: "PAY-W1",
            amount: "50.000",
            currency: "KWD",
            initiated_at: "2026-08-01T10:00:00Z",
            completed_at: "2026-08-01T10:01:00Z",
          },
          {
            ...base,
            id: "w-2",
            code: "PAY-W2",
            amount: "100.000",
            currency: "KWD",
            initiated_at: "2026-08-05T10:00:00Z",
            completed_at: "2026-08-05T10:01:00Z",
          },
          {
            ...base,
            id: "w-3",
            code: "PAY-W3",
            amount: "9000.00",
            currency: "USD",
            initiated_at: "2026-08-06T10:00:00Z",
            completed_at: "2026-08-06T10:01:00Z",
          },
        ],
        total: 3,
        limit: 100,
        offset: 0,
      }),
    });
  });

  // Capture the initiate body and answer with a gateway URL, so the page
  // "redirects" without leaving the app under test.
  let initiateBody: Record<string, unknown> | null = null;
  await context.route("**/api/v1/payments/initiate", async (route) => {
    initiateBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        payment_id: "pay-waqf-1",
        invoice_id: "INV-WAQF",
        payment_url: CHECKOUT_URL,
      }),
    });
  });
  // …and swallow the redirect itself.
  await context.route(CHECKOUT_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>gateway</body></html>",
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

  // --- Sign up a real donor so the portal mounts with a valid token. --
  const email = `waqf-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();
  await page.locator("#sg-first").fill("Waqf");
  await page.locator("#sg-last").fill("E2E");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: /(create account|إنشاء الحساب)/i }).click();
  await page
    .getByRole("button", {
      name: /(go to verification page|الذهاب لصفحة التحقّق)/i,
    })
    .click();
  await page.waitForURL(/\/donor\/dashboard$/, { timeout: 15_000 });

  // --- The dashboard header gate, present even with zero sponsorships.
  const gates = page.getByRole("navigation", { name: "بوّابات التبرّع" });
  await expect(gates.getByRole("link", { name: /احسب زكاتك/ })).toHaveAttribute(
    "href",
    "/donor/zakat",
  );
  await gates.getByRole("link", { name: /وقف الأيتام/ }).click();
  await page.waitForURL(/\/donor\/waqf$/);

  // --- The page. -----------------------------------------------------
  await expect(
    page.getByRole("heading", { name: "صدقة جارية", level: 1 }),
  ).toBeVisible();
  // The fixed line: zakat is not paid here.
  await expect(page.getByText(/لا تُؤدّى الزكاة من هنا/)).toBeVisible();

  // "My contribution": KWD dominates on count, so 150 — never 9150.
  const mine = page.getByRole("region", { name: "وقفك حتى الآن" });
  await expect(mine).toContainText("150");
  await expect(mine).not.toContainText("9,150");
  await expect(mine).toContainText("وعملة أخرى واحدة");

  // --- Pick a preset and give. ---------------------------------------
  const amounts = page.getByRole("group", { name: "المبلغ" });
  await amounts.getByRole("button", { name: /100/ }).click();
  const submit = page.getByRole("button", { name: /أوقِف الآن/ });
  await expect(submit).toContainText("100");
  await submit.click();

  await expect
    .poll(() => initiateBody, { timeout: 10_000 })
    .not.toBeNull();
  expect(initiateBody).toMatchObject({
    amount: "100",
    currency: "KWD",
    target_type: "waqf",
    language: "ar",
  });
  // A pool donation never names a beneficiary — the backend 422s if it does.
  expect(initiateBody).not.toHaveProperty("sponsorship_id");
  expect(initiateBody).not.toHaveProperty("orphan_id");
});
