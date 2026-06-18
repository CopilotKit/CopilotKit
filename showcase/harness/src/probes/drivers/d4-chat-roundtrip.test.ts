import { describe, it, expect } from "vitest";
import {
  e2eChatToolsDriver,
  createE2eSmokeDriver,
  createPooledE2eSmokeLauncher,
} from "./d4-chat-roundtrip.js";
import type {
  E2eBrowser,
  E2eBrowserContext,
  E2ePage,
  E2eSmokeLevelSignal,
  E2eSmokePackageSignal,
  E2eSmokeSignal,
} from "./d4-chat-roundtrip.js";
import type { BrowserPool } from "../helpers/browser-pool.js";
import type { Browser } from "playwright";
import { logger } from "../../logger.js";
import type { ProbeContext, ProbeResult } from "../../types/index.js";

// Driver-level tests for the Playwright-in-process e2e-smoke driver. The
// real chromium launch path is never exercised here — tests inject a
// `FakeBrowser` through the `launcher` dep so every code path is
// reproducible without a running browser. Integration against a live
// Railway service is covered by showcase/tests/e2e/integration-smoke.spec.ts.

// --- Fakes ---------------------------------------------------------------

/**
 * Scripted fake page: each selector-keyed method pulls from an optional
 * `scripts` map so individual tests can force a specific L3/L4 outcome
 * (empty response, weather hit, weather miss, navigation throw, etc.).
 */
interface PageScript {
  bodyText?: string;
  assistantText?: string;
  throwOnGoto?: Error;
  throwOnType?: Error;
  throwOnWaitForSelector?: Error;
  throwOnAssistantSelector?: Error;
  typedMessage?: { value: string };
}

function makePage(script: PageScript = {}): E2ePage {
  return {
    async goto() {
      if (script.throwOnGoto) throw script.throwOnGoto;
    },
    async type(_sel, text) {
      if (script.throwOnType) throw script.throwOnType;
      if (script.typedMessage) script.typedMessage.value = text;
    },
    async press() {
      // No-op — the fake assertions don't need to model a real keypress.
    },
    async waitForSelector(sel) {
      if (sel === "textarea") {
        if (script.throwOnWaitForSelector) throw script.throwOnWaitForSelector;
        return;
      }
      if (sel === '[data-testid="copilot-assistant-message"]') {
        if (script.throwOnAssistantSelector)
          throw script.throwOnAssistantSelector;
        return;
      }
    },
    async textContent(sel) {
      // The driver reads the assistant message via `evaluate()` (see below),
      // NOT `textContent(:last-of-type)`, so only the `body` read remains.
      if (sel === "body") {
        return script.bodyText ?? "";
      }
      return "";
    },
    async evaluate<R>(fn: () => R): Promise<R> {
      // The driver's evaluate() reads the last assistant message's
      // textContent via querySelectorAll and returns a string. The fake
      // returns the scripted assistantText as that string.
      return (script.assistantText ?? "") as unknown as R;
    },
    async close() {
      /* no-op */
    },
  };
}

interface FakeBrowserState {
  closed: boolean;
  contextsOpened: number;
  contextsClosed: number;
}

function makeBrowser(
  pageScripts: PageScript[],
  state: FakeBrowserState = {
    closed: false,
    contextsOpened: 0,
    contextsClosed: 0,
  },
): { browser: E2eBrowser; state: FakeBrowserState } {
  let pageIdx = 0;
  const browser: E2eBrowser = {
    async newContext(): Promise<E2eBrowserContext> {
      state.contextsOpened++;
      return {
        async newPage(): Promise<E2ePage> {
          return makePage(pageScripts[pageIdx++] ?? {});
        },
        async close() {
          state.contextsClosed++;
        },
      };
    },
    async close() {
      state.closed = true;
    },
  };
  return { browser, state };
}

function baseCtx(extra: Partial<ProbeContext> = {}): ProbeContext {
  return {
    now: () => new Date("2026-04-21T00:00:00Z"),
    logger,
    env: {},
    ...extra,
  };
}

class CapturingWriter {
  results: ProbeResult<unknown>[] = [];
  async write(r: ProbeResult<unknown>): Promise<unknown> {
    this.results.push(r);
    return { previousState: null, newState: r.state, transition: "first" };
  }
}

// --- Schema --------------------------------------------------------------

describe("e2eChatToolsDriver.inputSchema", () => {
  it("accepts { key, backendUrl, demos }", () => {
    const parsed = e2eChatToolsDriver.inputSchema.safeParse({
      key: "e2e-smoke:foo",
      backendUrl: "https://example.com",
      demos: ["agentic-chat", "tool-rendering"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts omitted demos (no L4)", () => {
    const parsed = e2eChatToolsDriver.inputSchema.safeParse({
      key: "e2e-smoke:foo",
      backendUrl: "https://example.com",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty key", () => {
    const parsed = e2eChatToolsDriver.inputSchema.safeParse({
      key: "",
      backendUrl: "https://example.com",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-URL backendUrl", () => {
    const parsed = e2eChatToolsDriver.inputSchema.safeParse({
      key: "e2e-smoke:foo",
      backendUrl: "not-a-url",
    });
    expect(parsed.success).toBe(false);
  });
});

// --- L3 behaviour --------------------------------------------------------

describe("e2eChatToolsDriver L3 (chat)", () => {
  it("green when chat returns any non-empty response", async () => {
    const { browser, state } = makeBrowser([{ assistantText: "Hi there!" }]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = new CapturingWriter();
    const ctx = baseCtx({ writer });

    const result = await driver.run(ctx, {
      key: "e2e-smoke:foo",
      backendUrl: "https://showcase-foo.example.com",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("green");
    expect(sig.l4).toBe("skipped");
    expect(sig.failureSummary).toBe("");
    // Side-emit: chat:<slug> should have been written.
    const chat = writer.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("green");
    // Browser must always be torn down.
    expect(state.closed).toBe(true);
  });

  it("red when chat yields an empty assistant response", async () => {
    const { browser } = makeBrowser([{ assistantText: "" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      // Short poll timeout so the test doesn't spin for 60s.
      textPollTimeoutMs: 50,
    });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    expect(result.state).toBe("red");
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("red");
    expect(sig.failureSummary).toMatch(/L3:/);
    const chat = writer.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("red");
  });

  it("polls for non-empty textContent when initial read is empty (streaming race)", async () => {
    // Simulates the race condition where CopilotKit renders the
    // assistant-message container before tokens stream in. The first
    // two evaluate() reads return "" (container visible but empty);
    // the third returns real text. The driver must poll and eventually
    // read the text rather than reporting "empty assistant response".
    let evaluateCalls = 0;
    const delayedPage: E2ePage = {
      async goto() {},
      async type() {},
      async press() {},
      async waitForSelector() {},
      async textContent() {
        return "";
      },
      async evaluate<R>(): Promise<R> {
        evaluateCalls++;
        // First two calls return empty (tokens not yet streamed).
        if (evaluateCalls <= 2) return "" as unknown as R;
        return "Hello! Nice to meet you." as unknown as R;
      },
      async close() {},
    };
    const delayedBrowser: E2eBrowser = {
      async newContext() {
        return {
          async newPage() {
            return delayedPage;
          },
          async close() {},
        };
      },
      async close() {},
    };
    const driver = createE2eSmokeDriver({
      launcher: async () => delayedBrowser,
      textPollTimeoutMs: 5000,
    });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    expect(result.state).toBe("green");
    const chat = writer.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("green");
    const chatSig = chat?.signal as E2eSmokeLevelSignal;
    expect(chatSig.responseText).toBe("Hello! Nice to meet you.");
    // Must have polled more than once.
    expect(evaluateCalls).toBeGreaterThan(1);
  });

  it("falls back to body scraping when the assistant selector never resolves", async () => {
    // Reference helper's fallback path: slice <body> after the sent
    // message, strip UI chrome, keep substantive text.
    const { browser } = makeBrowser([
      {
        throwOnAssistantSelector: new Error("selector timeout"),
        bodyText:
          "Hello, please respond with a brief greeting.\nAlright, here is a warm greeting for you from the assistant response.",
      },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    expect(result.state).toBe("green");
  });
});

// --- L4 behaviour --------------------------------------------------------

describe("e2eChatToolsDriver L4 (tools)", () => {
  it("skipped when demos does not include 'tool-rendering'", async () => {
    const { browser, state } = makeBrowser([
      { assistantText: "Hi" },
      // No second page — L4 should not open one.
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat"],
    });
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l4).toBe("skipped");
    // Exactly one context was opened (L3 only).
    expect(state.contextsOpened).toBe(1);
    // No tools:<slug> side-emit when skipped.
    expect(writer.results.find((r) => r.key === "tools:foo")).toBeUndefined();
  });

  it("green when L4 response contains weather vocabulary", async () => {
    const { browser, state } = makeBrowser([
      { assistantText: "Hello" },
      { assistantText: "The weather in San Francisco is sunny, 68 degrees." },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat", "tool-rendering"],
    });
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("green");
    expect(sig.l4).toBe("green");
    expect(result.state).toBe("green");
    expect(state.contextsOpened).toBe(2);
    expect(state.contextsClosed).toBe(2);
    const tools = writer.results.find((r) => r.key === "tools:foo");
    expect(tools?.state).toBe("green");
    const toolsSig = tools?.signal as E2eSmokeLevelSignal;
    expect(toolsSig.level).toBe("tools");
    expect(toolsSig.responseText).toMatch(/San Francisco/);
  });

  it("red when L4 response lacks weather vocabulary", async () => {
    const { browser } = makeBrowser([
      { assistantText: "Hi" },
      {
        assistantText:
          "I'm sorry, I cannot help with that request at this time.",
      },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["tool-rendering"],
    });
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l4).toBe("red");
    expect(sig.failureSummary).toMatch(/weather vocabulary/);
    expect(result.state).toBe("red");
    const tools = writer.results.find((r) => r.key === "tools:foo");
    expect(tools?.state).toBe("red");
  });

  it("red aggregate when L3 passes but L4 fails (both levels surfaced)", async () => {
    const { browser } = makeBrowser([
      { assistantText: "Hi" },
      { assistantText: "unrelated content with no matching vocabulary" },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["tool-rendering"],
    });
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("green");
    expect(sig.l4).toBe("red");
    expect(result.state).toBe("red");
    expect(sig.failureSummary).toMatch(/L4:/);
  });
});

// --- Launcher / error paths ---------------------------------------------

describe("e2eChatToolsDriver error paths", () => {
  it("red with launcher-error when chromium launch throws", async () => {
    const driver = createE2eSmokeDriver({
      launcher: async () => {
        throw new Error("cannot find chromium-headless-shell");
      },
    });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["tool-rendering"],
    });
    const sig = result.signal as E2eSmokePackageSignal;
    expect(result.state).toBe("red");
    expect(sig.shape).toBe("package");
    expect(sig.errorDesc).toBe("launcher-error");
    expect(sig.l3).toBe("red");
    expect(sig.l4).toBe("red");
    expect(sig.failureSummary).toMatch(/chromium-headless-shell/);
  });

  it("red with per-level error when page.goto throws", async () => {
    const { browser } = makeBrowser([
      { throwOnGoto: new Error("net::ERR_CONNECTION_REFUSED") },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    expect(result.state).toBe("red");
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.failureSummary).toMatch(/ERR_CONNECTION_REFUSED/);
  });

  it("red with timeout errorDesc when driver hard-timeout fires during launch", async () => {
    // Hanging launcher: resolves only when its AbortSignal fires (which
    // it will, from the driver's hard-timeout). Ensures the driver maps
    // the abort into `errorDesc: "timeout"` rather than masquerading as
    // `launcher-error` — the user-facing distinction matters: "chromium
    // missing" and "remote stack slow" need separate alert routing.
    let rejectLauncher: ((err: Error) => void) | undefined;
    const launcher = async (): Promise<E2eBrowser> =>
      await new Promise<E2eBrowser>((_res, rej) => {
        rejectLauncher = rej;
      });

    const driver = createE2eSmokeDriver({
      launcher,
      timeoutMs: 25,
    });
    const p = driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    // After driver timer fires at 25ms, reject the launcher so its await
    // unblocks. Delay slightly past the timer to guarantee ordering.
    setTimeout(() => rejectLauncher?.(new Error("launcher aborted")), 60);
    const result = await p;
    expect(result.state).toBe("red");
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.shape).toBe("package");
    expect(sig.errorDesc).toBe("timeout");
    expect(sig.failureSummary).toMatch(/timeout after/);
  });
});

// --- Side-emit / writer plumbing ----------------------------------------

describe("e2eChatToolsDriver side-emits", () => {
  it("survives writer failure on chat side-emit without swallowing L3 result", async () => {
    const { browser } = makeBrowser([
      { assistantText: "Hi" },
      { assistantText: "San Francisco is cloudy today." },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = {
      writes: 0,
      async write(r: ProbeResult<unknown>) {
        this.writes++;
        if (r.key === "chat:foo") throw new Error("pb down");
        return {};
      },
    };
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["tool-rendering"],
    });
    // Even though chat side-emit write failed, the primary aggregate
    // ProbeResult still comes back normally.
    expect(result.state).toBe("green");
    expect(writer.writes).toBe(2); // chat (failed) + tools (ok)
  });

  it("emits no side-writes when ctx.writer is undefined", async () => {
    const { browser } = makeBrowser([
      { assistantText: "Hi" },
      { assistantText: "It's raining in San Francisco." },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    // No writer; just verify run() completes cleanly.
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["tool-rendering"],
    });
    expect(result.state).toBe("green");
  });
});

// --- Package-shape slug + registry lookup ------------------------------
//
// A regression that breaks the slug (e.g. leaves `showcase-` on the front)
// would yield `hasToolRendering === false` silently and skip every L4
// row. These tests pin the end-to-end flow.

describe("e2eChatToolsDriver package shape: deriveSlug + demosResolver", () => {
  it("calls demosResolver with the stripped slug for a `showcase-<multi-seg>` name", async () => {
    const resolverCalls: string[] = [];
    const { browser } = makeBrowser([
      { assistantText: "Hi" },
      { assistantText: "San Francisco is sunny." },
    ]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      demosResolver: async (slug) => {
        resolverCalls.push(slug);
        return ["agentic-chat", "tool-rendering"];
      },
    });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:showcase-langgraph-python",
      name: "showcase-langgraph-python",
      backendUrl: "https://x.example.com",
      shape: "package",
    });
    // Regression guard: the slug passed to demosResolver must be the
    // registry-keyed form (`langgraph-python`), not `showcase-langgraph-
    // python`.
    expect(resolverCalls).toEqual(["langgraph-python"]);
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.l4).toBe("green");
  });

  it("package shape + throwing demosResolver → L4 skipped, driver continues with demos=[]", async () => {
    // Pins current swallow behavior: the orchestrator deferred changing
    // it; this test locks the existing contract so a future refactor
    // can't silently switch to surfacing the throw without an intentional
    // update here. L3 still runs; L4 is "skipped" because demos=[] ⇒ no
    // tool-rendering entry.
    const { browser } = makeBrowser([{ assistantText: "Hi" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      demosResolver: async () => {
        throw new Error("registry.json missing");
      },
    });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:showcase-langgraph-python",
      name: "showcase-langgraph-python",
      backendUrl: "https://x.example.com",
      shape: "package",
    });
    expect(result.state).toBe("green");
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.l3).toBe("green");
    expect(sig.l4).toBe("skipped");
  });
});

// --- Pooled launcher: context checkout + abort release -------------------
//
// Context-pool migration: createPooledE2eSmokeLauncher checks out a pooled
// CONTEXT per newContext() (pool.acquire) and releases it on close
// (pool.release). No Browser is held. The leak this guards: on a driver
// hard-timeout / external abort the invoker's Promise.race abandons the
// driver while it keeps running with pooled contexts held; without the
// abort listener those contexts stay inUse across probe ticks, saturating
// the pool. The abort closure closes each open context (each releasing its
// pooled context), returning inUse to 0.
describe("createPooledE2eSmokeLauncher context checkout + abort release", () => {
  it("checks out a pooled context per newContext() and moves inUse by 1", async () => {
    const pool = makeFakeContextPool(4);
    const launcher = createPooledE2eSmokeLauncher(
      pool as unknown as BrowserPool,
    );
    const browser = await launcher();
    expect(pool.stats().inUse).toBe(0);
    const ctx = await browser.newContext();
    expect(pool.stats().inUse).toBe(1);
    await ctx.close();
    expect(pool.stats().inUse).toBe(0);
    expect(pool._releaseLog).toHaveLength(1);
  });

  it("forwards newContext(opts).extraHTTPHeaders into pool.acquire", async () => {
    const pool = makeFakeContextPool(4);
    const launcher = createPooledE2eSmokeLauncher(
      pool as unknown as BrowserPool,
    );
    const browser = await launcher();
    // Sample header reflects the real per-run X-Test-Id shape the driver now
    // emits: `d4-<slug>-<runId>` (the per-run runId suffix is FIX 1). This is a
    // value-agnostic passthrough test — the launcher forwards whatever headers
    // it is handed — so the value here is illustrative, not asserted-by-shape.
    await browser.newContext({
      extraHTTPHeaders: {
        "X-AIMock-Context": "slug-d4",
        "X-Test-Id": "d4-slug-d4-run1",
      },
    });
    expect(pool._acquireOptions[0]).toEqual({
      extraHTTPHeaders: {
        "X-AIMock-Context": "slug-d4",
        "X-Test-Id": "d4-slug-d4-run1",
      },
    });
  });

  it("closes open contexts on abort (each releasing its pooled context)", async () => {
    const pool = makeFakeContextPool(4);
    const launcher = createPooledE2eSmokeLauncher(
      pool as unknown as BrowserPool,
    );
    const ac = new AbortController();
    const browser = await launcher(ac.signal);
    const ctx = await browser.newContext();
    await ctx.newPage();
    expect(pool.stats().inUse).toBe(1);
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(pool._releaseLog).toHaveLength(1);
    expect(pool.stats().inUse).toBe(0);
  });

  it("launcher-level close is a no-op (contexts release themselves)", async () => {
    const pool = makeFakeContextPool(4);
    const launcher = createPooledE2eSmokeLauncher(
      pool as unknown as BrowserPool,
    );
    const browser = await launcher();
    const ctx = await browser.newContext();
    await ctx.close();
    await browser.close(); // no-op
    expect(pool._releaseLog).toHaveLength(1);
  });

  // A3 — a normal close() must remove the context from the abort tracking set
  // so a SUBSEQUENT abort does not re-release it (double release). Before the
  // fix, close() released but never `openContexts.delete(ctxHandle)`, so abort
  // closed the already-released context a second time — driving the pool's
  // inUse negative with a non-idempotent pool. The fix (delete-on-close + an
  // idempotent pool) keeps the release count accurate at exactly 1 and inUse
  // at 0.
  it("does not double-release a normally-closed context on a later abort", async () => {
    const pool = makeFakeContextPool(4);
    const launcher = createPooledE2eSmokeLauncher(
      pool as unknown as BrowserPool,
    );
    const ac = new AbortController();
    const browser = await launcher(ac.signal);
    const ctx = await browser.newContext();
    await ctx.newPage();
    expect(pool.stats().inUse).toBe(1);

    // Normal close first — releases the context exactly once.
    await ctx.close();
    expect(pool.stats().inUse).toBe(0);
    expect(pool._releaseLog).toHaveLength(1);

    // Now abort. The already-closed context must NOT be released again.
    ac.abort();
    await new Promise((r) => setTimeout(r, 10));
    expect(pool._releaseLog).toHaveLength(1); // still exactly one release
    expect(pool.stats().inUse).toBe(0); // never driven negative
  });
});

// Module-scoped fake context-pool for the createPooledE2eSmokeLauncher tests
// above — mirrors d6-all-pills.test.ts's helper. Tracks per-CONTEXT
// acquire/release and the contextOptions each acquire was called with.
// release() is IDEMPOTENT, mirroring the real BrowserPool.release: it tracks a
// `liveContexts` Set and no-ops on an unknown / already-released context so a
// double release can never drive the inUse counter negative and silently mask
// a double-release bug.
function makeFakeContextPool(maxContexts: number) {
  let nextCtxId = 0;
  const liveContexts = new Set<object>();
  const releaseLog: number[] = [];
  const acquireOptions: Array<
    { extraHTTPHeaders?: Record<string, string> } | undefined
  > = [];
  return {
    async acquire(options?: { extraHTTPHeaders?: Record<string, string> }) {
      if (liveContexts.size >= maxContexts) throw new Error("FakePool: at cap");
      const id = nextCtxId++;
      acquireOptions.push(options);
      const ctx = {
        __id: id,
        async newPage() {
          return {
            on: () => {},
            goto: async () => {},
            type: async () => {},
            press: async () => {},
            waitForSelector: async () => {},
            textContent: async () => null,
            evaluate: async () => 0,
            close: async () => {},
          } as unknown;
        },
        async close() {},
      };
      liveContexts.add(ctx);
      return ctx as unknown as Browser;
    },
    async release(ctx: unknown) {
      // Unknown / double release — no-op, mirroring BrowserPool.release.
      if (typeof ctx !== "object" || ctx === null || !liveContexts.has(ctx)) {
        return;
      }
      liveContexts.delete(ctx);
      releaseLog.push((ctx as { __id: number }).__id);
    },
    stats() {
      return {
        size: maxContexts,
        available: maxContexts - liveContexts.size,
        inUse: liveContexts.size,
        totalRecycles: 0,
      };
    },
    get _releaseLog() {
      return releaseLog;
    },
    get _acquireOptions() {
      return acquireOptions;
    },
  };
}

describe("e2eChatToolsDriver module export", () => {
  it("module-level e2eChatToolsDriver has kind === 'e2e_smoke'", () => {
    expect(e2eChatToolsDriver.kind).toBe("e2e_smoke");
    expect(typeof e2eChatToolsDriver.run).toBe("function");
  });
});

// --- CVDIAG flap-observability instrumentation (L1-A) --------------------
//
// These tests exercise the 12 probe-layer CVDIAG boundaries wired into the
// driver. The CvdiagEmitter is constructed at VERBOSE tier (so the
// `probe.start` / `probe.navigate.complete` / `probe.sse.event` boundaries
// that are off at default tier are observable) with a captured PB-writer seam
// so emitted envelopes are asserted directly. A CVDIAG-instrumented fake page
// invokes the registered network/console/SSE handlers synthetically to drive
// specific boundaries.

import { CvdiagEmitter } from "../../cvdiag/index.js";
import type { CvdiagEnvelope } from "../../cvdiag/index.js";
import type {
  CvdiagResponseEvent,
  CvdiagConsoleEvent,
  CvdiagSseEvent,
  E2eBrowser as CvE2eBrowser,
  E2eBrowserContext as CvE2eBrowserContext,
  E2ePage as CvE2ePage,
} from "./d4-chat-roundtrip.js";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

/** Capturing PB writer: records every flushed envelope for assertion. */
class CaptureWriter {
  events: CvdiagEnvelope[] = [];
  async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
    this.events.push(...events);
  }
}

/** Build a VERBOSE-tier emitter wired to a capturing PB writer. */
function makeCvdiagEmitter(): {
  emitter: CvdiagEmitter;
  writer: CaptureWriter;
} {
  const writer = new CaptureWriter();
  const emitter = new CvdiagEmitter({
    verbose: true,
    env: {},
    layer: "probe",
    pbWriter: writer,
  });
  return { emitter, writer };
}

/** Per-test scripted hooks a CVDIAG-instrumented fake page should drive. */
interface CvPageScript {
  assistantText?: string;
  /** Child-tag histogram returned by the alternate-content evaluate read. */
  alternateHistogram?: Record<string, number>;
  /** Responses delivered synchronously after `goto` to the onResponse seam. */
  responses?: CvdiagResponseEvent[];
  /** Console messages delivered to the onConsole seam after goto. */
  consoleMessages?: CvdiagConsoleEvent[];
  /** SSE events delivered to the onSseEvent seam after goto. */
  sseEvents?: CvdiagSseEvent[];
}

/**
 * A fake browser whose page exposes the CVDIAG event-source seams and drives
 * them from the script on `goto`. The assistant-message read returns
 * `assistantText`; the alternate-content read returns `alternateHistogram`.
 */
function makeCvBrowser(script: CvPageScript): CvE2eBrowser {
  let respHandler: ((r: CvdiagResponseEvent) => void) | undefined;
  let consoleHandler: ((c: CvdiagConsoleEvent) => void) | undefined;
  let sseHandler: ((e: CvdiagSseEvent) => void) | undefined;
  let evaluateCall = 0;
  const page: CvE2ePage = {
    async goto() {
      // Drive the registered seams synchronously so the driver observes them
      // before reading the assistant response.
      for (const r of script.responses ?? []) respHandler?.(r);
      for (const c of script.consoleMessages ?? []) consoleHandler?.(c);
      for (const e of script.sseEvents ?? []) sseHandler?.(e);
      return null;
    },
    async type() {},
    async press() {},
    async waitForSelector() {},
    async textContent() {
      return "";
    },
    async evaluate<R>(): Promise<R> {
      evaluateCall += 1;
      // First evaluate call(s): assistant-message text read. The
      // alternate-content read happens AFTER the poll loop, on empty exit.
      if (script.assistantText && script.assistantText.length > 0) {
        return script.assistantText as unknown as R;
      }
      // Empty assistant text → the later evaluate is the histogram read.
      if (evaluateCall > 1) {
        return (script.alternateHistogram ?? {}) as unknown as R;
      }
      return "" as unknown as R;
    },
    async close() {},
    onResponse(h) {
      respHandler = h;
    },
    onConsole(h) {
      consoleHandler = h;
    },
    onSseEvent(h) {
      sseHandler = h;
    },
  };
  const ctx: CvE2eBrowserContext = {
    async newPage() {
      return page;
    },
    async close() {},
  };
  return {
    async newContext() {
      return ctx;
    },
    async close() {},
  };
}

/** Collect emitted envelopes for one boundary. */
function byBoundary(writer: CaptureWriter, boundary: string): CvdiagEnvelope[] {
  return writer.events.filter((e) => e.boundary === boundary);
}

describe("d4 CVDIAG probe instrumentation (L1-A)", () => {
  function bufDir(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-test-"));
  }

  async function runWith(
    script: CvPageScript,
    emitter: CvdiagEmitter,
  ): Promise<void> {
    const browser = makeCvBrowser(script);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 50,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDir(),
    });
    await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat"],
    });
    await emitter.flush();
  }

  it("captures cf-mitigated in probe.network.response edge_headers", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "Hi there",
        responses: [
          {
            url: "https://x.example.com/api/copilotkit",
            status: 200,
            headers: { "cf-mitigated": "challenge", "content-length": "12" },
            contentLength: 12,
            durationMs: 5,
            isMessagePost: true,
          },
        ],
      },
      emitter,
    );
    const resp = byBoundary(writer, "probe.network.response");
    expect(resp.length).toBeGreaterThan(0);
    expect(resp[0]!.edge_headers["cf-mitigated"]).toBe("challenge");
  });

  it("fires probe.dom.alternate_content on forced empty-textContent exit", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      { assistantText: "", alternateHistogram: { pre: 1, code: 2 } },
      emitter,
    );
    const alt = byBoundary(writer, "probe.dom.alternate_content");
    expect(alt.length).toBe(1);
    expect(alt[0]!.metadata.child_type_histogram).toEqual({ pre: 1, code: 2 });
  });

  it("captures a browser console.error in probe.console.error", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "Hi",
        consoleMessages: [
          {
            level: "error",
            text: "Uncaught TypeError: x is not a function",
            sourceFile: "https://x.example.com/app.js",
            lineCol: "42:7",
          },
        ],
      },
      emitter,
    );
    const ce = byBoundary(writer, "probe.console.error");
    expect(ce.length).toBe(1);
    expect(ce[0]!.metadata.message_scrubbed).toMatch(/Uncaught TypeError/);
  });

  it("scrubs Bearer/sk- secrets from probe.console.error message", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "Hi",
        consoleMessages: [
          {
            level: "error",
            text: "request failed Authorization: Bearer sk-test-abcdefghijklmnop fired",
            sourceFile: null,
            lineCol: null,
          },
        ],
      },
      emitter,
    );
    const ce = byBoundary(writer, "probe.console.error");
    expect(ce.length).toBe(1);
    const msg = ce[0]!.metadata.message_scrubbed as string;
    expect(msg).not.toMatch(/Bearer\s+sk-/);
    expect(msg).not.toMatch(/sk-test-abcdefghijklmnop/);
    // And no other emitted event retains the secret.
    const all = JSON.stringify(writer.events);
    expect(all).not.toContain("sk-test-abcdefghijklmnop");
  });

  it("denies forbidden cf-ipcountry edge header (never captured)", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "Hi",
        responses: [
          {
            url: "https://x.example.com/api/copilotkit",
            status: 200,
            headers: { "cf-ipcountry": "US", "cf-ray": "abc123" },
            contentLength: null,
            durationMs: 3,
            isMessagePost: true,
          },
        ],
      },
      emitter,
    );
    const resp = byBoundary(writer, "probe.network.response");
    expect(resp.length).toBeGreaterThan(0);
    // cf-ray is allow-listed and present; cf-ipcountry is deny-listed and must
    // appear nowhere in any emitted envelope.
    expect(resp[0]!.edge_headers["cf-ray"]).toBe("abc123");
    const all = JSON.stringify(writer.events);
    expect(all).not.toContain("cf-ipcountry");
    expect(all).not.toContain('"US"');
  });

  it("resets probe.sse.event sequence_num per (test_id, boundary-family)", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "Hi",
        sseEvents: [
          { eventType: "RUN_STARTED", payloadSizeBytes: 20 },
          { eventType: "TEXT_MESSAGE_CHUNK", payloadSizeBytes: 40 },
          { eventType: "RUN_FINISHED", payloadSizeBytes: 10 },
        ],
      },
      emitter,
    );
    const sse = byBoundary(writer, "probe.sse.event");
    expect(sse.length).toBe(3);
    // sequence_num starts at 0 for this (test_id, sse) family and increments.
    expect(sse.map((e) => e.metadata.sequence_num)).toEqual([0, 1, 2]);
    // All three share the same test_id (one level → one test_id).
    const ids = new Set(sse.map((e) => e.test_id));
    expect(ids.size).toBe(1);
  });
});
