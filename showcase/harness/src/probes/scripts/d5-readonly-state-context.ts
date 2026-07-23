/**
 * D5 — readonly-state-context script.
 *
 * Drives `/demos/readonly-state-agent-context`. The frontend
 * publishes user identity (name, timezone, recent activity) to the
 * agent runtime via `useAgentContext`; the agent uses that context
 * to answer prompts.
 *
 * Genuine assertion: mutate the user-name input
 * (`[data-testid="ctx-name"]`) to a sentinel string before sending
 * the pill prompt; install a `page.route()` interceptor that
 * captures any outgoing POST to the runtime endpoint
 * (`/api/copilotkit*`); after settle, assert the captured request
 * body contains the sentinel string. This proves the context value
 * was forwarded into the agent's runtime payload — a regression
 * where `useAgentContext` no longer plumbs the value would still
 * mention "context" in the transcript (the keyword-match assertion
 * stayed green) but would not contain the sentinel in the request
 * body.
 *
 * Real Playwright Page exposes `route(...)`. The runner's
 * structural Page type does not, so we runtime-cast and verify.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  FIRST_SIGNAL_TIMEOUT_MS,
  SIBLING_TIMEOUT_MS,
  asGenuinePage,
} from "./_genuine-shared.js";

/** Default `/demos/<featureType>` would be `/demos/readonly-state-context`,
 *  which does not exist — the actual route uses the registry-id
 *  `readonly-state-agent-context`. */
export function preNavigateRoute(_ft: D5FeatureType): string {
  return "/demos/readonly-state-agent-context";
}

/** Sentinel inserted into the user-name field. Distinctive enough not
 *  to collide with any default value or normal user input. */
export const CONTEXT_NAME_SENTINEL = "CTX-PROBE-7g3kqz";

/** Pill prompt MUST mirror `readonly-state-agent-context/suggestions.ts`. */
export const READONLY_PILL_PROMPT =
  "What do you know about me from my context?";

/** Install a `page.route()` interceptor that records any matching
 *  request body. Returns a getter for the most recent capture and an
 *  unhook function to restore default routing. */
async function installRequestCapture(
  page: Page,
  pillTag: string,
): Promise<{
  getLastBody: () => string | null;
  unhook: () => Promise<void>;
}> {
  type PageWithRoute = {
    route(
      url: string | RegExp,
      handler: (
        route: { continue(): Promise<void> },
        request: { url(): string; method(): string; postData(): string | null },
      ) => void | Promise<void>,
    ): Promise<void>;
    unroute?(url: string | RegExp): Promise<void>;
  };
  const candidate = page as unknown as PageWithRoute;
  if (typeof (candidate as { route?: unknown }).route !== "function") {
    throw new Error(
      `${pillTag}: page is missing route() — runner did not provide a Playwright-shaped page`,
    );
  }
  let lastBody: string | null = null;
  const pattern = /\/api\/copilotkit/;
  await candidate.route(pattern, (route, request) => {
    if (request.method() === "POST") {
      const body = request.postData();
      if (body) lastBody = body;
    }
    void route.continue();
  });
  return {
    getLastBody: () => lastBody,
    unhook: async () => {
      if (typeof candidate.unroute === "function") {
        try {
          await candidate.unroute(pattern);
        } catch {
          /* best-effort */
        }
      }
    },
  };
}

/** Set the context-name input to the sentinel. Mirrors the form-fill
 *  pattern used elsewhere in the harness. */
async function seedContextName(
  page: Page,
  pillTag: string,
  value: string,
): Promise<void> {
  const inputSelector = '[data-testid="ctx-name"]';
  try {
    await page.waitForSelector(inputSelector, {
      state: "visible",
      timeout: SIBLING_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `${pillTag}: [data-testid="ctx-name"] input did not become visible within ${SIBLING_TIMEOUT_MS}ms`,
    );
  }
  await page.fill(inputSelector, value, { timeout: SIBLING_TIMEOUT_MS });
}

export function buildContextAssertion(
  pillTag: string,
  capture: { getLastBody: () => string | null },
  sentinel: string,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
    let lastBody: string | null = null;
    while (Date.now() < deadline) {
      lastBody = capture.getLastBody();
      if (lastBody && lastBody.includes(sentinel)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    void page;
    throw new Error(
      `readonly-state-context-${pillTag}: outgoing /api/copilotkit request body did not contain sentinel "${sentinel}" — captured body: ${
        lastBody ? `"${lastBody.slice(0, 200)}"` : "(none)"
      }`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  // Capture state is closed over the closure so preFill (which sets it
  // up) and assertions (which read it) share the same instance.
  const captureRef: {
    handle: { getLastBody: () => string | null; unhook: () => Promise<void> };
  } = {
    handle: { getLastBody: () => null, unhook: async () => {} },
  };
  return [
    {
      input: READONLY_PILL_PROMPT,
      preFill: async (page: Page) => {
        const tag = "readonly-state-context";
        // 1) Validate the page is Playwright-shaped (route + click).
        asGenuinePage(page, tag);
        // 2) Install network interceptor BEFORE seeding the input —
        //    fills don't issue copilotkit requests, but the React
        //    re-render triggered by changing the user-name COULD
        //    trigger a context-relay request in some demos. Hooking
        //    early ensures we capture every matching request.
        captureRef.handle = await installRequestCapture(page, tag);
        // 3) Seed the context name with a sentinel so we can assert
        //    its presence in the outgoing request body.
        await seedContextName(page, tag, CONTEXT_NAME_SENTINEL);
      },
      assertions: async (page: Page) => {
        const fn = buildContextAssertion(
          "readonly-state-context",
          captureRef.handle,
          CONTEXT_NAME_SENTINEL,
        );
        try {
          await fn(page);
        } finally {
          await captureRef.handle.unhook();
        }
      },
      responseTimeoutMs: 60_000,
    },
  ];
}

registerD5Script({
  featureTypes: ["readonly-state-context"],
  fixtureFile: "readonly-state-context.json",
  buildTurns,
  preNavigateRoute,
});
