import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const OPENBOX_VISIBLE_TIMEOUT_MS = 180_000;

/**
 * Navigate to the app with a fresh reset token, then wait for the chat
 * interface to be ready. The `reset` parameter is appended to the URL as
 * `?reset=e2e-<reset>-<timestamp>` so each test gets an isolated session.
 */
export async function openFresh(page: Page, reset: string): Promise<void> {
  await page.goto(`/?reset=e2e-${reset}-${Date.now()}`);
}

/**
 * Type a message into the CopilotChat text input and submit it with Enter.
 * Uses the last textbox on the page, matching the CopilotChat input selector
 * pattern from the reference app.
 */
export async function sendChatMessage(page: Page, text: string): Promise<void> {
  const input = page.getByRole("textbox").last();
  await input.fill(text);
  await input.press("Enter");
}

/**
 * Wait for the last `.obx-governance-card` to appear and assert that it
 * contains text matching `verdictRegex`. Covers all terminal verdicts
 * (Allowed, Redacted, Constrained, Blocked, Halted, Rejected).
 */
export async function expectOpenBoxDecision(
  page: Page,
  verdictRegex: RegExp,
): Promise<void> {
  const card = page.locator(".obx-governance-card").last();
  await expect(card).toBeVisible({ timeout: OPENBOX_VISIBLE_TIMEOUT_MS });
  await expect(card.getByText(verdictRegex).first()).toBeVisible({
    timeout: OPENBOX_VISIBLE_TIMEOUT_MS,
  });
}

/**
 * Assert that the page body contains no raw schema artifacts that would
 * indicate OpenBox result JSON leaked into the rendered output. Also checks
 * for agent/session/workflow ID tokens that must never appear in the UI.
 */
export async function expectNoUnsafeOutput(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("schemaVersion");
  expect(text).not.toContain("openbox.copilotkit.result.v1");
  expect(text).not.toContain("Cannot send event type");
  expect(text).not.toContain("agent_id:");
  expect(text).not.toContain("session_id:");
  expect(text).not.toContain("workflow_id:");
}
