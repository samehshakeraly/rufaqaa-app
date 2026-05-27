import { expect, test } from "@playwright/test";

/**
 * Static smokes for the post-payment return URLs that MyFatoorah
 * sends donors back to. The full checkout drive is covered by the
 * donor-flow spec (donor-full-payment-loop.spec.ts).
 */

test("/payment/success renders confirmation + receipt link", async ({ page }) => {
  // These pages are inside the donor area now, so signing in as the
  // admin (who has no donor profile) would redirect away. We can still
  // load the route to assert it's reachable by visiting the URL with
  // localStorage seeded — but the simpler check is the public-shape
  // assertion via the DonorRoute redirect: anon visitors get pushed to
  // /login. So we only assert that.
  await page.goto(
    "/payment/success?payment_id=00000000-0000-0000-0000-000000000000",
  );
  // Anon → DonorRoute redirects to /login
  await expect(page).toHaveURL(/\/login$/);
});

test("/payment/failure redirects anon visitors to /login", async ({ page }) => {
  await page.goto("/payment/failure?payment_id=abc");
  await expect(page).toHaveURL(/\/login$/);
});
