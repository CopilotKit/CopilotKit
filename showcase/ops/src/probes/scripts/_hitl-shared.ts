/**
 * D5 — HITL shared helpers.
 *
 * Two D5 scripts (`d5-hitl-approve-deny.ts`, `d5-hitl-text-input.ts`)
 * share the same shape: send a user message, wait for the agent to issue
 * a frontend tool call that renders an out-of-chat / inline card, drive
 * that card programmatically, then assert the agent's follow-up
 * acknowledgement references the supplied action / value.
 *
 * Three primitives are extracted here so the per-script files stay tight:
 *
 *   - `selectorCascade(page, selectors)` — race a list of selectors and
 *     return the first one to resolve. Mirrors the chat-input cascade in
 *     `conversation-runner.ts` but parameterised so each HITL UI can use
 *     its own list. We do NOT import the runner's private cascade; it
 *     covers a different concern (chat input, not card UI).
 *   - `approveOrDeny(page, action)` — wait for the approval dialog to
 *     render via a fixed cascade of selectors, then click the matching
 *     button. The selectors are kept in cascade form (testid first, role
 *     fallback, text-content fallback) so showcases that drift from the
 *     reference langgraph-python copy still get probed.
 *   - `pickTimeSlot(page)` — wait for the time-picker card and click the
 *     first available slot. The fixture pins the user's request to
 *     "Book a 30-minute onboarding call for Alice"; the slot button text
 *     is deterministic per integration but the order is stable, so
 *     "first slot" is a stable choice across reruns.
 *
 * Plus `waitForNextAssistantMessage(page, baseline, timeoutMs)` — used
 * by both scripts inside their assertions callback after the HITL
 * response is submitted. The conversation-runner has already settled on
 * the FIRST assistant message (the one carrying the tool-call). The
 * second leg (the acknowledgement) lands as a NEW assistant message; we
 * poll the assistant-message count for growth past `baseline` and then
 * read its text content for the reference assertion.
 *
 * Page is the same structural minimal type as `conversation-runner.ts`
 * exposes — we import it from there directly so any downstream change
 * (extra method on the surface, etc.) ripples here too. The leading
 * underscore in this file's name is load-bearing: the d5 driver loader
 * scans `^d5-.*\.(js|ts)$` and skips anything not matching, so this
 * helper is invisible to the dynamic registry sweep.
 */

import {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
  type Page as ConversationPage,
} from "../helpers/conversation-runner.js";

/**
 * Extended Page surface — the conversation-runner Page only exposes the
 * four methods needed for chat-input-driven turns. HITL drives card UIs
 * which need `click(...)`. We extend the structural type here rather
 * than widening the runner's contract because the runner's surface is
 * deliberately tight (any showcase author wiring up a fake to test
 * conversation-runner directly shouldn't have to stub `click`).
 *
 * Real `playwright.Page` satisfies this structurally; tests inject
 * scripted fakes that implement only the methods their assertion needs.
 */
export interface Page extends ConversationPage {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
}

const SELECTOR_PROBE_TIMEOUT_MS = 3_000;
const ASSISTANT_FOLLOWUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
/**
 * Once the assistant-message count has grown past the baseline, wait
 * this long with no further growth before declaring the message
 * settled and reading its text. Without this window we'd capture
 * partial text from a still-streaming response — same race the
 * conversation-runner's per-turn settle was designed to avoid.
 */
const ASSISTANT_FOLLOWUP_SETTLE_MS = 1_500;

/**
 * Approval-dialog cascade. Reference DOM is langgraph-python's
 * `approval-dialog.tsx` which uses both `[data-testid="approval-dialog"]`
 * AND `role="dialog"` — the testid wins on conformant integrations, the
 * role / class fallbacks catch ports that lost the testid.
 */
const APPROVAL_DIALOG_SELECTORS = [
  '[data-testid="approval-dialog"]',
  '[data-testid="approval-prompt"]',
  '[role="dialog"]',
  ".hitl-approval",
] as const;

const APPROVE_BUTTON_SELECTORS = [
  '[data-testid="approval-dialog-approve"]',
  '[data-testid="approve-button"]',
  'button:has-text("Approve")',
] as const;

const REJECT_BUTTON_SELECTORS = [
  '[data-testid="approval-dialog-reject"]',
  '[data-testid="reject-button"]',
  '[data-testid="deny-button"]',
  'button:has-text("Reject")',
  'button:has-text("Deny")',
] as const;

/**
 * Time-picker cascade. Reference DOM is langgraph-python's
 * `time-picker-card.tsx`. The card itself is identifiable by the testid
 * `time-picker-card`; each slot is a `<button>` inside the card. The
 * cascade falls back to generic role-based selectors for ports that
 * dropped the testid.
 */
const TIME_PICKER_CARD_SELECTORS = [
  '[data-testid="time-picker-card"]',
  '[data-testid="hitl-text-input"]',
  '[role="dialog"]:has(button)',
] as const;

/**
 * Slot-button cascade. The reference card lays out 4 grid buttons
 * followed by a "None of these work" cancel button at the bottom; the
 * first button in DOM order is always a slot. We use `>> nth=0` to pin
 * to the first match — playwright's selector engine supports this in
 * both `waitForSelector` and `click`.
 *
 * IMPORTANT: every entry here is a card-RELATIVE selector; the caller
 * prefixes each one with the resolved `cardSelector` before clicking
 * (see `pickTimeSlot`). Repeating the card-shaped prefix inside an
 * entry would compose into a nested-card selector
 * (e.g. `[data-testid="time-picker-card"] [data-testid="time-picker-card"] button`)
 * that never matches because nested cards don't exist.
 */
const TIME_PICKER_SLOT_SELECTORS = [
  '[data-testid="time-picker-slot"]',
  "button >> nth=0",
] as const;

/**
 * Approve or deny the in-app HITL dialog. Waits for the dialog to
 * appear, clicks the matching button. Throws on selector miss so the
 * surrounding assertions callback fails the turn.
 *
 * @param action `"approve"` clicks the approve button, `"deny"` clicks
 *               the reject/deny button. Distinct verbs because the
 *               reference UI labels its negative action "Reject", but
 *               the spec uses "deny" — we accept either at the cascade
 *               level so the caller doesn't have to care.
 */
export async function approveOrDeny(
  page: Page,
  action: "approve" | "deny",
): Promise<void> {
  const dialogSelector = await selectorCascade(
    page,
    APPROVAL_DIALOG_SELECTORS,
    "approval dialog",
  );
  const buttonSelectors =
    action === "approve" ? APPROVE_BUTTON_SELECTORS : REJECT_BUTTON_SELECTORS;
  // Anchor each button selector under the resolved dialog selector so
  // text-content fallbacks (e.g. `button:has-text("Approve")`) cannot
  // match buttons elsewhere on the page (a "Cancel" or "Approve" button
  // in some unrelated chrome). Without this scoping, a custom showcase
  // that renders an "Approve cookies" banner would be clicked instead.
  const scopedButtonSelectors = buttonSelectors.map(
    (sel) => `${dialogSelector} ${sel}`,
  );
  const buttonSelector = await selectorCascade(
    page,
    scopedButtonSelectors,
    `${action} button`,
  );
  await page.click(buttonSelector);
}

/**
 * Pick the first available slot in the time-picker card. The reference
 * card surfaces 4 hard-coded slots; the order is stable per-integration
 * so "first available" is deterministic across reruns. The non-disabled
 * filter drops the "None of these work" cancel button.
 */
export async function pickTimeSlot(page: Page): Promise<void> {
  const cardSelector = await selectorCascade(
    page,
    TIME_PICKER_CARD_SELECTORS,
    "time-picker card",
  );
  // Anchor every slot selector under the resolved card selector so
  // a stray `[data-testid="time-picker-slot"]` (or a generic
  // `button >> nth=0`) cannot match elements outside the card —
  // e.g. a navbar button or a slot that lives in a different,
  // already-rendered card. The cascade entries are deliberately
  // CARD-RELATIVE (no card-shaped prefix baked in) so the composed
  // selector is `<resolvedCard> <slotEntry>` rather than the historical
  // `<resolvedCard> [data-testid="time-picker-card"] <button>` (a
  // nested-card pattern that never matches).
  const scopedSlotSelectors = TIME_PICKER_SLOT_SELECTORS.map(
    (sel) => `${cardSelector} ${sel}`,
  );
  const slotSelector = await selectorCascade(
    page,
    scopedSlotSelectors,
    "time-picker slot",
  );
  await page.click(slotSelector);
}

/**
 * Wait for a new assistant message to land past `baseline` and return
 * its text content. The conversation-runner's per-turn settle already
 * waited for the first assistant message (carrying the tool call), so
 * `baseline` SHOULD be sampled by the script AFTER the runner has
 * settled — i.e. it already includes that first message. After we
 * click the dialog/slot button the agent re-invokes the LLM and emits
 * a SECOND assistant message; we poll for `count > baseline` and read
 * the latest message's text.
 *
 * Returns the latest assistant message's text content trimmed.
 */
export async function waitForNextAssistantMessage(
  page: Page,
  baseline: number,
  timeoutMs: number = ASSISTANT_FOLLOWUP_TIMEOUT_MS,
  settleMs: number = ASSISTANT_FOLLOWUP_SETTLE_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  // Phase 1: wait for the count to grow past `baseline` (the
  // follow-up message has started rendering).
  let count = await readAssistantCount(page);
  while (Date.now() < deadline && count <= baseline) {
    await sleep(POLL_INTERVAL_MS);
    count = await readAssistantCount(page);
  }
  if (count <= baseline) {
    throw new Error(
      `timeout: assistant follow-up message did not arrive within ${timeoutMs}ms`,
    );
  }
  // Phase 2: once a new message has appeared, hold off reading its
  // text until the count has been stable for `settleMs`. While we
  // primarily watch the assistant-message COUNT, a still-streaming
  // message can mutate text mid-read; the settle window mirrors the
  // conversation-runner's per-turn settle pattern so partial reads
  // don't trip substring assertions.
  let lastChangeAt = Date.now();
  let lastCount = count;
  while (Date.now() < deadline) {
    if (Date.now() - lastChangeAt >= settleMs) {
      return await readLatestAssistantText(page);
    }
    await sleep(POLL_INTERVAL_MS);
    const current = await readAssistantCount(page);
    if (current !== lastCount) {
      lastCount = current;
      lastChangeAt = Date.now();
    }
  }
  // Deadline elapsed before the new message could settle — return
  // what we have rather than throw, so substring assertions get a
  // chance against a partial read.
  return await readLatestAssistantText(page);
}

/**
 * Read the current assistant-message count. Mirrors
 * `conversation-runner.ts::readMessageCount` — using the SAME
 * canonical + fallback selectors so the helper here can never count
 * user bubbles when the runner doesn't (a drift that previously made
 * `waitForNextAssistantMessage` over-count user input bubbles toward
 * the assistant total).
 */
export async function readAssistantCount(page: Page): Promise<number> {
  try {
    const code = `
      (() => {
        const doc = globalThis.document;
        const canonical = doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
        )});
        if (canonical.length > 0) return canonical.length;
        const fallback = doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
        return fallback.length;
      })()
    `;
    const fn = new Function(`return ${code.trim()};`) as () => number;
    return await page.evaluate(fn);
  } catch {
    return 0;
  }
}

/**
 * Read the text content of the latest (last) assistant message. Returns
 * empty string on any read error so the caller's assertion (which
 * normally checks substring inclusion) fails with a clear "expected X
 * to be in '<empty>'" error rather than a confusing access exception.
 */
async function readLatestAssistantText(page: Page): Promise<string> {
  try {
    const code = `
      (() => {
        const doc = globalThis.document;
        const canonical = doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
        )});
        const list = canonical.length > 0
          ? canonical
          : doc.querySelectorAll(${JSON.stringify(
            ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
          )});
        if (list.length === 0) return "";
        const last = list[list.length - 1];
        return (last && last.textContent ? last.textContent : "").trim();
      })()
    `;
    const fn = new Function(`return ${code.trim()};`) as () => string;
    return await page.evaluate(fn);
  } catch {
    return "";
  }
}

/**
 * Race a list of selectors and return the first one that resolves
 * within `SELECTOR_PROBE_TIMEOUT_MS`. ALL selectors are probed
 * concurrently via `Promise.race`; whichever resolves first wins. On
 * full miss (every probe rejects within the shared timeout), throws an
 * Error with the supplied label and a consolidated reason listing each
 * tried selector's failure detail so the caller's failure surfaces
 * what was being looked for (e.g. "approval dialog not found").
 *
 * Concurrent probing matters: with N selectors and per-probe timeout
 * T, sequential probing wastes N*T on a full miss (12s for 4 selectors
 * at 3s each). True race caps total wait at T regardless of N — the
 * docstring's promise.
 */
export async function selectorCascade(
  page: Page,
  selectors: ReadonlyArray<string>,
  label: string,
): Promise<string> {
  if (selectors.length === 0) {
    throw new Error(`${label} not found: no selectors provided`);
  }
  // Track per-probe outcome for the consolidated error on full miss.
  const failures: Array<{ selector: string; reason: string }> = [];
  const probes = selectors.map(
    (selector) =>
      new Promise<string>((resolve, reject) => {
        page
          .waitForSelector(selector, {
            state: "visible",
            timeout: SELECTOR_PROBE_TIMEOUT_MS,
          })
          .then(() => resolve(selector))
          .catch((err: unknown) => {
            failures.push({
              selector,
              reason: err instanceof Error ? err.message : String(err),
            });
            reject(err);
          });
      }),
  );
  try {
    // `Promise.any` resolves with the first probe that resolves; if
    // every probe rejects, throws an `AggregateError`. This is the
    // canonical "first-to-resolve" race for arrays of fallible
    // promises (`Promise.race` would resolve/reject on the first
    // settle, including a fast rejection).
    return await Promise.any(probes);
  } catch {
    const detail = failures
      .map((f) => `${f.selector} (${f.reason})`)
      .join("; ");
    throw new Error(`${label} not found${detail ? `: tried ${detail}` : ""}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
