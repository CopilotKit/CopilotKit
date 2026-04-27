import { test, expect } from "@playwright/test";

test.describe("HITL In-Chat (useHumanInTheLoop)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
