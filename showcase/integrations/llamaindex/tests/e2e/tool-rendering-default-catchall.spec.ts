import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test("page loads with chat input", async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical 'Default catchall' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/tool-rendering-default-catchall");
    const pill = page
      .getByRole("button", { name: /Default catchall/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
