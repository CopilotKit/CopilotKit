/**
 * D5 — `mcp-apps` script.
 *
 * Phase-2A split (see `.claude/specs/lgp-test-genuine-pass.md`): the old
 * `d5-mcp-subagents.ts` probe claimed BOTH `mcp-apps` and `subagents`
 * feature types but routed them to the same `/demos/subagents` page,
 * leaving `mcp-apps` wrong-targeted. This probe is now scoped to the
 * `/demos/mcp-apps` page, which is an iframe-shell demo (the MCP app
 * runs inside a sandboxed iframe loaded from a remote URL).
 *
 * The D5 signal here is "the sandbox proxy runs and embeds its fetched
 * resource and completes its MCP initialization handshake". An outer iframe
 * or populated `srcdoc` alone is insufficient because CSP can block the app's
 * scripts while leaving both frames in the DOM.
 *
 * Selector cascade (most-specific first):
 *   1. `[data-testid="mcp-app-iframe"]`  — canonical testid (Phase 1
 *                                          adds this; until then the
 *                                          fallback covers it).
 *   2. `iframe[sandbox]`                 — sandbox attribute is required
 *                                          by the MCP-apps spec, so any
 *                                          conforming page renders one.
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `d6-all-pills.ts` discovers it via the `d5-*` filename
 * convention.
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

/** Total time we'll poll for the iframe to mount, in ms. The page may
 *  hydrate the iframe asynchronously after first paint, so the wait
 *  budget covers post-hydration mounts under slow network. */
const IFRAME_POLL_TIMEOUT_MS = 15_000;
const IFRAME_POLL_INTERVAL_MS = 250;

/**
 * Probe the page for an initialized MCP-app iframe. The Angular renderer sets
 * `data-mcp-app-initialized="true"` only after the embedded app executes and
 * sends `ui/initialize`; this remains observable when the dedicated proxy is
 * intentionally opaque and its nested document cannot be inspected.
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
        querySelector(sel: string): {
          getAttribute(name: string): string | null;
        } | null;
      };
    };
    const selectors = ['[data-testid="mcp-app-iframe"]', "iframe[sandbox]"];
    for (const sel of selectors) {
      const frame = win.document.querySelector(sel);
      if (frame?.getAttribute("data-mcp-app-initialized") === "true") {
        return sel;
      }
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
    `mcp-apps: expected iframe with a fully initialized embedded UI but no app completed ui/initialize after ${timeoutMs}ms ` +
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
  return [
    {
      input:
        "Open Excalidraw and sketch a system diagram with a client, server, and database.",
      // Wrapped so the assertions callback ignores the Phase-4 `ctx`
      // argument: `assertIframePresent` takes `(page, timeoutMs?)`, not
      // `(page, ctx)`, and ctx is irrelevant to the iframe-mount probe.
      assertions: async (page) => {
        await assertIframePresent(page);
      },
    },
  ];
}

registerD5Script({
  featureTypes: ["mcp-apps"],
  fixtureFile: "mcp-apps.json",
  buildTurns,
});
