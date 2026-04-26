/**
 * D5 — gen-UI (headless) script.
 *
 * Probes the showcase's `/demos/headless-simple` page against the
 * frontend-defined `show_card` tool (registered via `useComponent` in
 * `headless-simple/page.tsx`). The fixture
 * (`fixtures/d5/gen-ui-headless.json`) makes the agent emit a
 * `show_card` tool call which the headless chat surface materialises
 * into a `ShowCard` React component (titled card with a body
 * paragraph).
 *
 * Two-turn shape (mirrors the recorded fixture):
 *   1. User: "Show me a profile card for Ada Lovelace"
 *      → Agent calls `show_card({ title, body })` → frontend renders
 *      `ShowCard` → second-leg LLM round narrates the rendered card.
 *
 * Acceptance for the headless tier (NOT the custom tier):
 *   - The custom-rendered component must be present in the DOM (NOT
 *     just text). Empty wrappers are explicitly rejected by the
 *     selector cascade in `_gen-ui-shared.ts`.
 *   - Component must have at least one child element (the headless
 *     `ShowCard` has two: the title `<div>` and the body `<div>`).
 *   - The assistant's follow-up narration must reference the rendered
 *     content (the fixture narrates "card above" / Ada's biography).
 *
 * The custom-tier script (`d5-gen-ui-custom.ts`) layers a STRUCTURAL
 * match on top — for `render_pie_chart` it asserts an SVG with
 * multiple drawing children, which is what makes "custom" stricter
 * than "headless".
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  readLastAssistantText,
  waitForGenUiComponent,
} from "./_gen-ui-shared.js";

/**
 * Minimum childElementCount required after the cascade resolves. The
 * `ShowCard` implementation in `headless-simple/page.tsx` renders two
 * divs (title + body), so requiring `>= 1` rejects empty wrappers
 * without coupling to the exact ShowCard layout.
 */
const MIN_CHILDREN = 1;

/**
 * Lower-case tokens we expect to find in the assistant's follow-up
 * text (post-tool-call narration). The fixture writes a short
 * paragraph that mentions "card" and "Ada" — checking a small set of
 * tokens guards against the showcase silently swallowing the second
 * round-trip while still being robust to wording drift.
 */
const FOLLOWUP_TOKENS = ["card", "ada"] as const;

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "Show me a profile card for Ada Lovelace",
      assertions: async (page) => {
        // 1. Cascade-find the rendered component. Throws on timeout
        //    with a descriptive error so the conversation-runner
        //    surfaces it as the turn's failure_turn.
        const matchedSelector = await waitForGenUiComponent(page);

        // 2. Re-read the matched node's child count — ensures the
        //    component is structurally non-trivial. The selector
        //    cascade already filtered empty wrappers, but the chat
        //    surface may grow content asynchronously, so the explicit
        //    follow-up check guards against a between-poll race where
        //    the cascade matched but children hadn't mounted yet.
        const childCount = await page.evaluate(() => {
          const win = globalThis as unknown as {
            document: {
              querySelector(sel: string): { childElementCount: number } | null;
            };
          };
          // We re-resolve the cascade inside the browser to avoid a
          // closure capture of `matchedSelector` (page.evaluate's
          // function executes in the browser context — the Node-side
          // string isn't directly available).
          const selectors = [
            '[data-testid="gen-ui-card"]',
            '[data-testid="gen-ui-component"]',
            "[data-tool-name]",
            ".copilotkit-render-component",
            '[role="article"] svg',
            '[role="article"]',
          ];
          for (const selector of selectors) {
            const node = win.document.querySelector(selector);
            if (node) return node.childElementCount;
          }
          return 0;
        });
        if (childCount < MIN_CHILDREN) {
          throw new Error(
            `gen-ui-headless: matched component ${matchedSelector} has ${childCount} children (expected >= ${MIN_CHILDREN})`,
          );
        }

        // 3. Confirm the assistant followed up with narration that
        //    references the rendered card. Token-level check (NOT a
        //    string-equality assertion against the fixture) so wording
        //    drift across integrations doesn't fail the probe.
        const text = (await readLastAssistantText(page)).toLowerCase();
        const missing = FOLLOWUP_TOKENS.filter((tok) => !text.includes(tok));
        if (missing.length > 0) {
          throw new Error(
            `gen-ui-headless: assistant follow-up missing tokens [${missing.join(
              ", ",
            )}]; last assistant text: ${text.slice(0, 200)}`,
          );
        }
      },
    },
  ];
}

/**
 * Override the default `/demos/<featureType>` route. The fixture is
 * recorded against `/demos/headless-simple` (the actual showcase route
 * that wires the `show_card` `useComponent`), not the literal feature
 * type. Mirrors the mcp-apps → /demos/subagents pattern documented in
 * the registry comments.
 */
function preNavigateRoute(): string {
  return "/demos/headless-simple";
}

registerD5Script({
  featureTypes: ["gen-ui-headless"],
  fixtureFile: "gen-ui-headless.json",
  buildTurns,
  preNavigateRoute,
});
