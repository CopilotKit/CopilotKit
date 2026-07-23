import { test, expect } from "@playwright/test";

// Behavioral e2e for the prebuilt-sidebar demo (OpenClaw), run against aimock.
// The demo mounts <CopilotSidebar defaultOpen={true}>, so the chat input is
// present on first paint. Prompts match showcase/aimock/d4/openclaw/chat.json.
test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with heading, main content, and sidebar open by default", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Sidebar demo" }),
    ).toBeVisible();

    // defaultOpen={true} means the sidebar's chat input is mounted on load.
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });

    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  test("'Say hi' suggestion pill renders and produces an assistant response", async ({
    page,
  }) => {
    const sayHiPill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Say hi" })
      .first();
    await expect(sayHiPill).toBeVisible({ timeout: 15000 });

    await sayHiPill.click();

    // Neutral agent, no tools — the round-trip signal is an assistant bubble.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("typing a message and sending produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
