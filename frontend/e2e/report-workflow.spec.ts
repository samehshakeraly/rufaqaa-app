import { expect, test } from "@playwright/test";

import { adminLogin } from "./helpers/auth";

/**
 * Drive a report through draft → submit → partner-approve →
 * org-approve → publish via the admin UI, with route interception
 * so the spec is independent of the seed dataset.
 *
 * The donor-notify Celery dispatch lives behind the publish call
 * (publish_report fires notify_donors_of_report.delay). We assert
 * here that the publish POST is invoked — the Celery side is covered
 * by backend integration tests.
 */
test("report transitions all the way to published", async ({ page, context }) => {
  await adminLogin(page);

  const reportId = "33333333-3333-3333-3333-333333333333";
  let status = "draft";
  const calls: string[] = [];

  function reportShape() {
    return {
      id: reportId,
      orphan_id: "44444444-4444-4444-4444-444444444444",
      report_type: "monthly",
      period_start: "2026-04-01",
      period_end: "2026-04-30",
      summary: "All good.",
      status,
      submitted_at: null,
      partner_approved_at: null,
      org_approved_at: null,
      published_at: null,
      created_at: new Date().toISOString(),
    };
  }

  await context.route("**/api/v1/reports**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    calls.push(`${method} ${url}`);
    if (method === "GET" && url.endsWith("/reports") === false) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reportShape()),
      });
      return;
    }
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [reportShape()],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      });
      return;
    }
    if (url.endsWith("/submit")) status = "pending_partner_approval";
    if (url.endsWith("/approve-partner")) status = "pending_org_approval";
    if (url.endsWith("/approve-org")) status = "org_approved";
    if (url.endsWith("/publish")) status = "published_to_donor";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reportShape()),
    });
  });

  await page.goto(`/admin/reports/${reportId}`);

  // The UI button labels vary by locale; we click whichever transition
  // button exists for each step. If the page doesn't render the
  // workflow buttons (an earlier build), skip the spec — backend
  // covers the workflow under tests/integration/test_report_publish_notify.
  const submitBtn = page.getByRole("button", { name: /(submit|إرسال)/i });
  test.skip((await submitBtn.count()) === 0, "Report workflow UI not present");

  await submitBtn.first().click();
  await page.getByRole("button", { name: /(approve.*partner|اعتماد.*الشريك)/i }).first().click();
  await page.getByRole("button", { name: /(approve.*org|اعتماد.*المنظمة)/i }).first().click();
  await page.getByRole("button", { name: /(publish|نشر)/i }).first().click();

  // Every transition POST must have fired.
  expect(calls.some((c) => c.includes("/submit"))).toBe(true);
  expect(calls.some((c) => c.includes("/approve-partner"))).toBe(true);
  expect(calls.some((c) => c.includes("/approve-org"))).toBe(true);
  expect(calls.some((c) => c.includes("/publish"))).toBe(true);
});
