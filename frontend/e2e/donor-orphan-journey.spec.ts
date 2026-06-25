import { expect, test } from "@playwright/test";

/**
 * Happy path for the donor "child journey" detail page (D-07).
 *
 * The page is frontend-only: it consumes the already donor-scoped
 * /me/sponsorships, /me/reports, and /me/sponsorships/:id/profile endpoints.
 * Seeding a real published report would require the full author →
 * partner → org → publish chain, so this spec instead signs up a real
 * donor (for a valid auth token) and stubs the three data endpoints at
 * the network layer — the same interception style as the payment loop
 * spec — then asserts the story header and at least one timeline update.
 */
test("donor opens a sponsored orphan and sees the story header + a timeline update", async ({
  page,
  context,
}) => {
  const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";
  const ORPHAN_CODE = "ORF-99";

  // --- Stub the donor-scoped data the page reads. -------------------
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
            orphan_name: "آدم",
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
      body: JSON.stringify({
        items: [
          {
            id: "r-1",
            orphan_id: ORPHAN_ID,
            report_type: "monthly",
            period_start: "2026-05-01",
            period_end: "2026-05-31",
            summary: "كان شهراً مباركاً ومليئاً بالإنجاز.",
            donor_message: "دعمكم غيّر عامه — جزاكم الله خيراً.",
            is_milestone: true,
            milestone_label: "أتمّ حفظ جزء عمّ",
            educational_progress: {
              overall_rating: "excellent",
              attendance_percent: 95,
            },
            quran_progress: { juz_memorized: 12, current_juz: 13, evaluation: "mastered" },
            activities: null,
            health_status: null,
            psychological_status: { mood: "good", social: "excellent" },
            status: "published_to_donor",
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-01T00:00:00Z",
            submitted_at: "2026-06-01T00:00:00Z",
            partner_approved_at: "2026-06-02T00:00:00Z",
            org_approved_at: "2026-06-03T00:00:00Z",
            published_at: "2026-06-04T00:00:00Z",
            photos_count: 0,
            videos_count: 0,
            documents_count: 0,
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      }),
    });
  });

  await context.route(`**/api/v1/me/sponsorships/${ORPHAN_ID}/profile`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: ORPHAN_CODE,
        first_name: "آدم",
        age_years: 9,
        gender: "M",
        country: "اليمن",
        case_status: "active",
        partner_organization_name: null,
        short_description: "طفل مجتهد يحبّ القراءة.",
        aspiration: "أن يصبح طبيباً",
        education_stage: "primary",
        quran_juz_memorized: 12,
        is_hafiz: false,
        tags: ["مجتهد"],
      }),
    });
  });

  // --- Sign up a real donor so the page mounts with a valid token. ---
  const email = `journey-${Date.now()}@example.com`;
  await page.goto("/signup");
  await page.locator("#sg-email").fill(email);
  await page.locator("#sg-password").fill("longenoughpw1");
  await page.locator("#sg-confirm").fill("longenoughpw1");
  await page.getByRole("button", { name: /(next|التالي)/i }).click();
  await page.locator("#sg-first").fill("Journey");
  await page.locator("#sg-last").fill("E2E");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: /(create account|إنشاء الحساب)/i }).click();
  await page
    .getByRole("button", {
      name: /(go to verification page|الذهاب لصفحة التحقّق)/i,
    })
    .click();
  await page.waitForURL(/\/donor\/dashboard$/, { timeout: 15_000 });

  // --- Open the sponsored orphan's journey page. --------------------
  await page.goto(`/donor/orphans/${ORPHAN_ID}`);

  // Story header carries the child's name. Match exactly so the journey
  // strip's "<name>'s journey" heading doesn't also resolve here.
  await expect(
    page.getByRole("heading", { name: "آدم", exact: true }),
  ).toBeVisible();

  // At least one timeline update is shown: the supervisor's summary and
  // the milestone label both render.
  await expect(page.getByText("أتمّ حفظ جزء عمّ")).toBeVisible();
  await expect(page.getByText(/كان شهراً مباركاً/)).toBeVisible();
});
