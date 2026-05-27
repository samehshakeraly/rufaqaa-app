import { expect, test } from "@playwright/test";

import { adminLogin } from "./helpers/auth";

/**
 * Create a family, then add a guardian to it via the family detail
 * page. Verifies the right POSTs hit the right endpoints.
 */
test("admin creates a family + a guardian", async ({ page, context }) => {
  await adminLogin(page);

  const familyId = "77777777-7777-7777-7777-777777777777";
  let familyCreated = false;
  let guardianCreated = false;

  await context.route("**/api/v1/families**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "POST" && url.endsWith("/families")) {
      familyCreated = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: familyId,
          code: "FAM-E2E",
          organization_id: "org",
          family_name: "Test Family",
          deceased_father_name: null,
          country_code: null,
          city: null,
          housing_status: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    }
    if (method === "GET" && url.includes(familyId)) {
      if (url.endsWith("/guardians")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: familyId,
          code: "FAM-E2E",
          family_name: "Test Family",
          deceased_father_name: null,
          country_code: null,
          city: null,
          housing_status: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    }
    if (method === "POST" && url.includes(`/families/${familyId}/guardians`)) {
      guardianCreated = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "g1",
          organization_id: "org",
          family_id: familyId,
          full_name: "Mother",
          relation: "mother",
          phone: null,
          email: null,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 }),
    });
  });

  // Create the family on the families list page.
  await page.goto("/admin/families");
  const newFamBtn = page.getByRole("button", { name: /(add family|إضافة أسرة)/i });
  test.skip((await newFamBtn.count()) === 0, "Family create UI not present");
  await newFamBtn.first().click();
  await page.locator("form input").first().fill("Test Family");
  await page.locator('form button[type="submit"]').click();
  await expect.poll(() => familyCreated, { timeout: 5000 }).toBe(true);

  // Now go to the detail page and add a guardian.
  await page.goto(`/admin/families/${familyId}`);
  const addGBtn = page.getByRole("button", { name: /(add guardian|إضافة الولي)/i });
  test.skip((await addGBtn.count()) === 0, "Guardian create UI not present");
  await addGBtn.first().click();
  await page.locator("form input").first().fill("Mother");
  await page.locator('form button[type="submit"]').click();
  await expect.poll(() => guardianCreated, { timeout: 5000 }).toBe(true);
});
