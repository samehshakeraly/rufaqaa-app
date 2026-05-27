import { expect, test } from "@playwright/test";

/**
 * Landing → /orphans → click an available orphan → "Sponsor" →
 * /signup with intent — auto-redirects to /sponsor/<code>/checkout
 * after verification → submit → /payments/initiate is intercepted at
 * the network layer → assert browser redirected to MyFatoorah's URL.
 *
 * This requires at least one orphan in case_status='available' to be
 * visible on /public/orphans. CI seeds an orphan via the bulk demo
 * script in PR #3 (`2ba73e4`), so this spec relies on that data being
 * present.
 */
test("anon → signup → checkout redirects to MyFatoorah", async ({
  page,
  context,
}) => {
  const email = `e2e-pay-${Date.now()}@example.com`;

  // 1. Browse to public list
  await page.goto("/orphans");
  // Wait for at least one card link
  const firstCard = page
    .getByRole("link", { name: /(view & sponsor|عرض وكفالة)/i })
    .first();
  // If there are no orphans in this environment, skip the rest of the
  // assertions — the rest of the suite still covers signup + dashboard.
  const hasOrphan = (await firstCard.count()) > 0;
  test.skip(!hasOrphan, "No available orphan present in this environment");

  await firstCard.click();
  await expect(page).toHaveURL(/\/orphans\/[A-Z0-9-]+$/);

  // 2. Hit "Sponsor" — anon, so we go to /signup with intent
  await page
    .getByRole("link", { name: /(sponsor this child|كفالة هذا الطفل)/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup\?intent=sponsor:/);

  // 3. Sign up
  await page.getByLabel(/(full name|الاسم الكامل)/i).fill("Pay E2E");
  await page.getByLabel(/(email|البريد)/i).fill(email);
  await page.getByLabel(/(password|كلمة المرور)/i).fill("longenoughpw1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /(sign up|إنشاء الحساب)/i }).click();

  // 4. Verification flow auto-runs in dev mode; should arrive on checkout
  await expect(page).toHaveURL(/\/sponsor\/[A-Z0-9-]+\/checkout$/, {
    timeout: 15_000,
  });

  // 5. Intercept /payments/initiate
  const fakeGatewayUrl =
    "https://apitest.myfatoorah.com/checkout/e2e-fake-donor";
  await context.route("**/api/v1/payments/initiate", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        payment_id: "00000000-0000-0000-0000-000000000000",
        invoice_id: "e2e-fake",
        payment_url: fakeGatewayUrl,
      }),
    });
  });
  let landedAt: string | null = null;
  await context.route(fakeGatewayUrl, async (route) => {
    landedAt = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>fake gateway</title>OK",
    });
  });

  await page.getByRole("button", { name: /(pay now|ادفع)/i }).click();

  await expect.poll(() => landedAt, { timeout: 5_000 }).toBe(fakeGatewayUrl);
});
