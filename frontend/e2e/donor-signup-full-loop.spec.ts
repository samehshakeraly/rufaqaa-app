import { expect, test } from "@playwright/test";

/**
 * Landing → /signup → fill → submit → /verify-email auto-verifies via
 * the debug token sessionStorage seed → /donor/dashboard.
 *
 * The backend echoes the verification token in non-production via
 * `debug_verify_token`. The SignupPage stashes that in sessionStorage
 * and the VerifyEmailPendingPage auto-verifies on mount. So this loop
 * needs no email server.
 */
test("anon donor can sign up, verify, and land on the dashboard", async ({
  page,
}) => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  // 1. Landing
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /(sponsor|اكفل)/i }).first(),
  ).toBeVisible();

  // 2. Signup
  await page
    .getByRole("link", { name: /(sign up|أنشئ حساباً|create an account)/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup$/);

  await page.getByLabel(/(full name|الاسم الكامل)/i).fill("E2E Donor");
  await page.getByLabel(/(email|البريد)/i).fill(email);
  await page.getByLabel(/(password|كلمة المرور)/i).fill("longenoughpw1");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /(sign up|إنشاء الحساب)/i }).click();

  // 3. Verify-email — debug token is auto-used
  await expect(page).toHaveURL(/\/verify-email/);

  // 4. Lands on the donor dashboard
  await expect(page).toHaveURL(/\/donor\/dashboard$/, { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /(welcome back|أهلاً بعودتك)/i }),
  ).toBeVisible();
});
