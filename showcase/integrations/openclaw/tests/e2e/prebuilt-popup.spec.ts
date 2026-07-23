import { test, expect } from "@playwright/test";

// Behavioral e2e for the prebuilt-popup demo (OpenClaw), run against aimock.
// The demo mounts <CopilotPopup defaultOpen={true}> with a custom input
// placeholder ("Ask the popup anything..."). Prompts match
// showcase/aimock/d4/openclaw/chat.json.
test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with heading and the popup open by default", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Popup demo" }),
    ).toBeVisible();

    // defaultOpen={true} plus the labels override → custom placeholder visible.
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible({ timeout: 20000 });

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

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("typing a message and sending produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Ask the popup anything...");
    await input.fill("Hello");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
