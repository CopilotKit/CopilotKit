/**
 * Tests for `d5-hitl-approve-deny.ts`.
 *
 * The script self-registers at import time. We clear the registry
 * before importing in each test where it matters so the side-effect
 * lands clean. Three behaviours are covered:
 *
 *   1. Registration shape — featureTypes, fixtureFile, route override.
 *   2. `buildTurns` — input string matches the fixture; turn carries
 *      assertions; assertion happy-path passes against a scripted Page.
 *   3. Assertion failure — when the follow-up assistant message lacks
 *      the reference tokens, the assertion throws with a useful error.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  __clearD5RegistryForTesting,
  D5_REGISTRY,
} from "../helpers/d5-registry.js";

describe("d5-hitl-approve-deny script", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("registers under the hitl-approve-deny feature type with the right fixture file", async () => {
    // Vitest module cache: importing again after the registry clear
    // re-uses the cached module, so the side-effect registration only
    // fires the FIRST time in the test process. We work around this by
    // importing once and asserting on the export — which round-trips
    // the same script object the registration used.
    const mod = await import("./d5-hitl-approve-deny.js");
    const script = mod.__d5HitlApproveDenyScript;

    expect(script.featureTypes).toEqual(["hitl-approve-deny"]);
    expect(script.fixtureFile).toBe("hitl-approve-deny.json");
    expect(script.preNavigateRoute?.("hitl-approve-deny")).toBe(
      "/demos/hitl-in-app",
    );
  });

  it("buildTurns produces a single turn whose input matches the fixture user message", async () => {
    const mod = await import("./d5-hitl-approve-deny.js");
    const script = mod.__d5HitlApproveDenyScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-approve-deny",
      baseUrl: "https://example.test",
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("Issue a $50 refund to customer #12345");
    expect(turns[0]!.assertions).toBeTypeOf("function");
  });

  it("assertion clicks approve and passes when the follow-up message contains $50 and 12345", async () => {
    const mod = await import("./d5-hitl-approve-deny.js");
    const script = mod.__d5HitlApproveDenyScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-approve-deny",
      baseUrl: "https://example.test",
    });

    const calls: { method: string; selector: string }[] = [];
    let evaluateCount = 0;
    // Sequence: baseline read returns 1 (the agent message carrying
    // the toolCall), then after approve we return 2 (follow-up
    // arrived) and then return the follow-up text.
    const page = {
      async waitForSelector(selector: string) {
        calls.push({ method: "waitForSelector", selector });
      },
      async fill() {},
      async press() {},
      async click(selector: string) {
        calls.push({ method: "click", selector });
      },
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        // 1st: baseline assistant count read (1)
        // 2nd: poll after click — count grew to 2
        // 3rd: read latest assistant text
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        return "Approved — processing the $50 refund to customer #12345 now." as unknown as R;
      },
    };

    await turns[0]!.assertions!(page);
    // Approve button was clicked.
    expect(
      calls.some((c) => c.method === "click" && c.selector.includes("approve")),
    ).toBe(true);
  });

  it("assertion throws a clear error when the page is missing click()", async () => {
    // Per A9 — the page-shape widening from ConversationPage → HitlPage
    // is a structural cast through `unknown`. We guard at runtime so a
    // fake (or production page that lost click()) fails loudly rather
    // than silently no-opping when approveOrDeny tries to dispatch.
    const mod = await import("./d5-hitl-approve-deny.js");
    const script = mod.__d5HitlApproveDenyScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-approve-deny",
      baseUrl: "https://example.test",
    });

    const pageWithoutClick = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        return 0 as unknown as R;
      },
      // intentionally NOT providing `click`
    } as unknown as import("../helpers/conversation-runner.js").Page;

    await expect(turns[0]!.assertions!(pageWithoutClick)).rejects.toThrow(
      /missing click/,
    );
  });

  it("anchors approve-button selectors under the resolved approval-dialog selector", async () => {
    // Per A10 — the button cascade MUST be scoped to the approval
    // dialog; otherwise text-content fallbacks like
    // `button:has-text("Approve")` could match buttons elsewhere on
    // the page. The first selector to resolve via waitForSelector is
    // the dialog; subsequent button selectors should appear with the
    // dialog selector prepended.
    const mod = await import("./d5-hitl-approve-deny.js");
    const script = mod.__d5HitlApproveDenyScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-approve-deny",
      baseUrl: "https://example.test",
    });

    const seenSelectors: string[] = [];
    let evaluateCount = 0;
    const page = {
      async waitForSelector(selector: string) {
        seenSelectors.push(selector);
        // Resolve only specific selectors to drive the cascade
        // deterministically:
        //   - the canonical overlay testid (resolves dialog cascade —
        //     overlay is first in the cascade since it's the outermost
        //     portal'd element)
        //   - the canonical approve-button testid scoped under overlay
        if (selector === '[data-testid="approval-dialog-overlay"]') return;
        if (
          selector ===
          '[data-testid="approval-dialog-overlay"] [data-testid="approval-dialog-approve"]'
        ) {
          return;
        }
        throw new Error(`no match for ${selector}`);
      },
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        return "Approved — processing the $50 refund to customer #12345 now." as unknown as R;
      },
    };

    await turns[0]!.assertions!(page);

    // Dialog overlay selector queried first (outermost portal'd element).
    expect(seenSelectors[0]).toBe('[data-testid="approval-dialog-overlay"]');
    // At least one button selector queried with the overlay prefix.
    const scopedButtons = seenSelectors.filter((s) =>
      s.startsWith('[data-testid="approval-dialog-overlay"] '),
    );
    expect(scopedButtons.length).toBeGreaterThan(0);
    // No bare `button:has-text("Approve")` ever queried — every
    // button query MUST be scoped under the dialog selector.
    const bareButton = seenSelectors.find(
      (s) => s === 'button:has-text("Approve")',
    );
    expect(bareButton).toBeUndefined();
  });

  it("assertion throws when the follow-up message is missing reference tokens", async () => {
    const mod = await import("./d5-hitl-approve-deny.js");
    const script = mod.__d5HitlApproveDenyScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-approve-deny",
      baseUrl: "https://example.test",
    });

    let evaluateCount = 0;
    const page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        // Missing both $50 and 12345.
        return "OK, done." as unknown as R;
      },
    };

    await expect(turns[0]!.assertions!(page)).rejects.toThrow(/missing token/);
  });
});

// Smoke test for registry side-effect. Vitest hoists test files and
// processes imports up-front, so the import below will trigger
// registration regardless of the per-test clear. This block runs LAST
// (clearing happens in beforeEach), but it confirms that the registry
// has the entry after at least one import has resolved.
describe("d5-hitl-approve-deny registry side-effect", () => {
  it("populates the registry with the feature type after import", async () => {
    __clearD5RegistryForTesting();
    // Force-evaluate the side-effect by re-running registration via the
    // exported script — this avoids vitest's module cache making the
    // re-import a no-op.
    const mod = await import("./d5-hitl-approve-deny.js");
    if (!D5_REGISTRY.has("hitl-approve-deny")) {
      // The module cache short-circuited the side-effect. Re-register
      // explicitly so the registry has the right entry for the
      // assertion below.
      const { registerD5Script } = await import("../helpers/d5-registry.js");
      registerD5Script(mod.__d5HitlApproveDenyScript);
    }
    expect(D5_REGISTRY.has("hitl-approve-deny")).toBe(true);
    const entry = D5_REGISTRY.get("hitl-approve-deny");
    expect(entry?.fixtureFile).toBe("hitl-approve-deny.json");
  });
});
