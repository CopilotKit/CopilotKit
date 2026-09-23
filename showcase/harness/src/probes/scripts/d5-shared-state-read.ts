/**
 * D5 — shared-state-read script (recipe-editor variant).
 *
 * Drives `/demos/shared-state-read` — the recipe-editor demo whose agent
 * has no backend tool. The frontend publishes a `RecipeAgentState`
 * (title / skill_level / cooking_time / special_preferences /
 * ingredients / instructions) to the agent via
 * `agent.setState({recipe: ...})`; the agent reads the recipe context but
 * does NOT mutate it (this is the READ-ONLY half of shared-state,
 * distinct from the bidirectional write demo at
 * `/demos/shared-state-read-write`).
 *
 * Two-turn flow:
 *   1. Rename the recipe to `EDITED_RECIPE_TITLE` in the form (the UI's
 *      only write), then send the "Italian recipe" chip prompt. Asserts
 *      the recipe-card mounted on the left pane (the form is the demo's
 *      whole point — if it didn't render, the page is broken), that the
 *      edit stuck in the controlled input (so `agent.setState` accepted
 *      it), and that the assistant produced a non-empty response.
 *   2. Send the "Make it healthier" chip prompt. The agent's reply
 *      should reference the recipe context (any of: pasta / italian /
 *      healthy / ingredient names).
 *
 * The probe stays identical for every integration. Whether the edited
 * value actually reaches the model is decided by each integration's
 * fixture: a fixture that gates on `EDITED_RECIPE_TITLE` (for example via
 * `systemMessage`) only matches when the request carries the edit, so a
 * missing UI-to-agent state bridge fails strict mode.
 *
 * No `set_recipe` tool exists — this probe is intentionally lighter
 * than the bidirectional write probe. What it CATCHES: a regression
 * where the recipe form fails to render, where `agent.setState()` no
 * longer plumbs through, or where the chat surface itself is broken
 * on this route.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Chip prompts MUST mirror `shared-state-read/page.tsx` lines 101-117
 *  verbatim. Aimock's `userMessage` substring matcher fires on the
 *  fixture's match key — drift here means no fixture lands. */
export const TURN_1_INPUT = "Create a delicious Italian pasta recipe.";
export const TURN_2_INPUT = "Make the recipe healthier with more vegetables.";

/** The title the probe types into the recipe form before turn 1. It must
 *  not appear in any prompt, instruction, or default recipe, so a fixture
 *  that requires it matches only a request that carries the UI's edit. */
export const EDITED_RECIPE_TITLE = "Lemon Saffron Orzo";

const RECIPE_CARD_TESTID = "recipe-card";
const RECIPE_CARD_TIMEOUT_MS = 15_000;
/** `aria-label` on the recipe card's title input (shared recipe-card.tsx). */
export const RECIPE_TITLE_SELECTOR = 'input[aria-label="Recipe title"]';

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

const TITLE_EDIT_SETTLE_MS = 5_000;
const TITLE_EDIT_POLL_MS = 100;

async function readRecipeTitle(page: Page): Promise<string | null> {
  // The selector is written into the closure instead of being passed as an
  // `evaluate` argument: the D6 driver's page wrapper forwards only the
  // function, so an argument arrives `undefined` and the lookup always
  // misses (the zero-arg convention in conversation-runner's
  // readSurfaceCounts). It must equal RECIPE_TITLE_SELECTOR; the unit test
  // runs this closure against a stub document keyed on that constant.
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): { value?: string } | null;
      };
    };
    return (
      win.document.querySelector('input[aria-label="Recipe title"]')?.value ??
      null
    );
  });
}

/** Rename the recipe through the form, the UI's only write path. The title
 *  input is controlled by `agent.state.recipe`, so the new value only sticks
 *  once `agent.setState` has accepted it. */
export async function editRecipeTitle(page: Page): Promise<void> {
  const tag = "shared-state-read turn 1 (edit recipe)";
  await assertRecipeCardMounted(page, tag);
  await page.fill(RECIPE_TITLE_SELECTOR, EDITED_RECIPE_TITLE, {
    timeout: RECIPE_CARD_TIMEOUT_MS,
  });
  const deadline = Date.now() + TITLE_EDIT_SETTLE_MS;
  let value = await readRecipeTitle(page);
  while (value !== EDITED_RECIPE_TITLE && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TITLE_EDIT_POLL_MS));
    value = await readRecipeTitle(page);
  }
  if (value !== EDITED_RECIPE_TITLE) {
    throw new Error(
      `${tag}: typed "${EDITED_RECIPE_TITLE}" into ${RECIPE_TITLE_SELECTOR} but the input shows ${JSON.stringify(value)} — agent.setState did not accept the edit`,
    );
  }
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: TURN_1_INPUT,
      responseTimeoutMs: 60_000,
      preFill: editRecipeTitle,
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
