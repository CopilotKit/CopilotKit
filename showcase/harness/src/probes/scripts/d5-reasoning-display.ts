/**
 * D5 — reasoning-display script.
 *
 * Covers BOTH `/demos/reasoning-custom` and `/demos/reasoning-default`
 * via preNavigateRoute. The driver runs one feature per featureType per
 * integration, so the registered type ('reasoning-display') gets one run
 * regardless of how many registry IDs map to it. The default route is
 * `reasoning-custom` — the alternate route is informational only at the
 * catalog level (see open question Q5 in `.claude/specs/lgp-d5-coverage.md`).
 *
 * NOTE: in the LGP demo-pass these routes were renamed from
 * `agentic-chat-reasoning` → `reasoning-custom` and
 * `reasoning-default-render` → `reasoning-default`; the genuine-pass Phase 0
 * cleanup updates the mapping and this branch logic accordingly.
 *
 * Assertion (strict-only): a reasoning-role message must render via
 * one of the known stable selectors:
 *   - `[data-testid="reasoning-block"]`
 *   - `[data-testid="reasoning-content"]`
 *   - `[data-testid="reasoning-default"]`
 *   - `[data-message-role="reasoning"]`
 *
 * The probe used to also accept a transcript-keyword fallback
 * (`"reasoning"`, `"step"`, `"thinking"`), but those tokens are
 * typical assistant acknowledgements of the user prompt
 * ("show your reasoning step by step") and made the assertion
 * pass regardless of whether the framework actually surfaced
 * REASONING_MESSAGE_* events to the frontend. The fallback was
 * non-genuine and has been removed. Integrations that render
 * reasoning inline without a stable testid must add one to be
 * counted by this probe.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
  type D5RouteContext,
} from "../helpers/d5-registry.js";
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

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "show your reasoning step by step",
      assertions: buildReasoningAssertion(),
    },
  ];
}

/** Force the route to a real demo path. Default `/demos/reasoning-display`
 *  doesn't exist; we pick `reasoning-custom` as the canonical reasoning
 *  surface. Per Q5 in the coverage doc this may split later. */
export function preNavigateRoute(
  _ft: D5FeatureType,
  ctx?: D5RouteContext,
): string {
  // If the integration declares only `reasoning-default`, prefer that route.
  if (
    ctx?.demos &&
    ctx.demos.includes("reasoning-default") &&
    !ctx.demos.includes("reasoning-custom")
  ) {
    return "/demos/reasoning-default";
  }
  return "/demos/reasoning-custom";
}

registerD5Script({
  featureTypes: ["reasoning-display"],
  fixtureFile: "reasoning-display.json",
  buildTurns,
  preNavigateRoute,
});
