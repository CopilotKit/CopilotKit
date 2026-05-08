/**
 * D5 — `gen-ui-open-advanced` script.
 *
 * Phase-2A split (see `.claude/specs/lgp-test-genuine-pass.md`): the old
 * `d5-gen-ui-open.ts` claimed both `open-gen-ui` and
 * `open-gen-ui-advanced` via the SAME `gen-ui-open` literal, which
 * meant a regression on the advanced demo's iframe sandbox would NEVER
 * surface — the basic-tier assertion didn't read iframe state. This
 * probe is scoped to the advanced demo and asserts iframe presence as
 * its distinguishing signal.
 *
 * Selector cascade (most-specific first):
 *   1. `[data-testid="gen-ui-open-advanced-iframe"]`     — canonical testid
 *                                                          (Phase-1C adds this).
 *   2. `iframe[sandbox*="allow-scripts"]`                — sandbox-attribute
 *                                                          fallback. The
 *                                                          advanced demo
 *                                                          renders the user
 *                                                          payload inside a
 *                                                          sandboxed iframe
 *                                                          with at minimum
 *                                                          `allow-scripts` so
 *                                                          this matches the
 *                                                          spec. A bare
 *                                                          `iframe` fallback
 *                                                          would over-match
 *                                                          (e.g. third-party
 *                                                          analytics frames
 *                                                          on the host page).
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `e2e-deep.ts` discovers it via the `d5-*` filename
 * convention.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const ADVANCED_IFRAME_SELECTORS = [
  '[data-testid="gen-ui-open-advanced-iframe"]',
  'iframe[sandbox*="allow-scripts"]',
] as const;

const IFRAME_POLL_TIMEOUT_MS = 15_000;
const IFRAME_POLL_INTERVAL_MS = 250;

/**
 * Probe for the advanced-tier iframe. Returns the matching selector or
 * `null`. The cascade is hard-coded inside the evaluated function
 * because `Page.evaluate(() => R)` doesn't carry closure captures
 * across the Playwright serialisation boundary.
 */
export async function probeAdvancedIframe(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
      };
    };
    const selectors = [
      '[data-testid="gen-ui-open-advanced-iframe"]',
      'iframe[sandbox*="allow-scripts"]',
    ];
    for (const sel of selectors) {
      if (win.document.querySelector(sel)) return sel;
    }
    return null;
  });
}

/**
 * Per-turn assertion: poll for the iframe up to `timeoutMs`. The
 * `(tried ...)` suffix in the error mirrors `d5-mcp-apps.ts` so
 * operators triaging multiple iframe-style probes recognise the
 * shape immediately.
 */
export async function assertAdvancedIframe(
  page: Page,
  timeoutMs: number = IFRAME_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sel = await probeAdvancedIframe(page);
    if (sel !== null) {
      console.debug("[d5-gen-ui-open-advanced] iframe present", {
        selector: sel,
      });
      return;
    }
    await new Promise<void>((r) => setTimeout(r, IFRAME_POLL_INTERVAL_MS));
  }
  throw new Error(
    `gen-ui-open-advanced: expected iframe but selector cascade matched 0 elements after ${timeoutMs}ms ` +
      `(tried ${ADVANCED_IFRAME_SELECTORS.join(", ")})`,
  );
}

/**
 * Build the conversation turns. We send a verbatim suggestion-pill
 * prompt from `open-gen-ui-advanced/suggestions.ts` ("Inline expression
 * evaluator") which is keyed in `showcase/aimock/d5-all.json` to a
 * deterministic `generateSandboxedUi` tool call. That tool call is
 * what causes the advanced demo to mount a sandboxed iframe with
 * `srcdoc` set to a small HTML+CSS payload; without a fixture-keyed
 * prompt the agent would either skip the tool call entirely or fall
 * through to a content-only catch-all, leaving the iframe assertion
 * red on a stable demo.
 *
 * The iframe is the demo's load-bearing surface regardless of chat
 * round-trip outcome — this turn pinpoints "the advanced sandbox
 * didn't mount" failures from "the chat regressed" failures.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "Inline expression evaluator",
      assertions: assertAdvancedIframe,
    },
  ];
}

export function preNavigateRoute(): string {
  return "/demos/open-gen-ui-advanced";
}

registerD5Script({
  featureTypes: ["gen-ui-open-advanced"],
  fixtureFile: "gen-ui-open.json",
  buildTurns,
  preNavigateRoute,
});
