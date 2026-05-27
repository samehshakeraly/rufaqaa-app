import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dev.rufaqaa.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin12345";

/**
 * Full checkout flow with the MyFatoorah call intercepted at the
 * network layer:
 *
 *   1. log in as admin
 *   2. land on /orphans, click into the first orphan
 *   3. hit "Sponsor"
 *   4. fill amount + donor on the checkout form
 *   5. submit → /payments/initiate is intercepted to return a fake URL
 *   6. assert window.location was sent to that URL
 *
 * Doesn't talk to the real MyFatoorah sandbox — the unit / integration
 * suite covers the gateway contract. This proves the SPA stitches
 * everything together: page → API call → redirect.
 */
test("admin can start a MyFatoorah checkout from an orphan", async ({
  page,
  context,
}) => {
  // 1. sign in
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /(sign in|دخول)/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 2. find an orphan
  await page.goto("/orphans");
  const firstOrphanLink = page.locator("table tbody tr a").first();
  await firstOrphanLink.waitFor();
  await firstOrphanLink.click();
  await expect(page).toHaveURL(/\/orphans\/[0-9a-f-]+$/);

  // 3. checkout
  await page.getByRole("link", { name: /(sponsor|كفالة)/i }).first().click();
  await expect(page).toHaveURL(/\/sponsor\/[0-9a-f-]+\/checkout$/);

  // 4. fill the form — pick the first donor in the dropdown
  await page.locator("select").first().selectOption({ index: 1 });

  // 5. intercept the initiate call → fake URL we control
  const fakeGatewayUrl = "https://apitest.myfatoorah.com/checkout/e2e-fake";
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

  // Stop the redirect from leaving the test (the fake URL isn't real)
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

  // 6. browser was sent to the fake gateway URL
  await expect.poll(() => landedAt, { timeout: 5_000 }).toBe(fakeGatewayUrl);
});

test("/payment/success renders confirmation + receipt link", async ({ page }) => {
  await page.goto(
    "/payment/success?payment_id=00000000-0000-0000-0000-000000000000",
  );
  await expect(
    page.getByRole("heading", { name: /(payment received|تم استلام)/i }),
  ).toBeVisible();
  // Receipt button targets the payment_id we passed
  const receiptLink = page.getByRole("link", {
    name: /(download receipt|تحميل الإيصال)/i,
  });
  await expect(receiptLink).toBeVisible();
  await expect(receiptLink).toHaveAttribute(
    "href",
    /\/payments\/00000000-0000-0000-0000-000000000000\/receipt$/,
  );
});

test("/payment/failure renders error + try-again", async ({ page }) => {
  await page.goto("/payment/failure?payment_id=abc");
  await expect(
    page.getByRole("heading", { name: /(payment could not|لم يكتمل)/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /(try again|حاول مرة)/i }),
  ).toBeVisible();
});
