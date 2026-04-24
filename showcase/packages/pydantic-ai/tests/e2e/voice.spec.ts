import { test, expect } from "@playwright/test";

test.describe("Voice Input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/voice");
  });

  test("page loads with sample button, chat composer, and mic affordance", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Voice input" }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="voice-sample-audio"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="voice-sample-audio-button"]'),
    ).toBeEnabled();
    await expect(
      page.getByText('Sample: "What is the weather in Tokyo?"'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
    // Mic button present iff the runtime advertised
    // audioFileTranscriptionEnabled: true — the transcriptionService
    // must be wired on /api/copilotkit-voice.
    await expect(
      page.locator('[data-testid="copilot-start-transcribe-button"]'),
    ).toBeVisible();
  });
});
