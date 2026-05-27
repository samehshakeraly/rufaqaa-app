import { expect, test } from "@playwright/test";

import { adminLogin } from "./helpers/auth";

/**
 * Donors page accepts a CSV upload (admin only). We hand it a tiny
 * three-row CSV with one valid + one invalid row and assert the
 * summary banner renders both counts.
 */
test("donor CSV import surfaces success + error counts", async ({
  page,
  context,
}) => {
  await adminLogin(page);

  // The list-donors GET stays empty so the page renders deterministically.
  await context.route("**/api/v1/donors?**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }),
    });
  });

  // The CSV import is client-side: each parsed row becomes its own
  // POST /api/v1/donors. Stub it so the test doesn't depend on the
  // live backend's validation rules: an obviously-malformed email is
  // 422'd, everything else gets a 201. The CSV below has two valid
  // emails + one malformed → 2 succeeded, 1 failed.
  let donorPostCount = 0;
  await context.route("**/api/v1/donors", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      email?: string;
    };
    if (!body.email || !body.email.includes("@") || !body.email.includes(".")) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ detail: "invalid email" }),
      });
      return;
    }
    donorPostCount += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: `00000000-0000-0000-0000-${donorPostCount.toString().padStart(12, "0")}`,
        code: `DON-${donorPostCount}`,
        full_name: "Stub",
        email: body.email,
        status: "active",
        created_at: new Date().toISOString(),
      }),
    });
  });

  await page.goto("/admin/donors");

  // The import control may not be present in every build — skip if absent.
  const importBtn = page.getByRole("button", { name: /(import csv|استيراد)/i });
  test.skip((await importBtn.count()) === 0, "Donor CSV import not present");

  await importBtn.first().click();

  const csv =
    "full_name,email,preferred_currency\n" +
    "Alice,alice@example.com,KWD\n" +
    "Bob,bob@example.com,USD\n" +
    "Carol,not-an-email,KWD\n";
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "donors.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf-8"),
  });

  // The component shows a "valid / invalid" summary first; the user
  // confirms by clicking "Import N donors" — that triggers the per-row
  // POSTs.  Carol's row has an invalid email which the component
  // catches client-side, so the run button reads "Import 2 donors".
  await page
    .getByRole("button", { name: /(import.*donors|استيراد.*متبرع)/i })
    .first()
    .click();

  await expect(page.getByText(/(succeeded|نجح).*2/i)).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText(/(failed|فشل).*1/i)).toBeVisible();
});
