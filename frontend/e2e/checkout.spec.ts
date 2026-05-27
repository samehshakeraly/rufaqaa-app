import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dev.rufaqaa.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin12345";

async function adminLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /(sign in|دخول)/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Full checkout flow with the MyFatoorah call intercepted at the
 * network layer.
 *
 * We don't rely on the seeded DB having any orphans / donors — the
 * seed only creates org + partner + admin. Every list endpoint and
 * the orphan-detail endpoint is intercepted to return deterministic
 * fixtures, so the spec proves the SPA stitches everything together
 * (page → API call → redirect) without coupling to seed state.
 */
test("admin can start a MyFatoorah checkout from an orphan", async ({
  page,
  context,
}) => {
  const orphanId = "00000000-0000-0000-0000-000000000099";
  const donorId = "00000000-0000-0000-0000-000000000088";
  const orphanFixture = {
    id: orphanId,
    code: "ORP-E2E",
    first_name: "Test",
    middle_name: null,
    family_name: "Orphan",
    date_of_birth: "2015-01-01",
    gender: "M",
    case_status: "available",
    is_sponsored: false,
    current_balance: "0.00",
    created_at: new Date().toISOString(),
  };
  const donorFixture = {
    id: donorId,
    code: "DON-E2E",
    full_name: "E2E Donor",
    email: "donor@e2e.test",
    preferred_currency: "KWD",
    status: "active",
    created_at: new Date().toISOString(),
  };

  // The orphans list page hits /orphans? — return a single fixture row
  // so the table renders deterministically regardless of seed state.
  await context.route(/\/api\/v1\/orphans(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [orphanFixture],
        total: 1,
        limit: 20,
        offset: 0,
      }),
    });
  });

  // Detail endpoint for /orphans/{id} + sponsor checkout page lookup.
  await context.route(
    `**/api/v1/orphans/${orphanId}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(orphanFixture),
      });
    },
  );

  // Timeline endpoint that the detail page also hits.
  await context.route(
    `**/api/v1/orphans/${orphanId}/timeline`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      });
    },
  );

  // Donors dropdown on the checkout page.
  await context.route(/\/api\/v1\/donors\?/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [donorFixture],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    });
  });

  // The payment initiate call returns a fake MyFatoorah URL.
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

  // Stop the redirect from leaving the test (the fake URL isn't real).
  let landedAt: string | null = null;
  await context.route(fakeGatewayUrl, async (route) => {
    landedAt = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>fake gateway</title>OK",
    });
  });

  await adminLogin(page);

  // 2. Drill into the orphan list.
  await page.goto("/orphans");
  const firstOrphanLink = page.locator("table tbody tr a").first();
  await firstOrphanLink.waitFor();
  await firstOrphanLink.click();
  await expect(page).toHaveURL(/\/orphans\/[0-9a-f-]+$/);

  // 3. Hit the Sponsor link.
  await page.getByRole("link", { name: /(sponsor|كفالة)/i }).first().click();
  await expect(page).toHaveURL(/\/sponsor\/[0-9a-f-]+\/checkout$/);

  // 4. Pick the (single) donor in the dropdown.
  await page.locator("select").first().selectOption({ value: donorId });

  // 5. Submit.
  await page.getByRole("button", { name: /(pay now|ادفع)/i }).click();

  // 6. The browser was sent to the fake gateway URL.
  await expect.poll(() => landedAt, { timeout: 5_000 }).toBe(fakeGatewayUrl);
});

test("/payment/success renders confirmation + receipt link", async ({ page }) => {
  // These pages live inside the protected admin area in PR #4 — log in
  // first or ProtectedRoute redirects to /login.
  await adminLogin(page);

  await page.goto(
    "/payment/success?payment_id=00000000-0000-0000-0000-000000000000",
  );
  await expect(
    page.getByRole("heading", { name: /(payment received|تم استلام)/i }),
  ).toBeVisible();
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
  await adminLogin(page);

  await page.goto("/payment/failure?payment_id=abc");
  await expect(
    page.getByRole("heading", { name: /(payment could not|لم يكتمل)/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /(try again|حاول مرة)/i }),
  ).toBeVisible();
});
