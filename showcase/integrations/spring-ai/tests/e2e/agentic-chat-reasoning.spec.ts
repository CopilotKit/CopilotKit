// Existing scenarios are diagnostics; only the canonical pill test below is functional acceptance.
import { test, expect } from "@playwright/test";

test.describe("Diagnostic: Agentic Chat (Reasoning)", () => {
  test("Diagnostic: page loads with chat", async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
