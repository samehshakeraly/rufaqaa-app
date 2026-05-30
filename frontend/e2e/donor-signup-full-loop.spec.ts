import { expect, test } from "@playwright/test";

/**
 * Landing → /signup → 3-step wizard (A-02) → "go to verification page" →
 * /verify-email auto-verifies via the debug token sessionStorage seed →
 * /donor/dashboard.
 *
 * The backend echoes the verification token in non-production via
 * `debug_verify_token`. The SignupPage stashes that in sessionStorage
 * and the VerifyEmailPendingPage auto-verifies on mount. So this loop
 * needs no email server. Stable `#sg-*` ids are used to disambiguate the
 * two password fields and stay language-agnostic.
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

  // 2. Signup — step 1 (account)
  await page
    .getByRole("link", { name: /(sign up|أنشئ حساباً|create an account)/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/signup$/);

  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();

  // 3. Step 2 (personal info) — names + terms gate, then create account.
  await page.locator("#sg-first").fill("E2E");
  await page.locator("#sg-last").fill("Donor");
  await page.getByRole("checkbox").click();
  await page
    .getByRole("button", { name: /(create account|إنشاء الحساب)/i })
    .click();

  // 4. Step 3 (verify email) — proceed to the verification page.
  await page
    .getByRole("button", {
      name: /(go to verification page|الذهاب لصفحة التحقّق)/i,
    })
    .click();

  // 5. Lands on the donor dashboard. We don't separately assert the
  // intermediate /verify-email URL: the page auto-verifies on mount
  // via the sessionStorage debug token, and the resulting transition
  // is fast enough to race the toHaveURL poll. Reaching the dashboard
  // implies the verify ran (DonorRoute would have bounced an
  // unverified user to /login otherwise).
  await expect(page).toHaveURL(/\/donor\/dashboard$/, { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /(welcome back|أهلاً بعودتك)/i }),
  ).toBeVisible();
});
