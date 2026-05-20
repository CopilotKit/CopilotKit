import { describe, it, expect } from "vitest";
import {
  e2eChatToolsDriver,
  createE2eSmokeDriver,
  type E2eBrowser,
  type E2eBrowserContext,
  type E2ePage,
  type E2eSmokeLevelSignal,
  type E2eSmokePackageSignal,
  type E2eSmokeSignal,
} from "./e2e-chat-tools.js";
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
      if (sel === '[data-testid="copilot-assistant-message"]:last-of-type') {
        return script.assistantText ?? "";
      }
      if (sel === "body") {
        return script.bodyText ?? "";
      }
      return "";
    },
    async evaluate<R>(fn: () => R): Promise<R> {
      // The evaluate() call in the driver reads the last assistant
      // message's textContent via querySelectorAll. In the fake we
      // return the same assistantText the old textContent path used.
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

describe("e2eChatToolsDriver module export", () => {
  it("module-level e2eChatToolsDriver has kind === 'e2e_smoke'", () => {
    expect(e2eChatToolsDriver.kind).toBe("e2e_smoke");
    expect(typeof e2eChatToolsDriver.run).toBe("function");
  });
});
