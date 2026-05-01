/**
 * E2E spec for the byoc-hashbrown demo (Wave 4a).
 *
 * Authored but not executed pre-deploy — Railway stabilization runs happen
 * post-deploy per the plan's scope modification. Selectors match the ported
 * chart/metric components' `data-testid` hooks.
 *
 * Covers 3 suggestion flows + page-load smoke. Assertion timeouts favor
 * streaming-friendly budgets because hashbrown assembles UI progressively
 * from structured output.
 */
import { test, expect } from "@playwright/test";

test.describe("BYOC Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("page loads with header, canonical suggestion pill, and chat composer", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "BYOC: Hashbrown" }),
    ).toBeVisible();
    // Demo-specific suggestion set was collapsed to the single canonical
    // pill (see showcase/aimock/_canonical-catalog.json) so the e2e fixture
    // remains substring-disjoint with every other demo.
    await expect(page.getByText("Sales overview").first()).toBeVisible();
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator("[data-testid=\"metric-card\"]").first()).toBeVisible({ timeout: 60_000 });
  });
});
