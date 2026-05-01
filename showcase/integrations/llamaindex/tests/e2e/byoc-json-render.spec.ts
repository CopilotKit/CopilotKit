import { test, expect } from "@playwright/test";

test.describe("BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("asking for a sales dashboard renders a json-render surface", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Show me the sales dashboard with a revenue bar chart.");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("canonical 'Marketing overview' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    const pill = page
      .getByRole("button", { name: /Marketing overview/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
