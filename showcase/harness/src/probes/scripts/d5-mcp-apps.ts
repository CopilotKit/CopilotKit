import { buildToolsAgentTurns } from "./_pill-contracts-tools-agents.js";
/**
 * Functional acceptance uses the shared canonical LGP pill contract below.
 * Exported legacy assertion helpers remain for supplemental regression tests;
 * buildTurns never uses their weaker diagnostic-only acceptance criteria.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/**
 * Iframe selector cascade. The first match wins. We probe both within
 * a single `page.evaluate` round-trip so the wait semantics stay
 * symmetric across selectors (no per-selector `waitForSelector` budget
 * burn).
 */
export const MCP_APP_IFRAME_SELECTORS = [
  '[data-testid="mcp-app-iframe"]',
  "iframe[sandbox]",
] as const;

/**
 * The cascade as ONE CSS any-of selector, for `completeOnMount.selectors`.
 * `querySelectorAll` unions comma-separated branches, so this counts "an MCP
 * app surface in any conforming form" as a single conjunctive surface entry.
 */
export const MCP_APP_IFRAME_SELECTOR_CASCADE =
  MCP_APP_IFRAME_SELECTORS.join(", ");

/** Total time we'll poll for the iframe to mount, in ms. The page may
 *  hydrate the iframe asynchronously after first paint, so the wait
 *  budget covers post-hydration mounts under slow network. */
const IFRAME_POLL_TIMEOUT_MS = 15_000;
const IFRAME_POLL_INTERVAL_MS = 250;

/**
 * Probe the page for an MCP-app iframe. Returns the matching selector
 * or `null` when the cascade matches nothing.
 *
 * The cascade is hard-coded inside the `page.evaluate` body because the
 * `Page.evaluate` type is `() => R` (no closure capture across the
 * Playwright serialisation boundary). The hard-coded list MUST stay in
 * sync with `MCP_APP_IFRAME_SELECTORS`.
 */
export async function probeIframeSelector(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
      };
    };
    const selectors = ['[data-testid="mcp-app-iframe"]', "iframe[sandbox]"];
    for (const sel of selectors) {
      if (win.document.querySelector(sel)) return sel;
    }
    return null;
  });
}

/**
 * Per-turn assertion: poll for the iframe up to `timeoutMs`. Throws on
 * deadline with a message that distinguishes "no iframe at all" from
 * "page never settled" — the operator triaging a red row needs to know
 * whether the demo regressed (no iframe rendered) or the page failed
 * to load (different remediation).
 */
export async function assertIframePresent(
  page: Page,
  timeoutMs: number = IFRAME_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSelector: string | null = null;
  while (Date.now() < deadline) {
    lastSelector = await probeIframeSelector(page);
    if (lastSelector !== null) {
      console.debug("[d5-mcp-apps] iframe present", { selector: lastSelector });
      return;
    }
    await new Promise<void>((r) => setTimeout(r, IFRAME_POLL_INTERVAL_MS));
  }
  throw new Error(
    `mcp-apps: expected iframe but selector cascade matched 0 elements after ${timeoutMs}ms ` +
      `(tried ${MCP_APP_IFRAME_SELECTORS.join(", ")})`,
  );
}

/**
 * Build the per-(integration, featureType) conversation.
 *
 * The MCP-apps demo only mounts an iframe AFTER the agent calls a real
 * MCP tool that returns a UI resource — `MCPAppsActivityRenderer`
 * subscribes to a runtime activity event, fetches the resource, and
 * dynamically appends a sandboxed iframe with
 * `sandbox="allow-scripts allow-same-origin allow-forms"`. So the
 * input MUST be a prompt that drives a real MCP tool call against the
 * configured server (e.g. the public Excalidraw MCP at
 * https://mcp.excalidraw.com).
 *
 * We send the verbatim pill prompt from
 * `langgraph-python/src/app/demos/mcp-apps/suggestions.ts` so the
 * probe matches what a user clicking the suggestion pill would
 * experience.
 *
 * TODO(F4): `showcase/aimock/d5-all.json` currently keys
 * `"Use Excalidraw to sketch"` to a CONTENT-ONLY response (no MCP tool
 * call), and a generic catch-all may absorb the verbatim pill string
 * before it reaches the MCP path. Without a fixture entry that emits
 * an actual MCP tool call AND a runtime configured to talk to a real
 * MCP server, the iframe assertion can only pass on integration runs
 * with a live agent + reachable MCP endpoint. F4 owns the fixture
 * file; this probe is correct in the live-agent topology and is a
 * known false-negative under aimock until the fixture lands.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return buildToolsAgentTurns("mcp-apps");
}

registerD5Script({
  featureTypes: ["mcp-apps"],
  fixtureFile: "mcp-apps.json",
  buildTurns,
});
