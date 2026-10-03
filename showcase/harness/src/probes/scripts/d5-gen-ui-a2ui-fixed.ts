/**
 * D5 — gen-ui-a2ui-fixed script.
 *
 * Drives `/demos/a2ui-fixed-schema`. The agent emits an A2UI payload
 * matching the locked fixed-schema definitions (Card / Title /
 * Airport / …); the renderer materializes the component tree.
 *
 * Genuine assertion: send the suggestion-pill prompt; after settle,
 * assert the `[data-testid="a2ui-fixed-card"]` mounts. Replaces the
 * prior "transcript mentions a2ui" keyword check, which would stay
 * green even if the renderer never painted.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS, waitForTestId } from "./_genuine-shared.js";

/** Default `/demos/<featureType>` would be `/demos/gen-ui-a2ui-fixed`,
 *  which does not exist — the actual route uses the registry-id
 *  `a2ui-fixed-schema`. */
export function preNavigateRoute(_ft: D5FeatureType): string {
  return "/demos/a2ui-fixed-schema";
}

/** Pill prompt MUST match `a2ui-fixed-schema/suggestions.ts`. */
export const A2UI_FIXED_PILL_LABEL = "Find SFO → JFK";
export const A2UI_FIXED_PILL_PROMPT =
  "Find me a flight from SFO to JFK on United for $289.";

export function buildA2uiFixedAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeout = opts?.timeoutMs ?? FIRST_SIGNAL_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    await waitForTestId(page, "a2ui-fixed-card", timeout, "gen-ui-a2ui-fixed");
    const card = page.locator?.('[data-testid="a2ui-fixed-card"]');
    if (
      !card ||
      !card.isVisible ||
      (await card.count()) !== 1 ||
      !(await card.isVisible())
    )
      throw new Error(
        "canonical flight values require exactly one visible card",
      );
    const values = await page.evaluate(() => {
      type ValueNode = {
        innerText: string;
        getClientRects(): { length: number };
      };
      type ValueCard = {
        querySelectorAll(selector: string): ArrayLike<ValueNode>;
      };
      const win = globalThis as unknown as {
        document: { querySelector(selector: string): ValueCard | null };
        getComputedStyle(element: ValueNode): { visibility: string };
      };
      const surfaceCard = win.document.querySelector(
        '[data-testid="a2ui-fixed-card"]',
      );
      return {
        airports: Array.from(
          surfaceCard?.querySelectorAll(
            "div.flex.flex-col.items-center > span.font-mono.text-2xl",
          ) ?? [],
        )
          .filter(
            (element) =>
              element.getClientRects().length > 0 &&
              win.getComputedStyle(element).visibility !== "hidden",
          )
          .map((element) => element.innerText),
        airline: Array.from(
          surfaceCard?.querySelectorAll("div.inline-flex.uppercase") ?? [],
        )
          .filter(
            (element) =>
              element.getClientRects().length > 0 &&
              win.getComputedStyle(element).visibility !== "hidden",
          )
          .map((element) => element.innerText),
        price: Array.from(
          surfaceCard?.querySelectorAll(
            "div.flex.items-baseline > span.font-mono",
          ) ?? [],
        )
          .filter(
            (element) =>
              element.getClientRects().length > 0 &&
              win.getComputedStyle(element).visibility !== "hidden",
          )
          .map((element) => element.innerText),
      };
    });
    if (
      !values ||
      values.airports.length !== 2 ||
      values.airports[0] !== "SFO" ||
      values.airports[1] !== "JFK" ||
      values.airline.length !== 1 ||
      values.airline[0]!.toUpperCase() !== "UNITED" ||
      values.price.length !== 1 ||
      values.price[0] !== "$289"
    )
      throw new Error(
        "canonical flight values differ from SFO → JFK, United, $289",
      );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: A2UI_FIXED_PILL_PROMPT,
      action: {
        id: "find-flight",
        kind: "pill-dispatch",
        label: A2UI_FIXED_PILL_LABEL,
        prompt: A2UI_FIXED_PILL_PROMPT,
      },
      assertionId: "flight-values-v1",
      assertions: buildA2uiFixedAssertion(),
      responseTimeoutMs: 60_000,
      completeOnMount: {
        testIds: ["a2ui-fixed-card"],
      },
    },
  ];
}

registerD5Script({
  featureTypes: ["gen-ui-a2ui-fixed"],
  canonical: {
    id: "a2ui-fixed-schema-v1",
    assertionId: "flight-values-v1",
    actions: [
      {
        id: "find-flight",
        kind: "pill-dispatch",
        label: A2UI_FIXED_PILL_LABEL,
        prompt: A2UI_FIXED_PILL_PROMPT,
      },
    ],
    requiredActionIds: ["find-flight", "book-flight"],
    incompleteReason:
      "Book flight declares book_flight but has an inert handler and no canonical completion expectation",
  },
  fixtureFile: "gen-ui-a2ui-fixed.json",
  buildTurns,
  preNavigateRoute,
});
