import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
  });

  test("page loads with heading and chat", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Beautiful Chat" }),
    ).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });

  test("Pasta night suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Pasta night/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
