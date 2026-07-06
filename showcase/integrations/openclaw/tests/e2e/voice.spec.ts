import { test, expect } from "@playwright/test";

// Behavioral e2e for the voice demo (OpenClaw), run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so the
// canned phrase matches the fixture in showcase/aimock/d4/openclaw/chat.json.
//
// Two affordances live on /demos/voice:
//
// 1. The mic button rendered by <CopilotChat /> when the voice runtime
//    (/api/copilotkit-voice) advertises `audioFileTranscriptionEnabled: true`
//    on /info — exposed as data-testid="copilot-start-transcribe-button". Its
//    presence is the authoritative signal that transcriptionService is wired.
//    The mic recording path itself is out of scope (MediaRecorder is hard to
//    drive headlessly, and it's the only path that hits real Whisper) — it's
//    covered by manual QA.
//
// 2. The "Try a sample audio" button (data-testid="voice-sample-audio-button")
//    — a deterministic test/demo affordance that synchronously injects the
//    canned phrase "What is the weather in Tokyo?" straight into the chat
//    composer (data-testid="copilot-chat-textarea"), bypassing mic permissions
//    and the /transcribe round trip. This is the sample-audio path this suite
//    exercises end to end.
//
// The voice page uses plain <CopilotChat /> with NO frontend tools registered,
// so sending the transcribed text drives a plain content-only assistant
// response from the fixture (no tool-call loop, no terminator) — the
// fixture-specific text is the load-bearing assertion.
test.describe("Voice Input", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/voice");
  });

  test("page loads with heading, sample button, chat composer, and mic affordance", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Voice input" }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.locator('[data-testid="voice-sample-audio-button"]'),
    ).toBeEnabled();
    await expect(page.getByText("Try a sample audio")).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible({ timeout: 20000 });
    // The mic button is the authoritative signal that the voice runtime
    // advertised `audioFileTranscriptionEnabled: true` on /info — i.e.
    // transcriptionService is wired on /api/copilotkit-voice. It renders after
    // the /info round trip resolves on the client, which on a cold dev server
    // can exceed Playwright's 5s default — give it room.
    await expect(
      page.locator('[data-testid="copilot-start-transcribe-button"]'),
    ).toBeVisible({ timeout: 20000 });
  });

  test("sample audio button injects the canned phrase into the composer", async ({
    page,
  }) => {
    const sampleButton = page.locator(
      '[data-testid="voice-sample-audio-button"]',
    );
    const textarea = page.locator('[data-testid="copilot-chat-textarea"]');

    await expect(sampleButton).toBeEnabled();
    await expect(textarea).toBeVisible({ timeout: 20000 });
    await expect(textarea).toHaveValue("");
    await sampleButton.click();

    // The button is synchronous — clicking immediately populates the textarea
    // with the canned sample text. No transient "Transcribing…" state, no
    // /transcribe round trip.
    await expect(textarea).toHaveValue(/weather in Tokyo/i, { timeout: 2000 });
    await expect(sampleButton).toBeEnabled();
  });

  test("sending the transcribed phrase drives the weather fixture response", async ({
    page,
  }) => {
    const sampleButton = page.locator(
      '[data-testid="voice-sample-audio-button"]',
    );
    const textarea = page.locator('[data-testid="copilot-chat-textarea"]');
    const sendButton = page.locator('[data-testid="copilot-send-button"]');

    await expect(textarea).toBeVisible({ timeout: 20000 });
    await sampleButton.click();
    await expect(textarea).toHaveValue(/weather in Tokyo/i, { timeout: 2000 });
    await sendButton.click();

    // The voice page registers no frontend tools, so the fixture returns a
    // plain content-only assistant message. Assert both that an assistant
    // message rendered AND that it carries the fixture-specific weather text,
    // so the aimock fixture is demonstrably what drove the run.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Tokyo/i).last()).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/18°C|clear skies/i).last()).toBeVisible({
      timeout: 30000,
    });
  });
});
