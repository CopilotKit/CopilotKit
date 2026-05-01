import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
    const pill = page
      .getByRole("button", { name: /Default catchall/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // Catalog primary selector is `custom-catchall-card`; this demo uses the
    // package-provided DefaultToolCallRenderer which doesn't expose that
    // data-testid, so assert on the assistant turn settling instead.
    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
