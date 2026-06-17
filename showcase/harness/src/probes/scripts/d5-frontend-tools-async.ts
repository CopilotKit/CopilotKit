/**
 * D5 — frontend-tools-async script.
 *
 * Drives `/demos/frontend-tools-async` through one pill prompt that
 * exercises an async frontend tool (`query_notes`). The async handler
 * sleeps 500ms, returns matching notes from the in-memory NOTES_DB,
 * and the agent's render callback paints a `NotesCard`.
 *
 * Genuine assertion: after the pill prompt, the
 * `[data-testid="notes-card"]` mounts AND its content includes either
 * a non-empty `[data-testid="notes-list"]` (matched notes) or the
 * "No notes matched" empty-state. Both shapes prove the async handler
 * resolved and the agent forwarded the result back into render.
 *
 * Replaces the prior keyword-match assertion ("transcript mentions
 * 'async'") which would stay green even if the async handler silently
 * dropped its result and the card never mounted.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  FIRST_SIGNAL_TIMEOUT_MS,
  SIBLING_TIMEOUT_MS,
  waitForTestId,
} from "./_genuine-shared.js";

/** Pill prompt MUST match `frontend-tools-async/page.tsx` suggestions. */
export const ASYNC_PILL_PROMPT = "Find my notes about project planning.";

/** Read whether the notes-card has either a populated list or the
 *  empty-state copy. Both prove the render callback received a
 *  resolved result; the card cannot mount without `result` being set
 *  (status flips through "complete" only after the async handler
 *  resolves). */
async function readNotesCardSettled(page: Page): Promise<{
  cardMounted: boolean;
  hasListItems: boolean;
  hasEmptyState: boolean;
}> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
        querySelectorAll(sel: string): { length: number };
        body?: { innerText?: string };
      };
    };
    const card = win.document.querySelector('[data-testid="notes-card"]');
    const listItems = win.document.querySelectorAll('[data-testid^="note-"]');
    const bodyText = win.document.body?.innerText ?? "";
    return {
      cardMounted: !!card,
      hasListItems: listItems.length > 0,
      hasEmptyState: bodyText.includes("No notes matched"),
    };
  })) as {
    cardMounted: boolean;
    hasListItems: boolean;
    hasEmptyState: boolean;
  };
}

export function buildAsyncToolsAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeout = opts?.timeoutMs ?? FIRST_SIGNAL_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    await waitForTestId(page, "notes-card", timeout, "frontend-tools-async");
    // After the card mounts, the async handler may still be settling.
    // Poll for either populated list OR empty state — `loading=true`
    // never reaches a settled shape so this catches a regression where
    // the async handler hangs without resolving.
    const deadline = Date.now() + SIBLING_TIMEOUT_MS;
    let last = {
      cardMounted: false,
      hasListItems: false,
      hasEmptyState: false,
    };
    while (Date.now() < deadline) {
      last = await readNotesCardSettled(page);
      if (last.hasListItems || last.hasEmptyState) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(
      `frontend-tools-async: notes-card mounted but never settled — list items: ${last.hasListItems}, empty-state: ${last.hasEmptyState}`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: ASYNC_PILL_PROMPT,
      assertions: buildAsyncToolsAssertion(),
      responseTimeoutMs: 60_000,
    },
  ];
}

registerD5Script({
  featureTypes: ["frontend-tools-async"],
  fixtureFile: "frontend-tools-async.json",
  buildTurns,
});
