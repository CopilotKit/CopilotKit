/** Canonical empty-state samples and persistent suggestions are distinct controls. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  HEADLESS_COMPLETE_PILLS,
  HEADLESS_REVENUE_VALUES,
  immediatePill,
} from "./_pill-contracts-beautiful-headless.js";
import {
  assertBarValues,
  assertVisibleValues,
} from "./_beautiful-chat-shared.js";

async function countCards(page: Page, selector: string): Promise<number> {
  return page.evaluate((scope) => {
    const { document } = globalThis as typeof globalThis & {
      document: { querySelectorAll(selector: string): { length: number } };
    };
    return document.querySelectorAll(scope!).length;
  }, selector);
}

async function assertInventory(page: Page, sample: boolean): Promise<void> {
  await page.waitForSelector('[data-testid="headless-composer"]', {
    state: "visible",
    timeout: 15_000,
  });
  const prefix = sample ? "Try suggestion: " : "Suggestion: ";
  const expected = HEADLESS_COMPLETE_PILLS.map(
    (pill) => prefix + (sample ? pill.sample : pill.title),
  );
  await page.waitForSelector(`button[aria-label^=${JSON.stringify(prefix)}]`, {
    state: "visible",
    timeout: 15_000,
  });
  const actual = await page.evaluate((labelPrefix) => {
    const { document } = globalThis as typeof globalThis & {
      document: {
        querySelectorAll(
          selector: string,
        ): ArrayLike<{ getAttribute(name: string): string | null }>;
      };
    };
    return Array.from(
      document.querySelectorAll(`button[aria-label^="${labelPrefix}"]`),
      (node) => node.getAttribute("aria-label"),
    );
  }, prefix);
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      `headless-complete: canonical inventory mismatch ${JSON.stringify(actual)}`,
    );
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [true, false].flatMap((sample) =>
    HEADLESS_COMPLETE_PILLS.map((pill) => {
      let baseline = 0;
      const action = immediatePill(
        `headless-${sample ? "sample" : "suggestion"}-${pill.id}`,
        `${sample ? "Try suggestion: " : "Suggestion: "}${sample ? pill.sample : pill.title}`,
        sample ? pill.sample : pill.prompt,
      );
      return {
        ...(sample ? { scenario: "fresh" as const } : {}),
        input: action.expectedDispatchedPrompt,
        action,
        responseTimeoutMs: 60_000,
        preFill: async (page: Page) => {
          await assertInventory(page, sample);
          baseline = await countCards(page, pill.selector);
        },
        assertions: async (page: Page) => {
          await assertVisibleValues(
            page,
            `${pill.selector} >> nth=${baseline}`,
            pill.values,
          );
          if ((await countCards(page, pill.selector)) !== baseline + 1)
            throw new Error(`${action.id}: expected exactly one new card`);
          if (pill.id === "revenue")
            await assertBarValues(
              page,
              pill.selector,
              HEADLESS_REVENUE_VALUES,
              baseline,
            );
        },
      };
    }),
  );
}
registerD5Script({
  featureTypes: ["gen-ui-headless-complete"],
  fixtureFile: "gen-ui-headless-complete.json",
  buildTurns,
  preNavigateRoute: () => "/demos/headless-complete",
});
