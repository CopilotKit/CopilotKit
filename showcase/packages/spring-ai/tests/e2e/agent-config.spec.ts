import { test, expect } from "@playwright/test";

test.describe("Agent Config", () => {
  test("page loads with config controls and chat", async ({ page }) => {
    await page.goto("/demos/agent-config");
    await expect(page.getByTestId("agent-config-card")).toBeVisible();
    await expect(page.getByTestId("agent-config-tone-select")).toBeVisible();
    await expect(
      page.getByTestId("agent-config-expertise-select"),
    ).toBeVisible();
    await expect(
      page.getByTestId("agent-config-length-select"),
    ).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
