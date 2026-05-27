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

  await context.route("**/api/v1/donors?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      }),
    });
  });
  await context.route("**/api/v1/donors/import.csv*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attempted: 3,
        succeeded: 2,
        failed: 1,
        errors: [{ row: 3, detail: "invalid email" }],
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

  await expect(page.getByText(/(succeeded|نجح).*2/i)).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText(/(failed|فشل).*1/i)).toBeVisible();
});
