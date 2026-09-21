// Existing scenarios are diagnostics; only the canonical pill test below is functional acceptance.
import { test, expect } from "@playwright/test";

test.describe("Diagnostic: Agentic Chat (Reasoning)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
  });

  test("Diagnostic: chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
