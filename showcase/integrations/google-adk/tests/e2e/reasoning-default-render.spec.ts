import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for
// reasoning-default-render.
test.describe("Reasoning (Default Render) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("Default reasoning suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Default reasoning/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("talk me through your default reasoning on a tricky riddle"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
