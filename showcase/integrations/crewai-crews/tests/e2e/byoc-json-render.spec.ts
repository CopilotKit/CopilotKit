import { test, expect } from "@playwright/test";

test.describe("BYOC: json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="byoc-json-render-root"]'),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Marketing overview suggestion pill renders a json-render root", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Marketing overview" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
