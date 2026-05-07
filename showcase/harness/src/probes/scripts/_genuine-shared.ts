/**
 * Shared helpers for the Phase-2B "smoke→genuine" probe rewrites.
 *
 * Replaces the keyword-match-on-transcript pattern with side-effect
 * assertions: pill clicks, DOM testid presence, network-payload
 * interception. All probes in this batch have the same shape:
 *
 *   1. (Optional) seed UI state (form input, context selector).
 *   2. Click a suggestion pill by its visible label.
 *   3. Wait for the agent's settle to produce a side effect on the
 *      page — a testid mounting, a CSS background mutating, an
 *      iframe srcdoc populating, etc.
 *   4. Assert that side effect happened.
 *
 * The runner's structural `Page` type doesn't expose `.click()` or
 * `.route()`, but real Playwright Page does. Each helper that needs
 * those methods runtime-narrows via a small type-guard so unit-test
 * fakes that omit them fail loudly rather than silently.
 *
 * Mirrors the `_beautiful-chat-shared.ts` pattern. Excalidraw
 * exclusions / failure tradeoffs are documented at each probe site.
 */

import type { Page as ConversationPage } from "../helpers/conversation-runner.js";

/**
 * Long budget for the FIRST visible signal in a tool/UI-driven render.
 * Covers cold-start tax (Playwright launch, Next.js hydrate, agent
 * rehydrate, fixture-matched response stream). Mirrors the value used
 * by the beautiful-chat family.
 */
export const FIRST_SIGNAL_TIMEOUT_MS = 60_000;

/** Tighter budget once the surface is mounted — sibling assertions
 *  should land within a few hundred ms. 5s leaves headroom for slow
 *  Windows runners. */
export const SIBLING_TIMEOUT_MS = 5_000;

/**
 * Extension of the runner's structural `Page` type with the methods
 * these probes need. Real Playwright Page exposes all of them
 * natively; the runner's minimal type intentionally excludes them so
 * unit tests can pass scripted fakes.
 */
export interface GenuinePage extends ConversationPage {
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  route(
    url: string | RegExp,
    handler: (
      route: GenuineRoute,
      request: GenuineRequest,
    ) => void | Promise<void>,
  ): Promise<void>;
  unroute?(url: string | RegExp): Promise<void>;
}

export interface GenuineRoute {
  continue(): Promise<void>;
  fulfill(opts: { status?: number; body?: string }): Promise<void>;
}

export interface GenuineRequest {
  url(): string;
  method(): string;
  postData(): string | null;
}

/**
 * Narrow `page` to the click-capable shape with a runtime guard.
 * Mirrors the pattern in `_beautiful-chat-shared.ts` — the structural
 * `ConversationPage` doesn't expose `.click()`, so probes that need it
 * must cast and verify the method actually exists at runtime so a
 * wrong-shaped fake fails loudly rather than silently.
 */
export function asGenuinePage(
  page: ConversationPage,
  pillTag: string,
): GenuinePage {
  const candidate = page as unknown as GenuinePage;
  if (typeof (candidate as { click?: unknown }).click !== "function") {
    throw new Error(
      `${pillTag}: page is missing click() — runner did not provide a Playwright-shaped page`,
    );
  }
  return candidate;
}

/**
 * Click the suggestion pill whose visible label matches `pillText`
 * (substring match). Pills are rendered with
 * `data-testid="copilot-suggestion"`; Playwright's `:has-text()`
 * pseudo-selector picks the right one.
 */
export async function clickPillByText(
  page: ConversationPage,
  pillText: string,
  pillTag: string,
): Promise<void> {
  const clickable = asGenuinePage(page, pillTag);
  const selector = `[data-testid="copilot-suggestion"]:has-text("${pillText}")`;
  try {
    await page.waitForSelector(selector, {
      state: "visible",
      timeout: SIBLING_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `${pillTag}: pill with text "${pillText}" did not become visible within ${SIBLING_TIMEOUT_MS}ms`,
    );
  }
  await clickable.click(selector, { timeout: SIBLING_TIMEOUT_MS });
}

/**
 * Wait for a testid selector to mount. Wraps Playwright's
 * `waitForSelector` with a friendlier error so the failure_turn entry
 * carries a descriptive message — the conversation runner surfaces the
 * thrown message verbatim into the probe's signal blob.
 */
export async function waitForTestId(
  page: ConversationPage,
  testid: string,
  timeoutMs: number,
  pillTag: string,
): Promise<void> {
  try {
    await page.waitForSelector(`[data-testid="${testid}"]`, {
      state: "visible",
      timeout: timeoutMs,
    });
  } catch {
    throw new Error(
      `${pillTag}: expected [data-testid="${testid}"] to mount within ${timeoutMs}ms`,
    );
  }
}

/**
 * Read text content concatenated across all elements matching a
 * selector. Lower-cased for case-insensitive substring assertions.
 */
export async function readTranscriptText(
  page: ConversationPage,
): Promise<string> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const sels = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let nodes: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const s of sels) {
      const f = win.document.querySelectorAll(s);
      if (f.length > 0) {
        nodes = f;
        break;
      }
    }
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return acc;
  })) as string;
}
