import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test("custom headless UI loads", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(page.getByText("Headless Chat (Simple)")).toBeVisible();
    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
  });

  // Canonical e2e suggestion — headless-simple uses a plain textarea (no
  // <CopilotChat />, no suggestion pills), so the test types the canonical
  // catalog message directly to drive the show_card tool path.
  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await page
      .getByPlaceholder(/Type a message/)
      .fill("show a small card body about hummingbirds");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
