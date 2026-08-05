import { expect, test } from "@playwright/test";

test("prebuilt sidebar opens with its main content", async ({ page }) => {
  await page.goto("/demos/prebuilt-sidebar");

  await expect(
    page.getByRole("heading", { name: "Sidebar demo" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  await expect(
    page.locator('[data-testid="copilot-chat-toggle"]').first(),
  ).toBeVisible();
});
