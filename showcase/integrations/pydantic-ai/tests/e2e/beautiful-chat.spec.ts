import { test, expect } from "@playwright/test";

test.describe("Beautiful Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/beautiful-chat");
  });

  test("layout renders with chat + mode toggle", async ({ page }) => {
    // The CopilotKit logo is shown in the chat column header.
    await expect(page.getByAltText("CopilotKit")).toBeVisible();
    // Mode toggle buttons (Chat / App)
    await expect(page.getByRole("button", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("button", { name: "App" })).toBeVisible();
  });
});
