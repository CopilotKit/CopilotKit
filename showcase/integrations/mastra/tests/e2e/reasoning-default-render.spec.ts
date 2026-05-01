import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
    const pill = page
      .getByRole("button", { name: /Default reasoning/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // Catalog primary selector is `copilot-reasoning-message`; the v2
    // reasoning component does not expose that data-testid, so assert on the
    // assistant turn settling instead.
    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
