import { expect, test } from "@playwright/test";
import { demoPath, describeDemo, integration } from "./helpers";

// The voice demo, through the sample-audio button only. The button puts a
// fixed phrase ("What is the weather in Tokyo?") into the composer at once,
// without the runtime's `/transcribe` endpoint, so these tests stay stable
// where Whisper or aimock are not available.
//
// The microphone path is out of scope: MediaRecorder is hard to drive
// headless without mocks. It is the only path that runs real transcription,
// and the manual QA checklist covers it.

const SAMPLE_BUTTON = '[data-testid="voice-sample-audio-button"]';
const TEXTAREA = '[data-testid="copilot-chat-textarea"]';

describeDemo("voice", "Voice Input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("voice"));
  });

  test("page loads and matches the runtime's transcription capability", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Voice input" }),
    ).toBeVisible();
    await expect(page.locator(SAMPLE_BUTTON)).toBeEnabled();
    await expect(page.getByText("Try a sample audio")).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();

    // The chat renders the mic button only when the runtime reports that it
    // can transcribe. The button appears after the client's /info request,
    // which can take longer than 5s on a cold dev server.
    const infoResponse = await page.request.get(
      `/api/${integration}/voice/info`,
    );
    expect(infoResponse.ok()).toBeTruthy();
    const info: { audioFileTranscriptionEnabled?: boolean } =
      await infoResponse.json();
    const mic = page.locator('[data-testid="copilot-start-transcribe-button"]');

    if (info.audioFileTranscriptionEnabled) {
      await expect(mic).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(mic).toHaveCount(0);
    }
  });

  test("sample audio button injects the canned phrase into the input", async ({
    page,
  }) => {
    const sampleButton = page.locator(SAMPLE_BUTTON);
    const textarea = page.locator(TEXTAREA);

    await expect(sampleButton).toBeEnabled();
    await expect(textarea).toHaveValue("");
    await sampleButton.click();

    // The button fills the textarea at once: no "Transcribing..." state and
    // no /transcribe request.
    await expect(textarea).toHaveValue(/weather|tokyo/i, { timeout: 1000 });
    await expect(sampleButton).toBeEnabled();
  });

  test("sending the transcribed text produces a weather tool render", async ({
    page,
  }) => {
    // Clicking, running the agent and the first assistant chunk can take up
    // to about 50s on a cold dev server, so the test gets room beyond the
    // locator's own 45s timeout.
    test.setTimeout(90_000);
    const textarea = page.locator(TEXTAREA);

    await page.locator(SAMPLE_BUTTON).click();
    await expect(textarea).toHaveValue(/weather|tokyo/i, { timeout: 1000 });
    await page.locator('[data-testid="copilot-send-button"]').click();

    // The voice agent can answer with a weather card, a catch-all tool card
    // or plain text. Any agent-authored surface counts.
    const assistantOrTool = page
      .locator(
        [
          '[data-testid="weather-card"]',
          '[data-testid="custom-catchall-card"][data-tool-name="get_weather"]',
          '[data-testid="copilot-assistant-message"]',
        ].join(", "),
      )
      .first();
    await expect(assistantOrTool).toBeVisible({ timeout: 45_000 });
  });
});
