import { expect, test } from "@playwright/test";

/**
 * Happy path for the donor "child journey" detail page (D-07).
 *
 * The page is frontend-only: it consumes the already donor-scoped
 * /me/sponsorships, /me/reports, and /me/sponsorships/:id/profile endpoints.
 * The profile endpoint returns the composed SponsoredOrphanProfile (identity
 * + optional story blocks). Seeding a real published report would require the
 * full author → partner → org → publish chain, so this spec instead signs up
 * a real donor (for a valid auth token) and stubs the three data endpoints at
 * the network layer — the same interception style as the payment loop spec —
 * then asserts the dream, the growth section, and at least one milestone.
 */
test("donor opens a sponsored orphan and sees the dream, growth, and a milestone", async ({
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
        dream: { aspiration: "أن تصبح معلمة" },
        her_world: {
          education_stage: "primary",
          is_hafiz: false,
          quran_juz_memorized: 5,
          tags: ["نشيطة", "تحبّ الرسم"],
        },
        quran_growth: {
          series: [
            { period: "2025-01-01", juz_memorized: 2 },
            { period: "2025-06-01", juz_memorized: 5 },
          ],
        },
        multidim_growth: {
          education_stage: { first: "kindergarten", latest: "primary" },
          attendance_percent: { first: 80, latest: 95 },
          social: { first: "improving", latest: "good" },
        },
        milestones: {
          items: [{ label: "أتمّت حفظ جزء عمّ", period: "2025-03-01" }],
        },
        recent_updates: {
          items: [{ period: "2025-06-01", headline: "تحسّن ملحوظ في القراءة" }],
        },
        supervisor_word: {
          text: "عائشة فتاة مجتهدة ومحبوبة بين أقرانها.",
          period: "2025-06-10",
          author_label: "الأستاذة منى",
        },
        since_you_began: {
          start_date: "2025-01-01",
          juz_gained: 3,
          milestones_count: 1,
          reports_count: 4,
        },
      }),
    });
  });

  // Pin the app to Arabic (its primary locale) before any script runs, so
  // the detector doesn't fall back to the runner's English `navigator.language`
  // — otherwise translated UI like the section headings would render in English
  // while only stubbed data stays Arabic.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("rufaqaa.lang", "ar");
    } catch {
      /* storage may be unavailable on the very first about:blank */
    }
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

  // Identity header carries the child's name (level-1 heading).
  await expect(page.getByRole("heading", { name: "عائشة", level: 1 })).toBeVisible();

  // Her dream — the emotional anchor.
  await expect(page.getByText("أن تصبح معلمة").first()).toBeVisible();

  // The Qur'an growth section renders: its Arabic heading + the inline area
  // chart (the polyline is unique to this multi-point growth visual, and is
  // language-independent).
  await expect(page.getByText("رحلة الحفظ")).toBeVisible();
  await expect(page.locator("section svg polyline").first()).toBeVisible();

  // At least one milestone is celebrated.
  await expect(page.getByText("أتمّت حفظ جزء عمّ")).toBeVisible();
});
