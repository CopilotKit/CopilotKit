import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for beautiful-chat.
test.describe("Beautiful Chat — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
  });

  test("Pasta night suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Pasta night/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("suggest a vegetarian pasta dinner for four guests"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
