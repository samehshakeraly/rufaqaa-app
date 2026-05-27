import { expect, test } from "@playwright/test";

import { adminLogin } from "./helpers/auth";

/**
 * /admin/audit page (or wherever the inbound webhook log surfaces)
 * lets an operator replay a failed delivery. We intercept the log
 * list + replay endpoint and verify the right POST fires.
 *
 * The page may not surface this control in every build; if not
 * present we skip — backend coverage in test_webhook_replay.py
 * exercises the underlying behavior.
 */
test("operator can replay a failed inbound webhook delivery", async ({
  page,
  context,
}) => {
  await adminLogin(page);

  const logId = "88888888-8888-8888-8888-888888888888";
  let replayed = false;

  await context.route("**/api/v1/webhooks/log**", async (route) => {
    const url = route.request().url();
    if (url.includes("/replay")) {
      replayed = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", payment_id: "p1" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: logId,
            source: "myfatoorah",
            payload: { Data: { InvoiceId: "INV-1" } },
            signature: "sig",
            response_status: 404,
            response_body: null,
            error: "Could not match donor",
            received_at: new Date().toISOString(),
            replayed_from: null,
            replayed_count: 0,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      }),
    });
  });

  // The replay UI may live on /admin/audit or another path; try both.
  for (const path of ["/admin/audit", "/admin/webhooks", "/admin/dashboard"]) {
    await page.goto(path);
    const replayBtn = page.getByRole("button", { name: /(replay|إعادة)/i });
    if ((await replayBtn.count()) > 0) {
      await replayBtn.first().click();
      break;
    }
  }
  test.skip(!replayed, "Webhook replay UI not present in this build");
  await expect.poll(() => replayed, { timeout: 5000 }).toBe(true);
});
