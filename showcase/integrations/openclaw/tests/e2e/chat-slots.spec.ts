import { test, expect } from "@playwright/test";

// Behavioral e2e for the chat-slots demo, run against aimock (deterministic
// LLM). The gateway injects X-AIMock-Context: openclaw, so these prompts match
// the fixtures in showcase/aimock/d4/openclaw/chat.json. The demo drives the
// same OpenClaw agent as agentic-chat but overrides CopilotChat's slots with
// dashed "slot atlas" markers, so we assert both that the chat works and that
// the slot customizations are on the page.
test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("page loads with a chat input and the customized slots", async ({
    page,
  }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });

    // Slot overrides render on the welcome screen before any message is sent.
    await expect(page.getByTestId("custom-welcome-screen")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("custom-welcome-message")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByTestId("custom-disclaimer")).toBeVisible({
      timeout: 15000,
    });
  });

  test("shows the two starter suggestions", async ({ page }) => {
    for (const title of ["Write a sonnet", "Tell me a joke"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("sends a typed message and renders it through the custom message slots", async ({
    page,
  }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Write a short sonnet about AI.");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });

  test("clicking a suggestion pill sends it and gets a response", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Tell me a joke" }).click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/debug/i)).toBeVisible({ timeout: 30000 });
  });
});
