import { expect, test } from "@playwright/test";

/**
 * Sign up Donor A and Donor B in two separate browser contexts.
 * Donor A inspects their /donor/me — gets their own profile, not B's.
 * Direct access to /admin/* from a donor token redirects away.
 */
test("donor A and donor B see different profiles; donor cannot reach /admin", async ({
  browser,
}) => {
  const a = await browser.newContext();
  const b = await browser.newContext();

  const pageA = await a.newPage();
  const pageB = await b.newPage();

  async function signupAndVerify(page: import("@playwright/test").Page) {
    const email = `iso-${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
    await page.goto("/signup");
    await page.getByLabel(/(full name|الاسم)/i).fill(`Iso ${email.slice(0, 6)}`);
    await page.getByLabel(/(email|البريد)/i).fill(email);
    await page.getByLabel(/(password|كلمة المرور)/i).fill("longenoughpw1");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /(sign up|إنشاء)/i }).click();
    await page.waitForURL(/\/donor\/dashboard$/, { timeout: 15_000 });
    return email;
  }

  const emailA = await signupAndVerify(pageA);
  const emailB = await signupAndVerify(pageB);
  expect(emailA).not.toBe(emailB);

  // Each donor sees their own dashboard
  await expect(pageA.getByText(emailA, { exact: false })).not.toBeVisible({
    timeout: 1000,
  });
  // The welcome heading mentions their first name; the email lives in
  // profile. Check that the profile pages show different emails.
  await pageA.goto("/donor/profile");
  await pageB.goto("/donor/profile");
  const aEmail = await pageA.locator("input[disabled]").first().inputValue();
  const bEmail = await pageB.locator("input[disabled]").first().inputValue();
  expect(aEmail).toBe(emailA);
  expect(bEmail).toBe(emailB);
  expect(aEmail).not.toBe(bEmail);

  // A donor token cannot reach the admin area. The DonorRoute and
  // ProtectedRoute both intervene: navigating to /admin/users while
  // logged in as a donor pushes us back to a non-admin URL.
  await pageA.goto("/admin/users");
  await expect(pageA).not.toHaveURL(/\/admin\/users$/);

  await a.close();
  await b.close();
});
