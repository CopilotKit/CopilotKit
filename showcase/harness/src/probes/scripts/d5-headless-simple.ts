/** All three disappearing canonical samples run as independent fresh scenarios. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { HEADLESS_SIMPLE_PILLS } from "./_pill-contracts-beautiful-headless.js";
import { assertVisibleValues } from "./_beautiful-chat-shared.js";

export const ASSISTANT_BUBBLE_SELECTOR =
  '[data-testid="headless-message-assistant"]';

export async function assertSimpleInventory(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="headless-composer"]', {
    state: "visible",
    timeout: 15_000,
  });
  await page.waitForSelector('button[data-slot="badge"]', {
    state: "visible",
    timeout: 15_000,
  });
  for (const { action } of HEADLESS_SIMPLE_PILLS) {
    const button = page.getByRole?.("button", {
      name: action.buttonName,
      exact: true,
    });
    if (
      !button ||
      (await button.count()) !== 1 ||
      !(await button.isVisible()) ||
      !(await button.isEnabled())
    )
      throw new Error(
        `headless-simple: missing canonical sample ${action.buttonName}`,
      );
  }
  const names = await page.evaluate(() => {
    const { document } = globalThis as typeof globalThis & {
      document: {
        querySelectorAll(
          selector: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    return Array.from(
      document.querySelectorAll('button[data-slot="badge"]'),
      (node) => node.textContent?.trim(),
    );
  });
  if (
    JSON.stringify(names) !==
    JSON.stringify(HEADLESS_SIMPLE_PILLS.map((pill) => pill.action.buttonName))
  )
    throw new Error(
      `headless-simple: unexpected sample inventory ${JSON.stringify(names)}`,
    );
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return HEADLESS_SIMPLE_PILLS.map(({ action, reply }) => ({
    scenario: "fresh" as const,
    input: action.expectedDispatchedPrompt,
    action,
    preFill: assertSimpleInventory,
    assertions: async (page: Page) => {
      await assertVisibleValues(page, ASSISTANT_BUBBLE_SELECTOR, [reply]);
    },
  }));
}
registerD5Script({
  featureTypes: ["headless-simple"],
  fixtureFile: "headless-simple.json",
  buildTurns,
  preNavigateRoute: () => "/demos/headless-simple",
});
