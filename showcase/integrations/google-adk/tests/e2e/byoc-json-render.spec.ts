import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for byoc-json-render.
test.describe("BYOC JSON Render — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("Marketing overview suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Marketing overview/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("outline a marketing overview with traffic breakdown"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
