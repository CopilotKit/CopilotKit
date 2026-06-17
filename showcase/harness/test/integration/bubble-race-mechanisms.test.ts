import { describe, it, expect, afterAll } from "vitest";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { countAssistantMessages } from "../../src/probes/helpers/assistant-message-count.js";
import { installPrePaintFromEnv } from "../../src/probes/helpers/init-scripts.js";
import { runBubbleRaceRepro } from "./bubble-race-repro.js";

/**
 * Snapshot env keys, apply overrides, run `fn`, then restore the original
 * values in a try/finally — even if `fn` throws. Snapshots are taken at
 * call time (NOT at module load), so concurrent/serial sibling tests
 * cannot poison the captured "original" via vitest singleFork reuse.
 *
 * `undefined` in the overrides map deletes the key for the duration of
 * `fn` and restores whatever was there before (which may itself be
 * `undefined`, in which case the restore is a `delete`).
 */
async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const keys = Object.keys(overrides);
  const snapshot: Record<string, string | undefined> = {};
  for (const k of keys) {
    snapshot[k] = process.env[k];
  }
  for (const k of keys) {
    const v = overrides[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      const v = snapshot[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

/**
 * Mechanism-GREEN retrofit for s1/s4/s5.
 *
 * s1 landed the conversation driver + production diagnostic log
 * `[conversation-runner] turn N/total — settled text { turnNum, text }`
 * that the test harness parses out of subprocess stdout.
 *
 * s4 landed `installPrePaintFromEnv` — the Playwright `addInitScript`
 * hook that injects `BUBBLE_RACE_PRE_PAINT` HTML at document_start so
 * the runner's first cascade count poll sees a non-zero count. The
 * boot-time baselineCount read this once supported was deleted in the
 * `waitForTurnComplete` cutover; this test verifies the injection
 * mechanism itself via direct DOM observation.
 *
 * s5 (carried forward via s6 in this worktree) landed the shared
 * `countAssistantMessages` cascade helper — the single source of truth
 * for the d5/d6 driver, conversation runner, and diagnostics paths.
 *
 * These three mechanisms previously had no slot-owned mechanism-GREEN
 * tests — downstream slots verified them indirectly. This file pins
 * each one explicitly so future regressions surface at the mechanism
 * boundary, not three layers downstream.
 */

describe("bubble-race mechanism — s1 driver production diagnostic log", () => {
  it("emits parseable turn-settled lines and the driver parses them", async () => {
    const result = await runBubbleRaceRepro({
      slug: "langgraph-python:agentic-chat",
      level: "d5",
      messages: ["good name for a goldfish"],
    });
    // The production log line the driver depends on:
    //   [conversation-runner] turn N/total — settled text { turnNum: …, text: '…' }
    // util.inspect renders the structured 2nd-arg with single-quoted
    // string fields, so the regex looks for a `text: '…'` member with
    // standard escape semantics.
    const productionLineRe =
      /\[conversation-runner\] turn (\d+)\/\d+ — settled text \{[^}]*text:\s*'(?:[^'\\]|\\.)*'/;
    expect(result.stdout).toMatch(productionLineRe);
    // And the driver actually parsed at least one turn out of stdout.
    expect(result.turns.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});

describe("bubble-race mechanism — s4 installPrePaintFromEnv", () => {
  // Direct DOM observation: spawn a fresh chromium Page, set
  // BUBBLE_RACE_PRE_PAINT, install the hook via the SAME helper the d6
  // driver uses, navigate to a blank data: URL, and assert the injected
  // placeholder is in the DOM by the time `load` fires.
  //
  // Why direct-observation rather than the full subprocess repro: the
  // prior version of this test relied on a `[conversation-runner] initial
  // baseline assistant message count (boot) { baselineCount: N }` log
  // line emitted by the runner. That log line was deleted alongside the
  // pre-turn baseline-count read in the `waitForTurnComplete` cutover
  // (1-based turn ordinals replaced the pre-turn count), so there is no
  // longer a runner-emitted signal to grep for. Observing the DOM the
  // mechanism actually mutates pins the wiring at its own boundary —
  // independent of how downstream consumers happen to log today.
  let browser: Browser | undefined;

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it("injects a role=article placeholder visible in the DOM after load", async () => {
    // role="article" intentionally matches tier 3 of the cascade
    // (`[role="article"]:not([data-message-role="user"])`), so the
    // shared `countAssistantMessages` helper sees it — proving the
    // addInitScript wiring fired before `load`. data-bubble-race-marker
    // is a stable hook that isolates the injected node from any other
    // role="article" content the navigated page might carry.
    //
    // Env-var lifecycle is owned by `withEnv` — snapshot at call time,
    // restore in try/finally — so vitest singleFork cannot leak the
    // override into sibling tests that run before/after this one.
    await withEnv(
      {
        BUBBLE_RACE_PRE_PAINT:
          '<div role="article" data-bubble-race-marker>placeholder</div>',
      },
      async () => {
        browser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        });
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
          // Install the hook BEFORE navigation — addInitScript only fires
          // for subsequent navigations, matching how d6-all-pills.ts wires
          // it (`installPrePaintFromEnv(page)` before `page.goto`).
          await installPrePaintFromEnv(page);

          // Navigate to a blank data: URL. The page itself has no
          // assistant-message DOM, so any non-zero count comes from the
          // injected placeholder alone.
          const dataUrl =
            "data:text/html;charset=utf-8," +
            encodeURIComponent("<!doctype html><html><body></body></html>");
          await page.goto(dataUrl);

          // Marker node is in the DOM.
          const markerCount = await page
            .locator("[data-bubble-race-marker]")
            .count();
          expect(markerCount).toBe(1);

          // And the shared cascade helper sees it via tier 3 — this is
          // the exact path the runner's first count poll uses.
          const cascadeCount = await countAssistantMessages(page);
          expect(cascadeCount).toBeGreaterThan(0);
        } finally {
          await ctx.close();
        }
      },
    );
  }, 30_000);

  it("re-injects the placeholder on same-context navigation (each navigation gets a fresh realm)", async () => {
    // Pins the navigation re-entry contract for the pre-paint init
    // script. `addInitScript` re-runs at document_start of EVERY
    // navigation in the context; each navigation is a fresh JS realm
    // with a fresh `globalThis`, so the script's outer
    // `__bubble_race_prepaint_installed` guard is `undefined` on entry
    // and the placeholder is re-injected. A regression where state is
    // aliased across navigations (e.g. via a context-level singleton)
    // would leave the second page without the placeholder and fail
    // this test.
    await withEnv(
      {
        BUBBLE_RACE_PRE_PAINT:
          '<div role="article" data-bubble-race-marker>placeholder</div>',
      },
      async () => {
        if (!browser) {
          browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-dev-shm-usage"],
          });
        }
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        try {
          await installPrePaintFromEnv(page);

          // Same-context navigation #1 — to a blank data: URL.
          const dataUrlA =
            "data:text/html;charset=utf-8," +
            encodeURIComponent(
              "<!doctype html><html><body><p>page-a</p></body></html>",
            );
          await page.goto(dataUrlA);
          expect(await page.locator("[data-bubble-race-marker]").count()).toBe(
            1,
          );

          // Same-context navigation #2 — to a DIFFERENT blank data: URL
          // on the SAME page in the SAME context. If the navigation
          // re-entry contract holds, addInitScript fires again, the
          // outer guard is `undefined` in the fresh realm, and the
          // placeholder reappears in the new document. If state leaks
          // across navigations, the count is 0 and this fails.
          const dataUrlB =
            "data:text/html;charset=utf-8," +
            encodeURIComponent(
              "<!doctype html><html><body><p>page-b</p></body></html>",
            );
          await page.goto(dataUrlB);
          expect(await page.locator("[data-bubble-race-marker]").count()).toBe(
            1,
          );

          // And the shared cascade helper still sees it via tier 3.
          const cascadeCount = await countAssistantMessages(page);
          expect(cascadeCount).toBeGreaterThan(0);
        } finally {
          await ctx.close();
        }
      },
    );
  }, 30_000);
});

describe("bubble-race mechanism — s5 countAssistantMessages cascade", () => {
  let browser: Browser | undefined;

  afterAll(async () => {
    if (browser) await browser.close();
  });

  /**
   * Spin up a real chromium Page against a `data:` URL containing the
   * desired tier-only DOM, then assert `countAssistantMessages(page)`
   * returns the expected count. This pins the cascade ordering at the
   * mechanism boundary — first-non-zero-tier wins.
   *
   * The pages are designed so ONLY the targeted tier has matches:
   * - Tier 1 page has data-testid nodes (no role/data-message-role).
   * - Tier 2 page has role="article" + data-message-role="assistant".
   * - Tier 3 page has role="article" only (no data-message-role).
   * - Tier 4 page has data-message-role="assistant" only (no role).
   */
  async function loadPage(html: string) {
    if (!browser) {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const dataUrl =
      "data:text/html;charset=utf-8," +
      encodeURIComponent(`<!doctype html><html><body>${html}</body></html>`);
    await page.goto(dataUrl);
    return { page, ctx };
  }

  it("tier 1 (data-testid=copilot-assistant-message) wins with count = 2", async () => {
    const tier1 = Array.from({ length: 2 })
      .map(() => '<div data-testid="copilot-assistant-message">x</div>')
      .join("");
    const { page, ctx } = await loadPage(tier1);
    try {
      const n = await countAssistantMessages(page);
      expect(n).toBe(2);
    } finally {
      await ctx.close();
    }
  }, 30_000);

  it("tier 2 (role=article + data-message-role=assistant) wins with count = 3", async () => {
    const tier2 = Array.from({ length: 3 })
      .map(() => '<div role="article" data-message-role="assistant">x</div>')
      .join("");
    const { page, ctx } = await loadPage(tier2);
    try {
      const n = await countAssistantMessages(page);
      expect(n).toBe(3);
    } finally {
      await ctx.close();
    }
  }, 30_000);

  it("tier 3 (role=article, no data-message-role) wins with count = 4", async () => {
    const tier3 = Array.from({ length: 4 })
      .map(() => '<div role="article">x</div>')
      .join("");
    const { page, ctx } = await loadPage(tier3);
    try {
      const n = await countAssistantMessages(page);
      expect(n).toBe(4);
    } finally {
      await ctx.close();
    }
  }, 30_000);

  it("tier 4 (data-message-role=assistant, no role) wins with count = 5", async () => {
    const tier4 = Array.from({ length: 5 })
      .map(() => '<div data-message-role="assistant">x</div>')
      .join("");
    const { page, ctx } = await loadPage(tier4);
    try {
      const n = await countAssistantMessages(page);
      expect(n).toBe(5);
    } finally {
      await ctx.close();
    }
  }, 30_000);
});
