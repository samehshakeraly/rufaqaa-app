import type { Page } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@dev.rufaqaa.app";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "admin12345";

/**
 * Sign in as the seeded admin and wait until we land on the admin
 * dashboard. Used by E2E specs that exercise admin flows so each one
 * doesn't re-implement the login dance.
 */
export async function adminLogin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.locator("#login-password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /(sign in|دخول)/i }).click();
  await page.waitForURL(/\/admin\/dashboard$/);
}
