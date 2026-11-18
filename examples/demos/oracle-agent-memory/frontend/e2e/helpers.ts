import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// CopilotKit (V2) exposes stable test ids on the composer and send button.
const TEXTAREA = "copilot-chat-textarea";
const SEND_BUTTON = "copilot-send-button";

/** Load the app and wait for the chat composer to be interactive. */
export async function openChat(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(TEXTAREA)).toBeVisible({ timeout: 30_000 });
}

/** Type `text` into the composer and send it by clicking the send button. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.getByTestId(TEXTAREA);
  await input.click();
  await input.fill(text);
  // The send button enables once the composer is non-empty AND the component has
  // hydrated. Waiting for that (rather than pressing Enter) avoids a first-
  // interaction race where Enter no-ops before hydration completes.
  const send = page.getByTestId(SEND_BUTTON);
  await expect(send).toBeEnabled({ timeout: 15_000 });
  await send.click();
  // Sending clears the composer — a reliable signal the message was submitted.
  await expect(input).toHaveValue("", { timeout: 10_000 });
}

/**
 * Send a message and wait for the agent run's response stream to finish.
 *
 * NOTE: persistence is no longer coupled to stream close. The concierge writes
 * memory in a background task AFTER the SSE stream closes at RUN_FINISHED, so a
 * finished response is NOT a "memory written" signal. Callers that need the turn
 * to be recallable must poll for it separately (see wait-until-searchable.py in
 * the cross-session test); this only waits for the run to complete.
 */
export async function sendAndAwaitRun(page: Page, text: string): Promise<void> {
  const streamClosed = page
    .waitForResponse(
      (r) =>
        r.url().includes("/api/copilotkit") && r.request().method() === "POST",
      { timeout: 150_000 },
    )
    .then((r) => r.finished());
  await sendMessage(page, text);
  await streamClosed;
}

/**
 * Ask a question and retry until the reply contains every expected pattern.
 *
 * IMPORTANT — retrying is unsafe for tool-driven prompts in this app.
 * Each retry re-sends the question as a *new turn* in the same thread. After
 * a server-tool call, that second turn trips the upstream multi-turn
 * tool_call_id correlation bug and can never succeed. The default is therefore
 * `attempts = 1`. Callers who need more time for a tool-driven prompt should
 * raise `perAttemptMs` instead of `attempts`; `attempts > 1` is only safe for
 * purely conversational (non-tool-driven) prompts.
 */
export async function askUntilReply(
  page: Page,
  question: string,
  patterns: RegExp[],
  {
    attempts = 1,
    perAttemptMs = 90_000,
    gapMs = 3_000,
  }: { attempts?: number; perAttemptMs?: number; gapMs?: number } = {},
): Promise<void> {
  let missing: RegExp[] = patterns;
  for (let i = 0; i < attempts; i++) {
    await sendMessage(page, question);
    const visible = await Promise.all(
      patterns.map(async (p) => {
        try {
          await expect(page.getByText(p).first()).toBeVisible({
            timeout: perAttemptMs,
          });
          return true;
        } catch {
          return false;
        }
      }),
    );
    missing = patterns.filter((_, idx) => !visible[idx]);
    if (missing.length === 0) return;
    if (i < attempts - 1) await page.waitForTimeout(gapMs);
  }
  throw new Error(
    `No reply matching ${missing.map(String).join(", ")} after ${attempts} attempts`,
  );
}

/** Fail fast if the runtime surfaced an error (incl. the known multi-turn bug). */
export async function assertNoAgentError(page: Page): Promise<void> {
  await expect(
    page.getByText(
      /RUN_ERROR|agent_run_error|fetch failed|must be a response to/i,
    ),
  ).toHaveCount(0);
}

/**
 * Click the sidebar "New thread" button and wait for the chat composer to be
 * ready in the fresh, empty conversation. Each new thread mounts a new
 * CopilotChat instance with its own threadId, so any prior server-tool state
 * is isolated — use this instead of opening a new browser context when you
 * only need a clean conversation, not a clean browser session.
 */
export async function newThread(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /new thread/i })
    .first()
    .click();
  // The composer textarea must be present and empty before we start typing.
  const input = page.getByTestId(TEXTAREA);
  await expect(input).toBeVisible({ timeout: 15_000 });
  await expect(input).toHaveValue("", { timeout: 10_000 });
}
