/** One shared public-button program; each theme must produce its exact rendered gradient. */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FRONTEND_TOOLS_CANONICAL } from "../../shared/cell-model/live-status.js";
import { SIBLING_TIMEOUT_MS, waitForTestId } from "./_genuine-shared.js";

export const FRONTEND_TOOL_PILLS = FRONTEND_TOOLS_CANONICAL.actions;

export function buildPillAssertion(
  id: (typeof FRONTEND_TOOL_PILLS)[number]["id"],
  baselineRef: { current: string },
): (page: Page) => Promise<void> {
  const expected = FRONTEND_TOOL_PILLS.find((action) => action.id === id)!;
  return async (page) => {
    await waitForTestId(
      page,
      "frontend-tools-background",
      SIBLING_TIMEOUT_MS,
      `frontend-tools-${id}`,
    );
    const background = await page.evaluate((gradient) => {
      type Node = {
        textContent: string | null;
        getAttribute(name: string): string | null;
        getClientRects(): { length: number };
        style: { background: string; backgroundImage: string };
      };
      const win = globalThis as unknown as {
        document: {
          querySelectorAll(selector: string): ArrayLike<Node>;
          createElement(tag: string): Node;
        };
        getComputedStyle(node: Node): {
          backgroundImage: string;
          visibility: string;
          opacity: string;
        };
      };
      const nodes = Array.from(
        win.document.querySelectorAll(
          '[data-testid="frontend-tools-background"]',
        ),
      );
      const node = nodes[0];
      const style = node ? win.getComputedStyle(node) : undefined;
      const comparison = win.document.createElement("div");
      comparison.style.background = String(gradient);
      return {
        count: nodes.length,
        visible: Boolean(
          node &&
          node.getClientRects().length &&
          style?.visibility !== "hidden" &&
          style?.opacity !== "0",
        ),
        value: node?.getAttribute("data-background-value"),
        rendered: style?.backgroundImage,
        expected: comparison.style.backgroundImage,
        labels: Array.from(
          win.document.querySelectorAll(
            '[data-testid="copilot-suggestions"] button',
          ),
        ).map((button) => button.textContent),
      };
    }, expected.gradient);
    if (
      !background ||
      background.count !== 1 ||
      !background.visible ||
      background.value !== expected.gradient ||
      !background.expected ||
      background.rendered !== background.expected ||
      background.value === baselineRef.current ||
      background.labels.length !== FRONTEND_TOOL_PILLS.length ||
      background.labels.some(
        (label, index) => label !== FRONTEND_TOOL_PILLS[index]!.label,
      )
    )
      throw new Error(
        `frontend-tools-${id}: canonical buttons or rendered gradient differ`,
      );
    baselineRef.current = background.value;
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  const baselineRef = { current: "#4f46e5" };
  return FRONTEND_TOOL_PILLS.map((action) => ({
    action,
    input: action.prompt,
    assertionId: FRONTEND_TOOLS_CANONICAL.assertionId,
    assertions: buildPillAssertion(action.id, baselineRef),
    responseTimeoutMs: 60_000,
  }));
}

registerD5Script({
  featureTypes: ["frontend-tools"],
  canonical: FRONTEND_TOOLS_CANONICAL,
  fixtureFile: "frontend-tools.json",
  buildTurns,
});
