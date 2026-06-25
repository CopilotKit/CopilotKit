import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const OPENBOX_VISIBLE_TIMEOUT_MS = 180_000;

/** Regex that matches every terminal governance verdict. */
export const TERMINAL_VERDICT =
  /Allowed|Redacted|Constrained|Blocked|Halted|Rejected/i;

/**
 * Navigate to the app with a fresh reset token, then wait for the chat
 * interface to be ready. The `?reset=e2e-<reset>-<timestamp>` query parameter
 * is a cache-buster only — nothing in the app reads it. A fresh session per
 * test is achieved by the full page navigation (`page.goto`) remounting the
 * CopilotKit provider, combined with serial execution (`fullyParallel: false`).
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
 * Click a suggestion-pill button by its visible label text.
 */
export async function clickSuggestion(
  page: Page,
  title: string,
): Promise<void> {
  const button = page.getByRole("button", { name: new RegExp(title, "i") });
  await button.click();
}

/**
 * Select an interactive choice option and confirm with "Submit for Review".
 * Used for the Vendor Handoff interactive-choice flow.
 */
export async function chooseInteractiveOption(
  page: Page,
  label: string,
): Promise<void> {
  await expect(page.getByText(new RegExp(label, "i")).first()).toBeVisible({
    timeout: OPENBOX_VISIBLE_TIMEOUT_MS,
  });
  await page.getByRole("button", { name: new RegExp(label, "i") }).click();
  await page.getByRole("button", { name: /Submit for Review/i }).click();
}

/**
 * Submit the manual-review draft (e.g. Billing Escalation Draft) by clicking
 * "Submit for Review" once the draft heading is visible.
 */
export async function submitManualReview(page: Page): Promise<void> {
  await expect(page.getByText(/Billing Escalation Draft/i).first()).toBeVisible(
    { timeout: OPENBOX_VISIBLE_TIMEOUT_MS },
  );
  await page.getByRole("button", { name: /Submit for Review/i }).click();
}

/**
 * Poll for an Approve / Reject button and click it if found; bail out early if
 * the governance card already shows a terminal verdict (the action was handled
 * automatically by OpenBox without requiring human approval in this run).
 */
export async function settleApprovalIfPresent(
  page: Page,
  decision: "Approve" | "Reject",
): Promise<void> {
  const deadline = Date.now() + OPENBOX_VISIBLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const button = page.getByRole("button", {
      name: new RegExp(decision, "i"),
    });
    if ((await button.count()) > 0) {
      await button.click();
      return;
    }
    const terminal = page
      .locator(".obx-governance-card")
      .last()
      .getByText(TERMINAL_VERDICT)
      .first();
    if ((await terminal.count()) > 0 && (await terminal.isVisible())) return;
    await page.waitForTimeout(500);
  }
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
 * Assert the `.openbox-business-result` element is visible and does not contain
 * raw schema artefacts. If the element is absent (governance blocked output
 * entirely) the check is skipped — absence is itself an acceptable outcome.
 */
export async function expectGeneratedResult(page: Page): Promise<void> {
  const result = page.locator(".openbox-business-result").last();
  if ((await result.count()) === 0) return;
  await expect(result).toBeVisible({ timeout: OPENBOX_VISIBLE_TIMEOUT_MS });
  const text = await result.innerText({ timeout: OPENBOX_VISIBLE_TIMEOUT_MS });
  if (text.trim().length === 0) return;
  expect(text).not.toContain("schemaVersion");
  expect(text).not.toContain("openbox.copilotkit.result.v1");
}

/**
 * Conditionally assert the generated result: only when the terminal verdict is
 * one that releases content (Allowed / Redacted / Constrained). For Blocked /
 * Halted / Rejected we do not expect visible output.
 */
export async function expectGeneratedResultWhenReleased(
  page: Page,
): Promise<void> {
  const cardText = await page
    .locator(".obx-governance-card")
    .last()
    .innerText({ timeout: OPENBOX_VISIBLE_TIMEOUT_MS });
  if (/Allowed|Redacted|Constrained/i.test(cardText)) {
    await expectGeneratedResult(page);
  }
}

/**
 * Assert that the generated-result element does NOT contain any of the
 * supplied PII / sensitive values. Used for redaction / constraint checks.
 */
export async function expectGeneratedResultNotToContain(
  page: Page,
  values: string[],
): Promise<void> {
  const result = page.locator(".openbox-business-result").last();
  await expect(result).toBeVisible({ timeout: OPENBOX_VISIBLE_TIMEOUT_MS });
  const text = await result.innerText({ timeout: OPENBOX_VISIBLE_TIMEOUT_MS });
  for (const value of values) {
    expect(text).not.toContain(value);
  }
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
