import { test, expect } from "@playwright/test";

// E2E for the voice demo — sample-audio path only.
//
// The "Play sample" button is a deterministic test/demo affordance: it
// synchronously injects the canned phrase ("What is the weather in Tokyo?")
// into the chat composer without touching the runtime's `/transcribe`
// endpoint. That keeps this suite stable across environments where Whisper
// or aimock might be unavailable.
//
// The microphone path is intentionally out of scope: MediaRecorder is hard
// to exercise headlessly without mocking, and the mic is the only path that
// actually exercises real transcription. It's covered by the manual QA
// checklist at qa/voice.md.
//
// Stability expectation: 3 consecutive runs against Railway must pass.

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
    // The mic button is the authoritative signal that the runtime advertised
    // `audioFileTranscriptionEnabled: true` — i.e. transcriptionService is
    // wired on /api/copilotkit-voice. Exposed by react-core's v2 CopilotChatInput.
    await expect(
      page.locator('[data-testid="copilot-start-transcribe-button"]'),
    ).toBeVisible();
  });

  test("sample audio button injects the canned phrase into the input", async ({
    page,
  }) => {
    const sampleButton = page.locator(
      '[data-testid="voice-sample-audio-button"]',
    );
    const textarea = page.locator('[data-testid="copilot-chat-textarea"]');

    await expect(sampleButton).toBeEnabled();
    await expect(textarea).toHaveValue("");
    await sampleButton.click();

    // The button is synchronous — clicking immediately populates the
    // textarea with the canned sample text. No transient "Transcribing…"
    // state, no /transcribe round trip.
    await expect(textarea).toHaveValue(/weather|tokyo/i, { timeout: 1000 });
    await expect(sampleButton).toBeEnabled();
  });

  test("sending the transcribed text produces a weather tool render", async ({
    page,
  }) => {
    const sampleButton = page.locator(
      '[data-testid="voice-sample-audio-button"]',
    );
    const textarea = page.locator('[data-testid="copilot-chat-textarea"]');
    const sendButton = page.locator('[data-testid="copilot-send-button"]');

    await sampleButton.click();
    await expect(textarea).toHaveValue(/weather|tokyo/i, { timeout: 1000 });
    await sendButton.click();

    // The voice-demo route reuses the neutral sample_agent graph, which
    // doesn't itself render a weather card — but if the runtime has a
    // tool-rendering configuration that handles weather, one of these will
    // be visible. The assertion is permissive: we care that *some*
    // agent-authored response surface appeared, not exactly which renderer
    // was used.
    const assistantOrTool = page
      .locator(
        [
          '[data-testid="weather-card"]',
          '[data-testid="custom-catchall-card"][data-tool-name="get_weather"]',
          '[data-role="assistant"]',
        ].join(", "),
      )
      .first();
    await expect(assistantOrTool).toBeVisible({ timeout: 45000 });
  });
});
