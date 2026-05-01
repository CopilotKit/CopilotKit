import { test, expect } from "@playwright/test";

test.describe("BYOC: JSON Render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single "Marketing overview" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and the json-render renderer produces an assistant response.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Marketing overview" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
