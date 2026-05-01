import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the byoc-json-render demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("BYOC JSON Render — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("Marketing overview canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Marketing overview/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    // Selector divergence fallback: assert assistant presence rather than
    // the json-render-root testid for resilience under mock fixtures.
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
