import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test("page loads with heading and chat", async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
    await expect(
      page.getByRole("heading", { name: "Beautiful Chat" }),
    ).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
