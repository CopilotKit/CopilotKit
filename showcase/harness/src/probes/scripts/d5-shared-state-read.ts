/**
 * D5 — shared-state-read script (recipe-editor variant).
 *
 * Drives `/demos/shared-state-read` — the recipe-editor demo that uses
 * the NEUTRAL DEFAULT agent (no backend tools, no state schema). The
 * frontend publishes a `RecipeAgentState` (title / skill_level /
 * cooking_time / special_preferences / ingredients / instructions) to
 * the agent via `agent.setState({recipe: ...})`; the agent reads the
 * recipe context but does NOT mutate it (this is the READ-ONLY half of
 * shared-state, distinct from the bidirectional write demo at
 * `/demos/shared-state-read-write`).
 *
 * Two-turn flow:
 *   1. Send the "Italian recipe" chip prompt. With no backend tool the
 *      agent simply replies in chat referencing what it sees in the
 *      shared recipe state. Asserts the recipe-card mounted on the
 *      left pane (the form is the demo's whole point — if it didn't
 *      render, the page is broken). Asserts the assistant produced
 *      a non-empty response.
 *   2. Send the "Make it healthier" chip prompt. The agent's reply
 *      should reference the recipe context (any of: pasta / italian /
 *      healthy / ingredient names) — checks that shared state IS
 *      reaching the agent across turns.
 *
 * No `set_recipe` tool exists — this probe is intentionally lighter
 * than the bidirectional write probe. What it CATCHES: a regression
 * where the recipe form fails to render, where `agent.setState()` no
 * longer plumbs through, or where the chat surface itself is broken
 * on this route.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Chip prompts MUST mirror `shared-state-read/page.tsx` lines 101-117
 *  verbatim. Aimock's `userMessage` substring matcher fires on the
 *  fixture's match key — drift here means no fixture lands. */
export const TURN_1_INPUT = "Create a delicious Italian pasta recipe.";
export const TURN_2_INPUT = "Make the recipe healthier with more vegetables.";

const RECIPE_CARD_TESTID = "recipe-card";
const RECIPE_CARD_TIMEOUT_MS = 15_000;

/**
 * The shared-state-read probe ALWAYS targets the standalone recipe-
 * editor route; export the path as a constant so the unit test can
 * verify it without spinning up the full registry.
 */
export const SHARED_STATE_READ_ROUTE = "/demos/shared-state-read";

export function preNavigateRoute(featureType: D5FeatureType): string {
  if (featureType === "shared-state-read") return SHARED_STATE_READ_ROUTE;
  throw new Error(
    `d5-shared-state-read: preNavigateRoute called with unsupported featureType "${featureType}"`,
  );
}

/** Read concatenated assistant transcript text (lowercased). The recipe
 *  editor uses CopilotSidebar (a.k.a. the docked variant), so the
 *  selector cascade is identical to other CopilotKit-rendered chat
 *  surfaces. */
async function readAssistantTranscript(page: Page): Promise<string> {
  return await page.evaluate(() => {
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
      const found = win.document.querySelectorAll(s);
      if (found.length > 0) {
        nodes = found;
        break;
      }
    }
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return acc.toLowerCase();
  });
}

/** Assert the recipe-card form root is mounted on the page. This is
 *  the demo's whole point — without the form, there's nothing to
 *  read state from, and the page is functionally broken. */
async function assertRecipeCardMounted(page: Page, tag: string): Promise<void> {
  try {
    await page.waitForSelector(`[data-testid="${RECIPE_CARD_TESTID}"]`, {
      state: "visible",
      timeout: RECIPE_CARD_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `${tag}: expected [data-testid="${RECIPE_CARD_TESTID}"] to mount within ${RECIPE_CARD_TIMEOUT_MS}ms — the recipe-editor form failed to render, the page is functionally broken`,
    );
  }
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: TURN_1_INPUT,
      responseTimeoutMs: 60_000,
      assertions: async (page) => {
        const tag = "shared-state-read turn 1";
        // The recipe form must be mounted before the agent can read
        // any state from it. Assert it on every turn — a regression
        // that unmounts the form mid-conversation would otherwise be
        // invisible.
        await assertRecipeCardMounted(page, tag);
        const text = await readAssistantTranscript(page);
        console.debug(`[d5-shared-state-read] ${tag} text`, {
          length: text.length,
          snippet: text.slice(0, 300),
        });
        if (text.trim().length === 0) {
          throw new Error(
            `${tag}: assistant produced no visible response after the chip prompt — chat surface or runtime wiring may be broken`,
          );
        }
      },
    },
    {
      input: TURN_2_INPUT,
      responseTimeoutMs: 60_000,
      assertions: async (page) => {
        const tag = "shared-state-read turn 2";
        await assertRecipeCardMounted(page, tag);
        const text = await readAssistantTranscript(page);
        console.debug(`[d5-shared-state-read] ${tag} text`, {
          length: text.length,
          snippet: text.slice(0, 300),
        });
        if (text.trim().length === 0) {
          throw new Error(
            `${tag}: assistant produced no visible response after the chip prompt — chat surface or runtime wiring may be broken`,
          );
        }
        // Soft signal that the agent saw the recipe context (initial
        // state seeds the form with a couple of ingredients + an
        // instruction). The fixture's canned reply mentions at least
        // one of these tokens; if NONE land, either shared state isn't
        // reaching the agent or the fixture drifted.
        const recipeContextTokens = [
          "recipe",
          "pasta",
          "italian",
          "vegetable",
          "ingredient",
          "healthy",
        ];
        const hit = recipeContextTokens.some((t) => text.includes(t));
        if (!hit) {
          throw new Error(
            `${tag}: assistant response did not reference recipe context (none of [${recipeContextTokens.join(", ")}] present) — shared state may not be reaching the agent. Got (truncated): ${text.slice(0, 300)}`,
          );
        }
      },
    },
  ];
}

registerD5Script({
  featureTypes: ["shared-state-read"],
  fixtureFile: "shared-state-read.json",
  buildTurns,
  preNavigateRoute,
});
