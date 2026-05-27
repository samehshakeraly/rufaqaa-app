import { expect, test } from "@playwright/test";

/**
 * /forgot-password → request reset → /reset-password with token →
 * /login with the new password.
 *
 * Backend stamps the token + emails it in production; in dev mode
 * the /auth/forgot endpoint returns the token directly in the
 * response when settings.AUTH_DEV_TOKENS is enabled. We intercept
 * the endpoint and inject one so the loop is hermetic.
 */
test("forgot → reset → login with new password", async ({ page, context }) => {
  const email = `forgot-${Date.now()}@example.com`;
  const newPassword = "new-strong-password-1";
  const token = "dev-token-abc";
  let tokenConsumed = false;

  await context.route("**/api/v1/auth/forgot", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", dev_token: token }),
    });
  });
  await context.route("**/api/v1/auth/reset-password", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (body.token === token) tokenConsumed = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
  await context.route("**/api/v1/auth/login", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    if (body.password === newPassword) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "tok",
          refresh_token: "ref",
          token_type: "bearer",
          user: {
            id: "u1",
            email,
            role: "admin",
            organization_id: "org",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "bad credentials" }),
    });
  });

  await page.goto("/forgot-password");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: /(send|إرسال)/i }).click();
  // anti-enumeration: the page should show a generic "check your email" notice
  await expect(page.locator("text=/(check|راجع)/i").first()).toBeVisible({
    timeout: 5000,
  });

  // Go directly to the reset page with the token.
  await page.goto(`/reset-password?token=${token}`);
  // The page expects token + new password.
  await page.getByLabel(/(password|كلمة)/i).first().fill(newPassword);
  // Some implementations require confirmation — fill if present.
  const confirm = page.getByLabel(/(confirm|تأكيد)/i).first();
  if ((await confirm.count()) > 0) {
    await confirm.fill(newPassword);
  }
  await page.getByRole("button", { name: /(reset|إعادة)/i }).click();
  await expect.poll(() => tokenConsumed, { timeout: 5000 }).toBe(true);

  // Final leg — log in with the new password.
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(newPassword);
  await page.getByRole("button", { name: /(sign in|دخول)/i }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/, { timeout: 10_000 });
});
