import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for
// tool-rendering-custom-catchall.
test.describe("Tool Rendering (Custom Catchall) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("Custom catchall suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Custom catchall/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText(
        "exercise the custom catchall renderer with an unknown tool",
      ),
    ).toBeVisible({ timeout: 30_000 });
  });
});
