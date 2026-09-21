import { buildToolsAgentTurns } from "./_pill-contracts-tools-agents.js";
/**
 * Functional acceptance uses the shared canonical LGP pill contract below.
 * Exported legacy assertion helpers remain for supplemental regression tests;
 * buildTurns never uses their weaker diagnostic-only acceptance criteria.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

const REASONING_TIMEOUT_MS = 5_000;

/** Stable selectors that indicate a reasoning-role message has
 *  rendered. The first three are the testids emitted by
 *  showcase/integrations/* ReasoningBlock components (the
 *  `reasoning-custom` demo override). The fourth is the AG-UI role
 *  marker. The fifth is a body-text signal: the published
 *  CopilotChatReasoningMessage built-in slot (used by the
 *  `reasoning-default` demo) renders a "Thought for X seconds" /
 *  "Thinking…" header verbatim and carries no testid in
 *  @copilotkit/react-core ≤ 1.57.1 — until that release ships a
 *  stable testid (mirroring the tool-rendering testid release path),
 *  the visible header text is the only stable hook we have for the
 *  built-in slot. */
export const REASONING_SELECTORS = [
  '[data-testid="reasoning-block"]',
  '[data-testid="reasoning-content"]',
  '[data-testid="reasoning-default"]',
  '[data-message-role="reasoning"]',
  "text=Thought for",
  "text=Thinking…",
] as const;

async function hasReasoningMessage(page: Page): Promise<boolean> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
        body: { textContent: string | null };
      };
    };
    const sels = [
      '[data-testid="reasoning-block"]',
      '[data-testid="reasoning-content"]',
      '[data-testid="reasoning-default"]',
      '[data-message-role="reasoning"]',
    ];
    if (sels.some((s) => win.document.querySelector(s) !== null)) return true;
    // Fallback: built-in CopilotChatReasoningMessage's verbatim header
    // text. Both spellings are emitted by the published component
    // depending on whether reasoning is in-flight ("Thinking…") or
    // finalised ("Thought for N seconds").
    const body = (win.document.body.textContent ?? "").toLowerCase();
    return body.includes("thought for") || body.includes("thinking…");
  })) as boolean;
}

export function buildReasoningAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeout = opts?.timeoutMs ?? REASONING_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await hasReasoningMessage(page)) return;
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    throw new Error(
      `reasoning-display: no reasoning-role message rendered within ${timeout}ms — expected one of ${REASONING_SELECTORS.join(", ")}`,
    );
  };
}

export function buildTurns(ctx: D5BuildContext): ConversationTurn[] {
  return buildToolsAgentTurns(
    ctx.featureType === "reasoning-default"
      ? "reasoning-default"
      : "reasoning-custom",
  );
}

/** Route each probe identity to the surface it reports. */
export function preNavigateRoute(ft: D5FeatureType): string {
  if (ft === "reasoning-default") return "/demos/reasoning-default";
  if (ft === "reasoning-custom") return "/demos/reasoning-custom";
  throw new Error(`reasoning-display: unsupported feature type ${ft}`);
}

registerD5Script({
  featureTypes: ["reasoning-custom", "reasoning-default"],
  fixtureFile: "reasoning-display.json",
  buildTurns,
  preNavigateRoute,
});
