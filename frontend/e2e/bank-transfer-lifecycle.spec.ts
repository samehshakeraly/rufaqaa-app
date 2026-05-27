import { expect, test } from "@playwright/test";

import { adminLogin } from "./helpers/auth";

/**
 * Full bank-transfer admin lifecycle: create → approve →
 * mark-completed → confirm-receipt (with optional document upload).
 *
 * The "confirm receipt" step now opens a modal (PR #7). We exercise
 * the modal's submit path and verify a POST hits
 * /bank-transfers/{id}/confirm-receipt.
 */
test("bank transfer drives through approve → complete → confirm", async ({
  page,
  context,
}) => {
  await adminLogin(page);

  const transferId = "55555555-5555-5555-5555-555555555555";
  let status: "pending" | "approved" | "completed" = "pending";
  let confirmedDoc: string | null = null;

  function transferShape() {
    return {
      id: transferId,
      code: "TRF-E2E",
      organization_id: "org",
      partner_organization_id: "p1",
      amount: "500.00",
      currency: "KWD",
      bank_name: "NBK",
      bank_reference: null,
      period_start: "2026-04-01",
      period_end: "2026-04-30",
      status,
      approved_at: status !== "pending" ? new Date().toISOString() : null,
      executed_at: status === "completed" ? new Date().toISOString() : null,
      confirmed_by_partner_at: confirmedDoc !== null ? new Date().toISOString() : null,
      confirmation_document_id: confirmedDoc,
      notes: null,
      created_at: new Date().toISOString(),
    };
  }

  await context.route("**/api/v1/bank-transfers**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [transferShape()],
          total: 1,
          limit: 100,
          offset: 0,
        }),
      });
      return;
    }
    if (url.endsWith("/approve")) status = "approved";
    if (url.endsWith("/mark-completed")) status = "completed";
    if (url.endsWith("/confirm-receipt")) confirmedDoc = "doc-1";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(transferShape()),
    });
  });

  await context.route("**/api/v1/partners**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "p1",
            code: "PTN-E2E",
            name_ar: "شريك",
            name_en: "Partner",
            is_active: true,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    });
  });

  await page.goto("/admin/bank-transfers");

  // Walk: approve → complete → confirm (clicking by visible action label).
  await page.getByRole("button", { name: /(approve|اعتماد)/i }).first().click();
  await page
    .getByRole("button", { name: /(mark completed|تأكيد التنفيذ)/i })
    .first()
    .click();
  await page
    .getByRole("button", { name: /(confirm receipt|تأكيد الاستلام)/i })
    .first()
    .click();

  // The dialog should render.
  const dialog = page.getByTestId("confirm-receipt-dialog");
  await expect(dialog).toBeVisible();

  // Submit without a file → confirms with just notes.
  await dialog.getByTestId("confirm-receipt-notes").fill("Phoned to confirm.");
  await dialog.getByTestId("confirm-receipt-submit").click();

  await expect.poll(() => confirmedDoc, { timeout: 5000 }).toBe("doc-1");
});
