import { expect, test } from "@playwright/test";

/**
 * Belt-and-suspenders sanity at the network layer: the JSON returned
 * by /public/orphans must NOT contain any sensitive field. The same
 * guard exists in the backend tests; this asserts the SPA never
 * causes the backend to leak more.
 */
test("/public/orphans returns only curated fields", async ({ request }) => {
  const r = await request.get("/api/v1/public/orphans?limit=50");
  expect(r.status()).toBe(200);
  const body = await r.json();
  for (const item of body.items) {
    expect(Object.keys(item).sort()).toEqual(
      [
        "age_years",
        "case_status",
        "code",
        "country",
        "first_name",
        "gender",
        "partner_organization_name",
      ].sort(),
    );
    for (const forbidden of [
      "family_name",
      "father_name",
      "date_of_birth",
      "address",
      "guardian",
      "family_id",
      "organization_id",
      "is_sponsored",
      "current_balance",
      "donor_history",
      "documents",
    ]) {
      expect(item).not.toHaveProperty(forbidden);
    }
  }
});

test("/public/stats returns numbers only", async ({ request }) => {
  const r = await request.get("/api/v1/public/stats");
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(Object.keys(body).sort()).toEqual(
    [
      "orphans_available",
      "orphans_sponsored",
      "donors_total",
      "countries_served",
    ].sort(),
  );
  for (const v of Object.values(body)) {
    expect(typeof v).toBe("number");
  }
});
