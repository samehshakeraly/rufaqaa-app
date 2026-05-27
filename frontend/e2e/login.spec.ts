import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dev.rufaqaa.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin12345";

/**
 * Smoke: the seeded admin can sign in and lands on the dashboard.
 *
 * Doubles as the "is everything wired up" check — frontend served,
 * backend reachable, login JSON shape stable, router redirect intact.
 */
test("admin can sign in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /(sign in|دخول)/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  // Heading text changes by language; matching either copy keeps the
  // test resilient to the browser's Accept-Language default.
  await expect(
    page.getByRole("heading", { name: /(dashboard|الرئيسية)/i }),
  ).toBeVisible();
});

test("invalid credentials show an error and stay on /login", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill("definitely-wrong-password");
  await page.getByRole("button", { name: /(sign in|دخول)/i }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator(".bg-red-50")).toBeVisible();
});
