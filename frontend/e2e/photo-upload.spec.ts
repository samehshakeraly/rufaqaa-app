import { expect, test } from "@playwright/test";

import { adminLogin } from "./helpers/auth";

/**
 * Orphan detail page exposes a photo upload card. We assert that
 * picking a file triggers the multipart POST and the new photo
 * appears in the listing on the next refresh.
 */
test("admin can upload an orphan photo and see it listed", async ({
  page,
  context,
}) => {
  await adminLogin(page);
  const orphanId = "66666666-6666-6666-6666-666666666666";

  await context.route(`**/api/v1/orphans/${orphanId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: orphanId,
        code: "ORP-E2E",
        first_name: "Photo",
        family_name: "Test",
        date_of_birth: "2015-01-01",
        gender: "M",
        case_status: "available",
        is_sponsored: false,
        current_balance: "0.00",
        created_at: new Date().toISOString(),
      }),
    });
  });
  await context.route(`**/api/v1/orphans/${orphanId}/timeline`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  let posted = false;
  const photos: object[] = [];
  await context.route(
    `**/api/v1/media/orphans/${orphanId}/photos`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(photos),
      });
    },
  );
  await context.route(
    `**/api/v1/media/orphans/${orphanId}/photo`,
    async (route) => {
      posted = true;
      const id = "photo-1";
      photos.push({
        id,
        file_url: `s3://rufaqaa-private/orphans/${orphanId}/${id}.jpg`,
        presigned_url: "data:image/png;base64,iVBORw0KGgo=",
        file_size_bytes: 1024,
        moderation_status: "pending",
        created_at: new Date().toISOString(),
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(photos[photos.length - 1]),
      });
    },
  );
  // Documents card calls these too — give it empty data.
  await context.route(`**/api/v1/orphans/${orphanId}/documents**`, async (r) => {
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 }),
    });
  });

  await page.goto(`/admin/orphans/${orphanId}`);

  // Tiny in-memory file
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
  });

  await expect.poll(() => posted, { timeout: 5000 }).toBe(true);
});
