import { expect, test, type BrowserContext } from "@playwright/test";

/**
 * Father's memory (ذكرى الأب) — the donor-facing remembrance block (PR-11).
 *
 * Like the donor-orphan-journey spec, the detail page is frontend-only: it
 * consumes the already donor-scoped /me/sponsorships, /me/reports and
 * /me/sponsorships/:id/profile endpoints. The block is double-gated and
 * year-only on the SERVER; from the donor's side it is simply present (with the
 * father's name + YEAR) or absent. We sign up a real donor (for a valid token)
 * and stub the data endpoints, then assert the block renders only when the
 * composed profile carries it.
 */

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";
const ORPHAN_CODE = "ORF-99";

/** Base identity slice every profile carries. */
const IDENTITY = {
  first_name: "عائشة",
  age_years: 10,
  gender: "F",
  country: "EG",
  partner_organization_name: "دار الأمل",
  aspiration: "أن تصبح معلمة",
  education_stage: "primary",
  quran_juz_memorized: 5,
  is_hafiz: false,
  tags: ["نشيطة"],
};

/** Stub the three donor-scoped endpoints the page reads. ``profile`` is the
 * exact composed body returned for the sponsored child. */
async function stubDonorData(context: BrowserContext, profile: Record<string, unknown>) {
  await context.route("**/api/v1/me/sponsorships*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "s-1",
            code: "SPN-1",
            donor_id: "d-1",
            orphan_id: ORPHAN_ID,
            monthly_amount: "30",
            currency: "USD",
            start_date: "2025-01-01",
            end_date: null,
            payment_frequency: "monthly",
            status: "active",
            total_paid: "510",
            payments_count: 17,
            next_payment_date: "2026-07-01",
            created_at: "2025-01-01T00:00:00Z",
            donor_code: "DNR-1",
            donor_name: "Donor",
            orphan_code: ORPHAN_CODE,
            orphan_name: "عائشة",
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    });
  });

  await context.route("**/api/v1/me/reports*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
    });
  });

  // The message archive fetches independently; an empty thread keeps the page
  // quiet. Registered before the specific profile route order doesn't matter.
  await context.route(`**/api/v1/me/sponsorships/${ORPHAN_ID}/messages*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
    });
  });

  await context.route(`**/api/v1/me/sponsorships/${ORPHAN_ID}/profile`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(profile),
    });
  });

  // Pin Arabic before any script runs (matches the journey spec).
  await context.addInitScript(() => {
    try {
      localStorage.setItem("rufaqaa.lang", "ar");
    } catch {
      /* storage may be unavailable on the very first about:blank */
    }
  });
}

/** Sign up a real donor so the page mounts with a valid token. */
async function signUpDonor(page: import("@playwright/test").Page) {
  const email = `fm-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();
  await page.locator("#sg-first").fill("Father");
  await page.locator("#sg-last").fill("Memory");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: /(create account|إنشاء الحساب)/i }).click();
  await page
    .getByRole("button", { name: /(go to verification page|الذهاب لصفحة التحقّق)/i })
    .click();
  await page.waitForURL(/\/donor\/dashboard$/, { timeout: 15_000 });
}

test("the father's-memory block renders the name and YEAR when present", async ({
  page,
  context,
}) => {
  await stubDonorData(context, {
    ...IDENTITY,
    father_memory: { father_name: "أحمد", death_year: 2019 },
  });
  await signUpDonor(page);

  await page.goto(`/donor/orphans/${ORPHAN_ID}`);
  await expect(page.getByRole("heading", { name: "عائشة", level: 1 })).toBeVisible();

  const memory = page.getByRole("region", { name: "ذكرى الأب" });
  await expect(memory).toBeVisible();
  await expect(memory.getByText("في ذمّة الله")).toBeVisible();
  await expect(memory.getByText("أحمد")).toBeVisible();
  // YEAR only — never a full date.
  await expect(memory.getByText("توفّي عام 2019")).toBeVisible();
});

test("the father's-memory block is absent when the profile omits it", async ({
  page,
  context,
}) => {
  await stubDonorData(context, { ...IDENTITY });
  await signUpDonor(page);

  await page.goto(`/donor/orphans/${ORPHAN_ID}`);
  await expect(page.getByRole("heading", { name: "عائشة", level: 1 })).toBeVisible();

  await expect(page.getByRole("region", { name: "ذكرى الأب" })).toHaveCount(0);
  await expect(page.getByText("في ذمّة الله")).toHaveCount(0);
});
