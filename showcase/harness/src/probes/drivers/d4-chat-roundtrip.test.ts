import { describe, it, expect, vi } from "vitest";
import {
  e2eChatToolsDriver,
  createE2eSmokeDriver,
  createPooledE2eSmokeLauncher,
  runInternalAbArm,
  buildEdgeAbRecord,
  CvdiagProbeSession,
  wirePlaywrightPage,
} from "./d4-chat-roundtrip.js";
import { filterEdgeHeaders } from "../../cvdiag/index.js";
import { computeAbReport } from "../../cvdiag/ab-report.js";
import type { AbOutcomeRecord } from "../../cvdiag/ab-report.js";
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

  it("red when the assistant bubble never renders even though static page text trails the message (BIA false-pass guard)", async () => {
    // Regression for the BIA outage: the agent run finished with ZERO
    // assistant content (RUN_STARTED → RUN_FINISHED, no TEXT_MESSAGE), so
    // the `[data-testid="copilot-assistant-message"]` bubble never produced
    // text. The probe then fell back to scraping <body>, where unrelated
    // STATIC page text trailing the sent message (nav links, footer copy,
    // demo blurb) is long enough to pass the old `text.length > 0` gate —
    // turning a dead agent into a false GREEN.
    //
    // The distinguishing signal is provenance: a REAL turn fills the
    // assistant-message container; a body-scrape leak does not. With the
    // container selector throwing AND no real assistant content, the gate
    // must report RED. (Pre-fix this returned GREEN because the body tail
    // was non-empty — the false-pass this test pins.)
    const { browser } = makeBrowser([
      {
        throwOnAssistantSelector: new Error("selector timeout"),
        bodyText:
          "Hello, please respond with a brief greeting.\n" +
          "Documentation Pricing Blog GitHub Star us on GitHub. " +
          "This demo shows an agentic chat experience built with CopilotKit.",
      },
    ]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    expect(result.state).toBe("red");
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("red");
    const chat = writer.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("red");
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

// --- Aggregate errorDesc propagation (follow-up hardening) --------------
//
// The PRIMARY dashboard tick `e2e-smoke:<slug>` returns from the aggregate
// normal path. `runLevel` RETURNS (not throws) reds that carry an
// `errorDesc` — the abort-before-start / mid-poll-abort guards ("abort"), the
// hard-timeout poll exit ("timeout"), and the `SendBudgetExhaustedError`
// classification ("send-budget-exhausted"). Those classifiers were preserved
// on the side `chat:`/`tools:` rows but DROPPED on the aggregate, so an
// aborted/timed-out/budget red showed on the primary tick as an unclassified
// content-shaped red. These pin the classifier being carried through.
describe("e2eChatToolsDriver aggregate errorDesc propagation", () => {
  it("aborted L3 → aggregate carries errorDesc:'abort' (matching the side chat: row), NOT an unclassified content red", async () => {
    // A pre-aborted `ctx.abortSignal` makes L3's runLevel RETURN a red whose
    // level signal already carries `errorDesc:"abort"`. Pre-fix the aggregate
    // dropped it (unclassified content-shaped red on the primary tick); the
    // fix threads the failing level's classifier through.
    const ac = new AbortController();
    ac.abort();
    const { browser } = makeBrowser([{ assistantText: "" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      textPollTimeoutMs: 50,
    });
    const writer = new CapturingWriter();
    const result = await driver.run(
      baseCtx({ writer, abortSignal: ac.signal }),
      {
        key: "e2e-smoke:foo",
        backendUrl: "https://x.example.com",
      },
    );
    expect(result.state).toBe("red");
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.shape).toBe("package");
    expect(sig.l3).toBe("red");
    // The PRIMARY tick now carries the classifier…
    expect(sig.errorDesc).toBe("abort");
    // …matching the side chat: row (which always kept it).
    const chat = writer.results.find((r) => r.key === "chat:foo");
    const chatSig = chat?.signal as E2eSmokeLevelSignal;
    expect(chatSig.errorDesc).toBe("abort");
  });

  it("over-correction guard: a genuinely-completed-EMPTY (non-aborted) L3 red stays a content red on the aggregate — NO spurious errorDesc", async () => {
    // A turn that finished and produced no assistant content is a REAL content
    // failure; its level signal carries no `errorDesc`. The aggregate must NOT
    // invent one — only carry a classifier the failing level actually set.
    const { browser } = makeBrowser([{ assistantText: "" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      textPollTimeoutMs: 50,
    });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
    });
    expect(result.state).toBe("red");
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.l3).toBe("red");
    expect(sig.failureSummary).toMatch(/L3:/);
    // Content red — no classifier fabricated.
    expect(sig.errorDesc).toBeUndefined();
  });
});

// --- Aborted-empty short-circuit ordering vs alternate-content reads ----
//
// The aborted-and-empty short-circuit runs BEFORE the alternate-content /
// raw-byte `evaluate` reads: an aborted run's page is tearing down, so those
// reads would be swallowed against a dead page and emit an ambiguous empty
// histogram. A non-aborted empty run still performs the alternate-content
// salvage.
describe("e2eChatToolsDriver aborted-empty short-circuit ordering", () => {
  function bufDir(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-reorder-"));
  }

  it("aborted-and-empty run bails at the short-circuit BEFORE the alternate-content read (no probe.dom.alternate_content)", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    const ac = new AbortController();
    const browser = makeCvBrowser({
      assistantText: "",
      alternateHistogram: { pre: 1, code: 2 },
      // Fire the external abort on the first assistant-text read so the run is
      // aborted-AND-empty when it reaches the short-circuit.
      abortOnFirstEvaluate: ac,
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 50,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDir(),
    });
    const result = await driver.run(baseCtx({ abortSignal: ac.signal }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat"],
    });
    await emitter.flush();

    // The aborted level is classified as abort, not a content red.
    const sig = result.signal as E2eSmokePackageSignal;
    expect(sig.l3).toBe("red");
    expect(sig.errorDesc).toBe("abort");
    // The alternate-content read was SKIPPED — the short-circuit bailed first.
    expect(byBoundary(writer, "probe.dom.alternate_content").length).toBe(0);
  });

  it("non-aborted empty run still performs the alternate-content salvage (reorder preserves it)", async () => {
    const { emitter, writer } = makeCvdiagEmitter();
    const browser = makeCvBrowser({
      assistantText: "",
      alternateHistogram: { pre: 1, code: 2 },
      // No abort → falls through the short-circuit to the salvage block.
    });
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

    const alt = byBoundary(writer, "probe.dom.alternate_content");
    expect(alt.length).toBeGreaterThan(0);
    expect(alt[0]!.metadata.child_type_histogram).toEqual({ pre: 1, code: 2 });
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
import { sanitizeJoinTestId } from "../../cvdiag/emit.js";
import type { CvdiagEnvelope } from "../../cvdiag/index.js";
import type { CvdiagPbWriter } from "../../cvdiag/pb-writer.js";
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
  /**
   * Responses delivered on the FIRST assistant-text read (the `evaluate` poll),
   * which runs AFTER `press("Enter")` returns — models PRODUCTION ordering,
   * where the agent-message POST response (and thus its edge headers) arrives
   * asynchronously AFTER the user submits, strictly later than any synchronous
   * press-time work. The pre-fix code emitted `probe.message.send` synchronously
   * right after press, so this response (and its edge headers) was not yet
   * observed → empty `edge_headers`.
   */
  responsesAfterSubmit?: CvdiagResponseEvent[];
  /** Console messages delivered to the onConsole seam after goto. */
  consoleMessages?: CvdiagConsoleEvent[];
  /** SSE events delivered to the onSseEvent seam after goto. */
  sseEvents?: CvdiagSseEvent[];
  /**
   * When set, fire this controller's abort on the FIRST assistant-text
   * `evaluate` read — models a mid-poll external abort (`ctx.abortSignal`
   * firing) that leaves the response empty. The retry loop then breaks on
   * `abortSignal.aborted` and control reaches the aborted-and-empty
   * short-circuit before the alternate-content reads.
   */
  abortOnFirstEvaluate?: AbortController;
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
      // PRODUCTION ordering: the message-POST response arrives ASYNC, after
      // press("Enter") returns — model it by driving it on the first
      // assistant-text read (which the driver runs post-submit).
      if (evaluateCall === 1) {
        for (const r of script.responsesAfterSubmit ?? []) respHandler?.(r);
        // Mid-poll external abort: fire on the first assistant-text read so the
        // response stays empty and the retry loop breaks on the aborted signal.
        script.abortOnFirstEvaluate?.abort();
      }
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

  it("labels a failed run (empty SSE, no first-token) on probe.exit with outcome=err + failure_classifier=sse-missing", async () => {
    // RED (pre-fix): a run that produces NO SSE events and NO first-token
    // (empty assistant text) still emits `probe.exit` with `terminal_outcome=ok`
    // and no failure classifier — so reds are indistinguishable from greens in
    // cvdiag probe data. GREEN: the same run emits `outcome=err` AND a
    // `failure_classifier=sse-missing` (no SSE => earliest-missing signal) in
    // metadata, so the red is labeled at the probe.exit boundary.
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      // No `sseEvents`, empty assistant text => no probe.dom.firsttoken,
      // sse_event_count=0 => the run actually failed.
      { assistantText: "", alternateHistogram: { div: 1 } },
      emitter,
    );
    const exit = byBoundary(writer, "probe.exit");
    expect(exit.length).toBe(1);
    expect(exit[0]!.outcome).toBe("err");
    expect(exit[0]!.metadata.terminal_outcome).toBe("err");
    expect(exit[0]!.metadata.failure_classifier).toBe("sse-missing");
  });

  it("keeps a passing run on probe.exit at outcome=ok with no failure_classifier", async () => {
    // GREEN-CONTROL: a clean run (assistant text present, an SSE run-finished
    // event) stays `terminal_outcome=ok` and carries NO failure classifier.
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "Hello there",
        sseEvents: [{ eventType: "RUN_FINISHED", payloadSizeBytes: 10 }],
      },
      emitter,
    );
    const exit = byBoundary(writer, "probe.exit");
    expect(exit.length).toBe(1);
    expect(exit[0]!.outcome).toBe("ok");
    expect(exit[0]!.metadata.terminal_outcome).toBe("ok");
    expect(exit[0]!.metadata.failure_classifier).toBeUndefined();
  });

  it("classifies a run that streamed SSE but never rendered a DOM bubble as failure_classifier=dom-missing", async () => {
    // RED (pre-fix): SSE arrived but no assistant bubble ever rendered (empty
    // text, no first-token) — still `terminal_outcome=ok`. GREEN: `outcome=err`
    // with `failure_classifier=dom-missing` (SSE present => not sse-missing;
    // no first-token => DOM never produced a token).
    const { emitter, writer } = makeCvdiagEmitter();
    await runWith(
      {
        assistantText: "",
        alternateHistogram: { div: 1 },
        sseEvents: [{ eventType: "RUN_FINISHED", payloadSizeBytes: 10 }],
      },
      emitter,
    );
    const exit = byBoundary(writer, "probe.exit");
    expect(exit.length).toBe(1);
    expect(exit[0]!.outcome).toBe("err");
    expect(exit[0]!.metadata.failure_classifier).toBe("dom-missing");
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

  it("raw-byte sample test_id MATCHES the emitted events' test_id so the cvdiag_raw_byte_samples ↔ cvdiag_events join works (FIX 4)", async () => {
    // RED (pre-fix): the raw-byte sample was written with the un-normalized
    // `d4-<slug>-<runId>` X-Test-Id while events carried the emitter's minted
    // UUIDv7 → the documented correlation join returned nothing. GREEN: both
    // sides carry the ONE stable session test_id.
    //
    // A DEBUG-tier emitter (env allow-list scoped to the slug) + a body-bearing
    // message-POST response + an EMPTY assistant text (the class-(d) flap
    // trigger) drives the raw-byte capture path.
    const captured: CvdiagEnvelope[] = [];
    const rawByteSamples: Array<{ test_id: string; slug: string }> = [];
    const combinedWriter = {
      async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
        captured.push(...events);
      },
      async writeRawByteSample(record: {
        test_id: string;
        slug: string;
      }): Promise<void> {
        rawByteSamples.push({ test_id: record.test_id, slug: record.slug });
      },
    };
    const emitter = new CvdiagEmitter({
      debug: true,
      env: {
        NODE_ENV: "test",
        SHOWCASE_ENV: "test",
        CVDIAG_DEBUG: "1",
        CVDIAG_DEBUG_ALLOW_LIST: "foo",
      },
      layer: "probe",
      pbWriter: combinedWriter as unknown as CvdiagPbWriter,
    });
    const browser = makeCvBrowser({
      // Empty assistant text → class-(d) empty-response flap → raw-byte capture.
      assistantText: "",
      responses: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "content-type": "text/event-stream" },
          contentLength: 0,
          durationMs: 4,
          isMessagePost: true,
          // A non-empty body so captureRawBytes produces a sample.
          body: async () => Buffer.from("data: {}\n\n", "utf8"),
        },
      ],
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 50,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: mkdtempSync(join(tmpdir(), "cvdiag-test-")),
      cvdiagPbWriter: combinedWriter as unknown as CvdiagPbWriter,
    });
    await driver.run(
      // The per-slug DEBUG allow-list is parsed from ctx.env, NOT the emitter
      // env — scope it to the slug under test so captureRawBytes is armed.
      baseCtx({ env: { CVDIAG_DEBUG_ALLOW_LIST: "foo" } }),
      {
        key: "e2e-smoke:foo",
        backendUrl: "https://x.example.com",
        demos: ["agentic-chat"],
      },
    );
    await emitter.flush();

    // A raw-byte sample was captured.
    expect(rawByteSamples.length).toBeGreaterThan(0);
    // Every emitted event for this level shares ONE stable session test_id.
    const eventIds = new Set(captured.map((e) => e.test_id));
    expect(eventIds.size).toBe(1);
    const eventTestId = [...eventIds][0]!;
    // The raw-byte sample carries the SAME test_id → the intra-layer
    // raw-byte ↔ events join resolves.
    expect(rawByteSamples[0]!.test_id).toBe(eventTestId);
    // leg-3: the shared session test_id is the backend-adopted/sanitized
    // forwarded X-Test-Id — `sanitizeJoinTestId("d4-foo-<runId>")` — NOT a fresh
    // random UUIDv7. This is the value the backend derives from the same inbound
    // header, so the cross-layer probe↔backend join now also closes. The
    // sanitizer preserves the `d4-` prefix (it is `[a-z0-9._-]`), so the
    // resolved id is the forwarded id, lowercased.
    expect(eventTestId).toMatch(/^d4-foo-/);
    expect(eventTestId).toBe(sanitizeJoinTestId(eventTestId));
  });
});

// ── Follow-up item 4: additional coverage (no production change) ─────────────
//
// These tests widen coverage over paths the #5882 CR deferred as bucket-(b):
//   - the FIFO-cap `CVDIAG_MAX_OUTSTANDING_STARTS_PER_URL` eviction backstop,
//   - the DEBUG-auto-disarm fail-closed guard on the raw-byte capture,
//   - the alternate-content / raw-byte block being SKIPPED on a container
//     success (non-empty assistant text) path.
describe("d4 follow-up coverage (item 4)", () => {
  function bufDir(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-cov-"));
  }

  it("FIFO-cap: a URL that accumulates > CVDIAG_MAX_OUTSTANDING_STARTS_PER_URL un-responded starts evicts the OLDEST so a later response pairs with a RECENT start", () => {
    // A persistent SSE stream issues many same-URL requests that NEVER respond
    // (no `response`, no `requestfailed`) — the exact leak the cap backstops.
    // Without the cap the per-URL FIFO grows unbounded AND a much-later response
    // shifts an ANCIENT stale start → inflated duration_ms. The cap (64) drops
    // the oldest starts so the queue stays bounded and the eventual response
    // pairs with a recent start (small duration).
    const handlers = new Map<string, (arg: unknown) => void>();
    const fakePage = {
      goto: async () => null,
      type: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      textContent: async () => null,
      evaluate: async <R>() => "" as unknown as R,
      close: async () => {},
      on(event: string, handler: (arg: unknown) => void) {
        handlers.set(event, handler);
      },
    };
    const adapted = wirePlaywrightPage(fakePage);
    const durations: number[] = [];
    adapted.onResponse?.((r) => durations.push(r.durationMs));
    const reqHandler = handlers.get("request")!;
    const respHandler = handlers.get("response")!;
    const URL = "https://x.example.com/api/copilotkit";
    const mkReq = () => ({ url: () => URL });
    const mkResp = () => ({
      url: () => URL,
      status: () => 200,
      headers: () => ({}),
      request: () => ({ method: () => "POST" }),
    });

    const CAP = 64;
    // Issue exactly CAP ANCIENT un-responded starts (a persistent SSE stream
    // that never responds/fails).
    for (let i = 0; i < CAP; i++) reqHandler(mkReq());
    // Age those ancient starts with a measurable gap.
    const gapUntil = performance.now() + 15;
    while (performance.now() < gapUntil) {
      /* spin */
    }
    // Now issue ANOTHER CAP fresh starts. Each push beyond the cap evicts the
    // OLDEST outstanding start, so after CAP fresh pushes EVERY ancient start
    // has been evicted and the queue holds only the fresh (recent) starts —
    // the whole point of the backstop for requests that neither respond nor fail.
    for (let i = 0; i < CAP; i++) reqHandler(mkReq());
    // A response now pairs (FIFO) with the OLDEST REMAINING start — which, after
    // the cap evicted all ancient starts, is a fresh (recent) one.
    respHandler(mkResp());

    expect(durations.length).toBe(1);
    // The cap evicted every ancient start, so the response paired with a RECENT
    // start → a small duration, NOT the ~15ms+ ancient gap. Without the cap the
    // unbounded FIFO would still hold all CAP ancient starts and shift the
    // oldest (~15ms+) here.
    expect(durations[0]).toBeLessThan(10);
  });

  it("DEBUG auto-disarm is fail-closed: once DEBUG has disarmed, NO raw-byte sample is captured even on the class-(d) empty-response trigger", async () => {
    // The raw-byte body capture is the most PII-sensitive path CVDIAG has; it
    // MUST stop the instant DEBUG auto-disarms (10min / 10k-event bounds), NOT
    // merely when `tier` flips (it never does). The driver gates capture on the
    // LIVE `shouldEmit("aimock.sse.chunk")` (a debug-exclusive boundary), which
    // returns false once DEBUG expires. This negative test drives a DISARMED
    // debug emitter down the exact empty-response path that WOULD capture while
    // armed and asserts fail-closed: zero samples.
    const rawByteSamples: unknown[] = [];
    const combinedWriter = {
      async writeBatch(): Promise<void> {},
      async writeRawByteSample(record: unknown): Promise<void> {
        rawByteSamples.push(record);
      },
    };
    const emitter = new CvdiagEmitter({
      debug: true,
      env: {
        NODE_ENV: "test",
        SHOWCASE_ENV: "test",
        CVDIAG_DEBUG: "1",
        CVDIAG_DEBUG_ALLOW_LIST: "foo",
      },
      layer: "probe",
      pbWriter: combinedWriter as unknown as CvdiagPbWriter,
    });
    // Force DEBUG past its wall-clock deadline → auto-disarmed. This models
    // "DEBUG was armed >10 minutes ago"; `shouldEmit("aimock.sse.chunk")` now
    // returns false (fall-through to default-tier inclusion, which excludes it).
    (emitter as unknown as { debugDeadlineMs: number }).debugDeadlineMs =
      Date.now() - 1;
    expect(emitter.shouldEmit("aimock.sse.chunk")).toBe(false);

    const browser = makeCvBrowser({
      // Empty assistant text → class-(d) trigger that WOULD capture while armed.
      assistantText: "",
      responses: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "content-type": "text/event-stream" },
          contentLength: 0,
          durationMs: 4,
          isMessagePost: true,
          body: async () => Buffer.from("data: {}\n\n", "utf8"),
        },
      ],
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 50,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDir(),
      cvdiagPbWriter: combinedWriter as unknown as CvdiagPbWriter,
    });
    await driver.run(baseCtx({ env: { CVDIAG_DEBUG_ALLOW_LIST: "foo" } }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat"],
    });
    await emitter.flush();

    // Fail-closed: DEBUG disarmed → NO raw-byte sample written.
    expect(rawByteSamples.length).toBe(0);
  });

  it("container-success path (non-empty assistant text): the alternate-content / raw-byte capture block is SKIPPED entirely", async () => {
    // The alternate-content histogram + raw-byte capture block is gated on
    // `cvdiagResponseEmpty` — it exists ONLY to characterize an EMPTY-response
    // flap (class (d)). On a genuine container success (non-empty assistant
    // text) `cvdiagResponseEmpty` is cleared, so the whole block must be
    // skipped: no `probe.dom.alternate_content` boundary AND no raw-byte sample,
    // even under a DEBUG emitter that would otherwise arm capture.
    const rawByteSamples: unknown[] = [];
    const captured: CvdiagEnvelope[] = [];
    const combinedWriter = {
      async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
        captured.push(...events);
      },
      async writeRawByteSample(record: unknown): Promise<void> {
        rawByteSamples.push(record);
      },
    };
    const emitter = new CvdiagEmitter({
      debug: true,
      env: {
        NODE_ENV: "test",
        SHOWCASE_ENV: "test",
        CVDIAG_DEBUG: "1",
        CVDIAG_DEBUG_ALLOW_LIST: "foo",
      },
      layer: "probe",
      pbWriter: combinedWriter as unknown as CvdiagPbWriter,
    });
    const browser = makeCvBrowser({
      // Non-empty assistant text → container SUCCESS → block skipped.
      assistantText: "Hello there, happy to help!",
      responses: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "content-type": "text/event-stream" },
          contentLength: 10,
          durationMs: 4,
          isMessagePost: true,
          body: async () => Buffer.from("data: {}\n\n", "utf8"),
        },
      ],
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 50,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDir(),
      cvdiagPbWriter: combinedWriter as unknown as CvdiagPbWriter,
    });
    const result = await driver.run(
      baseCtx({ env: { CVDIAG_DEBUG_ALLOW_LIST: "foo" } }),
      {
        key: "e2e-smoke:foo",
        backendUrl: "https://x.example.com",
        demos: ["agentic-chat"],
      },
    );
    await emitter.flush();

    // The turn genuinely succeeded (container had content).
    expect(result.state).toBe("green");
    // The empty-response-only block was skipped: no alternate-content boundary
    // and no raw-byte capture on the success path.
    expect(
      captured.filter((e) => e.boundary === "probe.dom.alternate_content")
        .length,
    ).toBe(0);
    expect(rawByteSamples.length).toBe(0);
  });
});

// ── M3 CR R1: d4 probe data-correctness fixes ───────────────────────────────

describe("d4 CVDIAG data-correctness (M3 CR R1)", () => {
  function bufDir(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-test-"));
  }

  // ── FIX 1: per-request timing key (no same-URL duration collision) ─────────
  it("FIX 1: repeated same-URL POSTs each get their own non-zero duration_ms", () => {
    // RED (pre-fix): `requestStartByUrl` keyed by URL ONLY — the 2nd request
    // overwrote the 1st's start time, and the 1st response DELETED the entry,
    // so the 2nd same-URL response saw `startedAt === undefined` → duration 0.
    // GREEN: a per-URL FIFO pairs each response with its own request start.
    const handlers = new Map<string, (arg: unknown) => void>();
    const fakePage = {
      goto: async () => null,
      type: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      textContent: async () => null,
      evaluate: async <R>() => "" as unknown as R,
      close: async () => {},
      on(event: string, handler: (arg: unknown) => void) {
        handlers.set(event, handler);
      },
    };
    const adapted = wirePlaywrightPage(fakePage);
    const durations: number[] = [];
    adapted.onResponse?.((r) => durations.push(r.durationMs));

    const reqHandler = handlers.get("request")!;
    const respHandler = handlers.get("response")!;
    const URL = "https://x.example.com/api/copilotkit";
    const mkReq = () => ({ url: () => URL });
    const mkResp = () => ({
      url: () => URL,
      status: () => 200,
      headers: () => ({}),
      request: () => ({ method: () => "POST" }),
    });

    // Two same-URL requests issued back-to-back BEFORE either response — the
    // exact concurrent/repeat pattern that collided to 0 pre-fix.
    reqHandler(mkReq());
    reqHandler(mkReq());
    // A short spin so the wall-clock delta is measurably > 0.
    const spinUntil = performance.now() + 2;
    while (performance.now() < spinUntil) {
      /* burn a couple ms so durations are non-zero */
    }
    respHandler(mkResp());
    respHandler(mkResp());

    expect(durations.length).toBe(2);
    // BOTH responses get a real, non-zero duration (pre-fix the 2nd was 0).
    expect(durations[0]).toBeGreaterThan(0);
    expect(durations[1]).toBeGreaterThan(0);
  });

  // ── FIX 2: SSE timeout carve-out does not double-emit live events ──────────
  it("FIX 2: timeout carve-out re-emits ONLY events not already emitted live", async () => {
    // RED (pre-fix): every observed SSE event is buffered AND (under the rate)
    // emitted live; on a timeout the FULL buffer is flushed again, duplicating
    // the already-live-emitted rows and DOUBLING `sse_event_count`. GREEN: the
    // carve-out flushes only events the §7 sampling stride dropped.
    const writer = new CaptureWriter();
    const emitter = new CvdiagEmitter({
      verbose: true, // probe.sse.event is verbose+; default tier suppresses it.
      env: {},
      layer: "probe",
      pbWriter: writer,
    });
    const session = new CvdiagProbeSession({
      emitter,
      testId: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
      slug: "foo",
      demo: "agentic-chat",
      bufferDir: bufDir(),
      nowMs: 0,
    });

    // Three SSE events, all under the rate target → all emitted LIVE.
    session.sseEvent({ eventType: "RUN_STARTED", payloadSizeBytes: 20 }, 0);
    session.sseEvent({ eventType: "TEXT_CHUNK", payloadSizeBytes: 40 }, 1);
    session.sseEvent({ eventType: "RUN_FINISHED", payloadSizeBytes: 10 }, 2);
    // Terminal timeout — the carve-out path.
    session.exit("timeout", 999);
    await emitter.flush();

    const sse = byBoundary(writer, "probe.sse.event");
    // Exactly 3 rows — NOT 6 (pre-fix doubled them on the timeout flush).
    expect(sse.length).toBe(3);
    // sequence_num is a clean 0,1,2 — no duplicates/re-emits.
    expect(sse.map((e) => e.metadata.sequence_num)).toEqual([0, 1, 2]);
    // probe.exit.sse_event_count matches the real emitted count (3, not 6).
    const exit = byBoundary(writer, "probe.exit");
    expect(exit.length).toBe(1);
    expect(exit[0]!.metadata.sse_event_count).toBe(3);
  });

  // ── FIX 3: probe.message.send edge_headers read AFTER the response ─────────
  it("FIX 3: message.send carries edge_headers when the POST response lands after submit (prod ordering)", async () => {
    // RED (pre-fix): `messageSend` was emitted right after press("Enter"),
    // BEFORE the message-POST response arrived, so `messageSendEdge` was still
    // undefined → empty `edge_headers` in production. GREEN: the emit is driven
    // off the onResponse seam (after the response lands), so it carries the
    // real edge headers even when the response arrives AFTER submit.
    const writer = new CaptureWriter();
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "probe",
      pbWriter: writer,
    });
    const browser = makeCvBrowser({
      assistantText: "Hi there",
      // Deliver the message-POST response AFTER submit (on the assistant-text
      // poll), not during goto — models production, where the response (and
      // edge headers) post-dates the user's Enter keypress.
      responsesAfterSubmit: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "cf-mitigated": "challenge", "content-length": "12" },
          contentLength: 12,
          durationMs: 5,
          isMessagePost: true,
        },
      ],
    });
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

    const send = byBoundary(writer, "probe.message.send");
    // Emitted exactly once.
    expect(send.length).toBe(1);
    // It carries the REAL edge headers from the post-submit response (pre-fix
    // this was empty because the emit happened before the response landed).
    expect(send[0]!.edge_headers["cf-mitigated"]).toBe("challenge");
  });
});

describe("d4 CVDIAG observability fixes (M3 CR R3)", () => {
  function bufDir(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-test-"));
  }

  // ── FIX A: timing queue evicts on requestfailed / abort (no leak/stale) ────
  it("FIX A: a responseless request that ABORTS does not leak a queue entry that mis-pairs a later same-URL response", () => {
    // RED (pre-fix): the per-URL FIFO start-time queue only dequeued on a
    // `response`. A request that ABORTED / FAILED (e.g. a persistent SSE
    // stream, or a cancelled nav) left its start in the queue forever, so a
    // LATER same-URL response shifted that STALE start → its `duration_ms`
    // measured from the WRONG (much-earlier, abandoned) request. GREEN: the
    // `requestfailed` seam evicts the oldest outstanding start, so the later
    // response pairs with ITS OWN recent start, not the abandoned one.
    //
    // The fake registers MULTIPLE handlers per event (real Playwright fires
    // every `page.on(event,...)` listener) so the eviction listener that
    // `onResponse` wires for `requestfailed` co-exists with the emission
    // listener that `onRequestFailed` wires — both must fire on a fail.
    const handlers = new Map<string, ((arg: unknown) => void)[]>();
    const fire = (event: string, arg: unknown): void => {
      for (const h of handlers.get(event) ?? []) h(arg);
    };
    const fakePage = {
      goto: async () => null,
      type: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      textContent: async () => null,
      evaluate: async <R>() => "" as unknown as R,
      close: async () => {},
      on(event: string, handler: (arg: unknown) => void) {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
      },
    };
    const adapted = wirePlaywrightPage(fakePage);
    const durations: number[] = [];
    adapted.onResponse?.((r) => durations.push(r.durationMs));
    // Also wire the emission seam so the production listener topology (two
    // `requestfailed` listeners) is faithfully reproduced.
    adapted.onRequestFailed?.(() => {});

    const reqHandler = (a: unknown) => fire("request", a);
    const failHandler = (a: unknown) => fire("requestfailed", a);
    const respHandler = (a: unknown) => fire("response", a);
    const URL = "https://x.example.com/api/copilotkit";
    const mkReq = () => ({ url: () => URL });
    // The `requestfailed` event arg also exposes failure()/response() for the
    // emission seam (onRequestFailed); the eviction listener only reads url().
    const mkFail = () => ({
      url: () => URL,
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
      response: () => null,
    });
    const mkResp = () => ({
      url: () => URL,
      status: () => 200,
      headers: () => ({}),
      request: () => ({ method: () => "POST" }),
    });

    // First request issued, then ABORTS (no response ever arrives for it).
    reqHandler(mkReq());
    failHandler(mkFail());
    // Burn a measurable gap so a stale-pairing would yield a LARGE duration,
    // while a correct pairing (to the SECOND request below) stays tiny.
    const gapUntil = performance.now() + 15;
    while (performance.now() < gapUntil) {
      /* spin */
    }
    // A SECOND same-URL request issued, then responds quickly.
    reqHandler(mkReq());
    const respUntil = performance.now() + 1;
    while (performance.now() < respUntil) {
      /* tiny spin */
    }
    respHandler(mkResp());

    // Exactly one response observed.
    expect(durations.length).toBe(1);
    // GREEN: duration reflects the SECOND request (a few ms), NOT the aborted
    // first request (~15 ms+ pre-fix). The aborted start was evicted, so the
    // response paired with its own recent start. Pre-fix the stale first start
    // was shifted → duration ≥ the 15 ms gap.
    expect(durations[0]).toBeLessThan(10);
  });

  // ── FIX C: isMessagePost matches the AGENT-MESSAGE POST, not any POST ───────
  it("FIX C: an unrelated POST AFTER the agent-message POST does not get flagged isMessagePost (no overwrite of the captured agent-message response)", () => {
    // RED (pre-fix): `isMessagePost` was `method === "POST"` for ANY POST, so a
    // telemetry/analytics POST issued AFTER the real agent-message POST was ALSO
    // flagged isMessagePost. The driver's onResponse seam keeps the LAST such
    // response in `messageSendEdge` / `lastMessagePostResp`, so the unrelated
    // POST's edge headers / raw bytes silently overwrote the real agent-message
    // ones — mis-attributing probe.message.send + edge_interference_signal.
    // GREEN: only the POST under the CopilotKit runtime path (`/api/copilotkit`)
    // is flagged, so the unrelated trailing POST is ignored and the captured
    // response stays pinned to the actual agent-message round-trip.
    const handlers = new Map<string, (arg: unknown) => void>();
    const fakePage = {
      goto: async () => null,
      type: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      textContent: async () => null,
      evaluate: async <R>() => "" as unknown as R,
      close: async () => {},
      on(event: string, handler: (arg: unknown) => void) {
        handlers.set(event, handler);
      },
    };
    const adapted = wirePlaywrightPage(fakePage);
    // Simulate the driver's capture: keep the edge header of the LAST response
    // flagged isMessagePost, exactly like `messageSendEdge`/`lastMessagePostResp`.
    let capturedMitigated: string | null | undefined;
    let capturedUrl: string | undefined;
    adapted.onResponse?.((r) => {
      if (r.isMessagePost) {
        capturedMitigated = r.headers["cf-mitigated"];
        capturedUrl = r.url;
      }
    });

    const respHandler = handlers.get("response")!;
    const mkPost = (url: string, headers: Record<string, string>) => ({
      url: () => url,
      status: () => 200,
      headers: () => headers,
      request: () => ({ method: () => "POST" }),
    });

    // 1) The REAL agent-message POST (CopilotKit runtime path) — carries the
    //    edge header we must attribute to probe.message.send.
    respHandler(
      mkPost("https://x.example.com/api/copilotkit", {
        "cf-mitigated": "challenge",
      }),
    );
    // 2) An UNRELATED telemetry POST issued AFTER it — different path. Pre-fix
    //    this overwrote the captured agent-message response (any POST matched).
    respHandler(
      mkPost("https://x.example.com/api/telemetry", {
        "cf-mitigated": "FROM-UNRELATED-POST",
      }),
    );

    // The unrelated POST is NOT flagged → capture stays pinned to the
    // agent-message response (pre-fix `capturedMitigated` was the telemetry
    // value because the trailing POST was also flagged isMessagePost).
    expect(capturedUrl).toBe("https://x.example.com/api/copilotkit");
    expect(capturedMitigated).toBe("challenge");
  });

  // ── FIX B: SSE backfill preserves ORIGINAL chronological sequence_num ──────
  it("FIX B: timeout carve-out backfills dropped SSE events in original chronological seq order, not after the live events", async () => {
    // RED (pre-fix): a backfilled (sampling-DROPPED) SSE event got a FRESH
    // sequence_num minted at flush time, so it sorted AFTER the lower-seq live
    // events — defeating the reorder/drop detection the carve-out exists for.
    // GREEN: each event reserves its seq at OBSERVE time, so the backfilled
    // events keep their original (lower) seq and sort chronologically.
    const writer = new CaptureWriter();
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "probe",
      pbWriter: writer,
    });
    const session = new CvdiagProbeSession({
      emitter,
      testId: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
      slug: "foo",
      demo: "agentic-chat",
      bufferDir: bufDir(),
      nowMs: 0,
    });

    // Drive the rate OVER target within one 1s window so the §7 stride DROPS
    // some events live and the carve-out must backfill them on timeout.
    // 90 events in window 0 → target 30 → stride 3 → events 3,6,9,... emit live
    // (seq 2,5,8,...), the rest are dropped (seq 0,1,3,4,...) and backfilled.
    const N = 90;
    for (let i = 0; i < N; i++) {
      session.sseEvent({ eventType: `E${i}`, payloadSizeBytes: 1 }, 0);
    }
    // Terminal timeout — the carve-out flushes the dropped events.
    session.exit("timeout", 999);
    await emitter.flush();

    const sse = byBoundary(writer, "probe.sse.event");
    // All N events surface exactly once (live + backfilled, no dupes).
    expect(sse.length).toBe(N);
    const seqs = sse.map((e) => e.metadata.sequence_num as number);
    // Every observed event's seq surfaces exactly once: the full 0..N-1 set.
    expect([...seqs].sort((a, b) => a - b)).toEqual(
      Array.from({ length: N }, (_, i) => i),
    );
    // GREEN: when re-sorted by seq, the rows reconstruct the ORIGINAL arrival
    // order (event_type E0..E89). Pre-fix the backfilled events carried fresh
    // (HIGHER) seqs minted at flush time, so sorting by seq put the dropped
    // (chronologically-earlier) events AFTER the live ones — a chronological
    // scramble. Build seq→event_type and confirm it is the identity ordering.
    const bySeq = new Map<number, string>();
    for (const e of sse) {
      bySeq.set(
        e.metadata.sequence_num as number,
        e.metadata.event_type as string,
      );
    }
    const reconstructed = Array.from({ length: N }, (_, i) => bySeq.get(i));
    expect(reconstructed).toEqual(Array.from({ length: N }, (_, i) => `E${i}`));
  });

  // ── FIX C: probe.exit fires on the abort-before-start early-return path ────
  it("FIX C: an abort-before-start level still emits probe.start + probe.exit (balanced session)", async () => {
    // RED (pre-fix): the abort-before-start early return constructed the
    // CVDIAG session (opening it) but returned BEFORE emitting probe.start or
    // probe.exit — violating the documented "probe.exit fires on every path"
    // invariant and leaving a test_id with NO boundary rows (an unbalanced,
    // never-closed session). GREEN: the abort path emits probe.start (open)
    // and probe.exit (close, timeout outcome) so the session is balanced.
    const { emitter, writer } = makeCvdiagEmitter();
    const browser = makeCvBrowser({ assistantText: "Hi there" });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 50,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDir(),
    });
    // Pre-aborted external signal → the driver aborts before the level runs,
    // hitting the abort-before-start early return in runLevel.
    const ac = new AbortController();
    ac.abort();
    await driver.run(baseCtx({ abortSignal: ac.signal }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat"],
    });
    await emitter.flush();

    const starts = byBoundary(writer, "probe.start");
    const exits = byBoundary(writer, "probe.exit");
    // GREEN: the abort path emitted exactly one open and one close. Pre-fix
    // BOTH were zero (the early return skipped them entirely).
    expect(starts.length).toBe(1);
    expect(exits.length).toBe(1);
    // The exit's terminal outcome is `timeout` (aborted before it could run).
    expect(exits[0]!.metadata.terminal_outcome).toBe("timeout");
    // Open and close carry the SAME test_id (one balanced session).
    expect(starts[0]!.test_id).toBe(exits[0]!.test_id);
  });
});

// ── CVDIAG Railway-internal routing A/B (spec Phase 8) ──────────────────────

describe("d4 A/B internal routing (Phase 8)", () => {
  const SLUG = "langgraph-python";
  const VALID_UUIDV7 = "017f22e2-79b0-7cc3-98c4-dc0c0c07398f";
  const HMAC_ENV = { CVDIAG_AB_HMAC_SECRET: "test-secret-not-real" };

  it("buildEdgeAbRecord maps green→ok / red→err and flags cf-mitigated", () => {
    const green = buildEdgeAbRecord({
      abPairId: "p1",
      testId: VALID_UUIDV7,
      slug: SLUG,
      demo: "agentic-chat",
      edgeState: "green",
    });
    expect(green.arm).toBe("edge");
    expect(green.outcome).toBe("ok");
    expect(green.edge_interference_signal).toBe(false);

    const red = buildEdgeAbRecord({
      abPairId: "p1",
      testId: VALID_UUIDV7,
      slug: SLUG,
      demo: "agentic-chat",
      edgeState: "red",
      edgeHeaders: filterEdgeHeaders({ "cf-mitigated": "challenge" }),
    });
    expect(red.outcome).toBe("err");
    expect(red.edge_interference_signal).toBe(true);
  });

  it("runInternalAbArm SKIPS gracefully when the IPv4 target is unreachable", async () => {
    const fetchSpy = vi.fn();
    const rec = await runInternalAbArm({
      internalUrl: "http://langgraph-python.railway.internal:8123/ok",
      abPairId: "p1",
      testId: VALID_UUIDV7,
      slug: SLUG,
      demo: "agentic-chat",
      env: HMAC_ENV,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      reachabilityCheck: async () => false, // unreachable
      now: () => new Date(),
      logger,
    });
    expect(rec).toBeNull();
    // Unreachable → never issues the actual internal request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("runInternalAbArm SKIPS when the HMAC secret is unset (no row)", async () => {
    const rec = await runInternalAbArm({
      internalUrl: "http://langgraph-python.railway.internal:8123/ok",
      abPairId: "p1",
      testId: VALID_UUIDV7,
      slug: SLUG,
      demo: "agentic-chat",
      env: {}, // secret unset
      fetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
      reachabilityCheck: async () => true,
      now: () => new Date(),
      logger,
    });
    expect(rec).toBeNull();
  });

  it("runInternalAbArm SKIPS when the test_id is malformed (fail-closed)", async () => {
    const rec = await runInternalAbArm({
      internalUrl: "http://langgraph-python.railway.internal:8123/ok",
      abPairId: "p1",
      testId: "not-a-uuid",
      slug: SLUG,
      demo: "agentic-chat",
      env: HMAC_ENV,
      fetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
      reachabilityCheck: async () => true,
      now: () => new Date(),
      logger,
    });
    expect(rec).toBeNull();
  });

  it("runInternalAbArm produces an ok internal record when reachable + 200", async () => {
    let sentHeaders: Record<string, string> | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentHeaders = init?.headers as Record<string, string>;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const rec = await runInternalAbArm({
      internalUrl: "http://langgraph-python.railway.internal:8123/ok",
      abPairId: "pair-x",
      testId: VALID_UUIDV7,
      slug: SLUG,
      demo: "agentic-chat",
      env: HMAC_ENV,
      fetchImpl,
      reachabilityCheck: async () => true,
      now: () => new Date(),
      logger,
    });
    expect(rec).not.toBeNull();
    expect(rec!.arm).toBe("internal");
    expect(rec!.outcome).toBe("ok");
    expect(rec!.ab_pair_id).toBe("pair-x");
    // The signed request carries the HMAC + correlation headers.
    expect(sentHeaders?.["X-Cvdiag-Ab-Hmac"]).toBeTruthy();
    expect(sentHeaders?.["X-Cvdiag-Ab-Pair"]).toBe("pair-x");
    expect(sentHeaders?.["X-Test-Id"]).toBe(VALID_UUIDV7);
  });

  it("driver collects NOTHING when CVDIAG_AB_INTERNAL_URL is unset (default OFF)", async () => {
    const collected: AbOutcomeRecord[] = [];
    const { browser } = makeBrowser([{ assistantText: "Hi!" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      abCollector: { collect: (r) => collected.push(r) },
    });
    await driver.run(baseCtx({ env: HMAC_ENV }), {
      key: "e2e-smoke:langgraph-python",
      backendUrl: "https://showcase-lgp.example.com",
    });
    expect(collected).toEqual([]);
  });

  it("driver collects BOTH arms when gated ON + reachable; report diffs them", async () => {
    const collected: AbOutcomeRecord[] = [];
    const { browser } = makeBrowser([{ assistantText: "Hi!" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      abCollector: { collect: (r) => collected.push(r) },
      abReachabilityCheck: async () => true,
    });
    const ctx = baseCtx({
      env: {
        ...HMAC_ENV,
        CVDIAG_AB_INTERNAL_URL:
          "http://langgraph-python.railway.internal:8123/ok",
      },
      // Internal arm returns 200 → ok.
      fetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });
    const result = await driver.run(ctx, {
      key: "e2e-smoke:langgraph-python",
      backendUrl: "https://showcase-lgp.example.com",
    });
    // The probe's own outcome is unaffected by the A/B.
    expect(result.state).toBe("green");
    // Both arms collected, sharing one ab_pair_id.
    expect(collected).toHaveLength(2);
    const pairIds = new Set(collected.map((r) => r.ab_pair_id));
    expect(pairIds.size).toBe(1);
    const arms = new Set(collected.map((r) => r.arm));
    expect(arms).toEqual(new Set(["edge", "internal"]));
    // Feed the report engine: edge green + internal ok → agree.
    const report = computeAbReport(collected);
    expect(report.total_pairs).toBe(1);
    expect(report.pairs[0]!.divergence).toBe("agree");
  });

  // FIX 1 (M7c): the edge A/B record must compute edge_interference_signal from
  // the REAL L3-captured edge response headers, NOT an empty bag. Pre-fix the
  // driver passed `filterEdgeHeaders({})`, structurally pinning the signal to
  // `false` so edge interference could NEVER be detected. This drives an
  // interference-carrying (cf-mitigated) message-POST edge response through the
  // real probe with the A/B arm gated ON and asserts the collected edge
  // record's signal is computed from those headers (true).
  it("edge A/B record computes edge_interference_signal from REAL captured edge headers (FIX 1)", async () => {
    const collected: AbOutcomeRecord[] = [];
    const browser = makeCvBrowser({
      assistantText: "Hi!",
      // PRODUCTION ordering: the message-POST response (carrying the
      // cf-mitigated edge header) arrives AFTER press("Enter") returns.
      responsesAfterSubmit: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "cf-mitigated": "challenge", "content-length": "3" },
          contentLength: 3,
          durationMs: 5,
          isMessagePost: true,
        },
      ],
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      abCollector: { collect: (r) => collected.push(r) },
      abReachabilityCheck: async () => true,
    });
    const ctx = baseCtx({
      env: {
        ...HMAC_ENV,
        CVDIAG_AB_INTERNAL_URL:
          "http://langgraph-python.railway.internal:8123/ok",
      },
      fetchImpl: (async () =>
        new Response("", { status: 200 })) as unknown as typeof fetch,
    });
    await driver.run(ctx, {
      key: "e2e-smoke:langgraph-python",
      backendUrl: "https://x.example.com",
      demos: ["agentic-chat"],
    });
    const edge = collected.find((r) => r.arm === "edge");
    expect(edge).toBeDefined();
    // RED (pre-fix, empty-headers bag): false. GREEN (real cf-mitigated
    // header surfaced from L3): true.
    expect(edge!.edge_interference_signal).toBe(true);
  });

  // FIX 2 (M7c): when the internal arm returns null (the documented common
  // case off-platform / CI / unreachable / unset-secret / verify-fail), the
  // driver must NOT emit a lone edge A/B record — an orphan half-pair the
  // report cannot diff against any internal sibling. Pre-fix the edge record
  // was collected BEFORE the internal arm ran, so a null internal arm left an
  // orphan edge half-pair behind.
  it("driver emits NO orphan edge half-pair when the internal arm is absent (FIX 2)", async () => {
    const collected: AbOutcomeRecord[] = [];
    const { browser } = makeBrowser([{ assistantText: "Hi!" }]);
    const driver = createE2eSmokeDriver({
      launcher: async () => browser,
      abCollector: { collect: (r) => collected.push(r) },
      // Internal arm is UNREACHABLE → runInternalAbArm returns null.
      abReachabilityCheck: async () => false,
    });
    const ctx = baseCtx({
      env: {
        ...HMAC_ENV,
        CVDIAG_AB_INTERNAL_URL:
          "http://langgraph-python.railway.internal:8123/ok",
      },
    });
    const result = await driver.run(ctx, {
      key: "e2e-smoke:langgraph-python",
      backendUrl: "https://showcase-lgp.example.com",
    });
    // The probe's own outcome is unaffected by the A/B.
    expect(result.state).toBe("green");
    // RED (pre-fix): one lone edge orphan was collected. GREEN: nothing —
    // no internal sibling means no half-pair is emitted.
    expect(collected).toEqual([]);
  });
});

describe("d4 CVDIAG cross-layer join: probe adopts the forwarded X-Test-Id", () => {
  function bufDir(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-test-"));
  }

  // ── leg 3: probe records the SAME forwarded X-Test-Id the backend adopts ───
  it("probe cvdiag test_id == sanitizeJoinTestId(forwarded X-Test-Id), NOT a fresh UUIDv7, so probe↔backend rows join", async () => {
    // The probe forwards a per-run id (`d6-<slug>-<runId>` / `d4-<slug>-<runId>`)
    // as the `X-Test-Id` request header. The backend (this branch) ADOPTS that
    // inbound header verbatim, normalizing it via `sanitizeJoinTestId`, as its
    // cvdiag `test_id` — the cross-layer join key (spec §5).
    //
    // RED (pre-fix): `CvdiagProbeSession` re-minted a RANDOM UUIDv7 for its own
    // cvdiag `test_id` (the forwarded id is not a UUIDv7, so the constructor's
    // `isValidTestId(opts.testId) ? opts.testId : mintTestId()` fell through to
    // a fresh mint). Result: probe.* rows carried a UUIDv7 that NEVER equals the
    // backend's adopted/sanitized id → the join did not close.
    //
    // GREEN (post-fix): the session records `sanitizeJoinTestId(forwardedId)` —
    // the EXACT value the backend derives from the same inbound header — so both
    // sides share one `test_id`.
    const forwarded = "d6-built-in-agent-run-ABC";
    // The value the BACKEND adopts from the same inbound header. Mirroring the
    // backend's sanitize here makes the cross-layer match provable from the
    // probe side alone.
    const backendAdopted = sanitizeJoinTestId(forwarded);
    expect(backendAdopted).not.toBeNull();

    const writer = new CaptureWriter();
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "probe",
      pbWriter: writer,
    });
    const session = new CvdiagProbeSession({
      emitter,
      // The forwarded X-Test-Id — exactly what the driver passes to both the
      // request header AND this session (see runLevel: testId is the per-level
      // X-Test-Id, and the same value is set as the `X-Test-Id` request header).
      testId: forwarded,
      slug: "built-in",
      demo: "agentic-chat",
      bufferDir: bufDir(),
      nowMs: 0,
    });
    // Drive an open/close pair so at least two probe.* rows are emitted.
    session.start("https://x.example.com/demos/agentic-chat", {
      width: 1280,
      height: 720,
    });
    session.exit("ok", 1);
    await emitter.flush();

    const rows = writer.events;
    expect(rows.length).toBeGreaterThan(0);
    // EVERY probe.* row carries the SAME test_id (the session's resolved id).
    const ids = new Set(rows.map((e) => e.test_id));
    expect(ids.size).toBe(1);
    const probeTestId = [...ids][0]!;
    // The crux: the probe's cvdiag test_id is the backend-adopted/sanitized
    // forwarded id — NOT a fresh random UUIDv7 — so the cross-layer join closes.
    expect(probeTestId).toBe(backendAdopted);
    // And the session's resolvedTestId (used by raw-byte samples) agrees, so the
    // intra-layer raw-byte↔events join is preserved while the cross-layer join
    // now also closes.
    expect(session.resolvedTestId).toBe(backendAdopted);
  });
});

// --- First-token wait hardening (client-side race) -----------------------
//
// REGRESSION SURFACE: D4's L4 "tools" probe reads the assistant-message
// container's textContent by polling for up to `textPollTimeoutMs`. On a run
// where the FIRST token renders into the DOM slightly LATER than that poll
// budget — but the agent turn genuinely produces content (SSE RUN_STARTED →
// RUN_FINISHED) — the pre-fix poll loop exhausted its fixed budget and read
// the container as empty, yielding a spurious "L4: empty assistant response"
// red. The turn was NOT empty; the assertion just fired before the first
// token had a chance to arrive. The hardening waits on the SSE turn-complete
// signal (RUN_FINISHED / RUN_ERROR) plus a bounded first-token grace window,
// so a late-but-present first token is captured, while a turn that genuinely
// completes with NO content still fails.

/**
 * A fake page modelling the late-first-token race with REAL wall-clock timing
 * (no fake timers), driven off the PRODUCTION signal — `readTurnState()`, the
 * `attachSseInterceptor` page-side turn-lifecycle globals — NOT the never-wired
 * `onSseEvent` Node seam the prior (inert) fix used.
 *
 * Timeline modelled relative to the most-recent send (`press`):
 *   - the DOM assistant-text read (`evaluate`) returns "" until
 *     `firstTokenDelayMs` has elapsed since the send, then `assistantText`.
 *   - `readTurnState()` reports the turn COMPLETE at `completeAtDelayMs` after
 *     the send (DOM run-stop edge + `runsFinished` bump), UNLESS
 *     `neverComplete` is set (models a stalled/dropped stream that never
 *     signals completion — the retry surface).
 *   - `retrySucceeds`: when set with `neverComplete`, the FIRST attempt never
 *     completes and stays empty; after a resend (`press` fires again) the turn
 *     completes and `assistantText` renders — modelling a recoverable stall
 *     that the non-completion retry rescues.
 *
 * Setting `textPollTimeoutMs` BELOW `firstTokenDelayMs` reproduces the pre-fix
 * race deterministically.
 */
function makeLateTokenBrowser(opts: {
  assistantText: string;
  firstTokenDelayMs: number;
  /** Delay (ms after send) at which readTurnState reports turn-complete. */
  completeAtDelayMs?: number;
  /** Model a stall: the turn NEVER signals completion (retry surface). */
  neverComplete?: boolean;
  /** With neverComplete: a resend (2nd attempt) rescues the turn. */
  retrySucceeds?: boolean;
  /**
   * Count of PRIOR finished runs already latched on the page BEFORE the user's
   * turn starts (auto-greeting / initial-mount run). The page-side globals are
   * MONOTONIC, so `runsFinished` and `runStartCount` both start at this value
   * and the current turn only bumps them PAST it. This reproduces the a1
   * attempt-scoping bug: keying completion off the page-global `runsFinished
   * >= 1` false-reds the in-flight user turn because a prior run already
   * satisfied `>= 1`.
   */
  priorFinishedRuns?: number;
  /** Report the interceptor as having failed to attach (finding-3 surface). */
  sseAttachFailed?: boolean;
  /**
   * Model the DEGRADED path (item-2 follow-up): the interceptor silently
   * no-op'd, so `readTurnState` reports `sseAttachFailed: true` AND — because the
   * page-side turn-lifecycle globals were NEVER seeded — every counter stays at
   * its zero/absent baseline (`runsFinished: 0`, `runStartCount: 0`,
   * `attrPresent: false`, `sawRunningTrue: false`, `runningNow: null`). No
   * completion signal will ever arrive, so the driver's poll can only ever fall
   * into the never-observed branch. The DOM token still renders late (via
   * `evaluate`, gated on `firstTokenDelayMs`), reproducing a slow-first-token
   * turn on a page whose interceptor failed to attach — the exact false-red
   * surface the degraded-path widening fixes.
   */
  degradedNoSignal?: boolean;
  /**
   * Model a mid-poll `readTurnState()` REJECTION (harmonization surface): every
   * `readTurnState()` call THROWS instead of returning a snapshot. Distinct from
   * `degradedNoSignal` (which returns a well-formed degraded snapshot) — this is
   * the page/launcher whose read itself rejects (a transient read fault, a page
   * mid-navigation). Pre-fix, `readBaseline`/`readTurnComplete` called it
   * UNGUARDED (the throw escaped → spurious `level-error`) while `readDegraded`
   * swallowed it to `false` (silent base-floor fast-fail). The `safeReadTurnState`
   * wrapper harmonizes all three: a throw → degraded WIDEN + observable telemetry,
   * never a spurious red. The DOM token still renders late (via `evaluate`) so a
   * late-but-present token on a read-throwing page can be exercised.
   */
  throwFromReadTurnState?: boolean;
  /**
   * Model item-1 (budget-exhaustion retry guard): when set, `type`/`press`
   * THROW if their `timeout` option is at or below this many ms — mirroring
   * Playwright, which rejects a ~1ms action timeout. Combined with
   * `neverComplete` (attempt 1 stalls, forcing a retry) and a `pageTimeoutMs`
   * tuned so the retry resend fires with the budget all but drained, this
   * reproduces the pre-fix 1ms-timeout `level-error` flap: the guarded driver
   * must SKIP the doomed resend rather than emit a misleading level-error.
   */
  throwWhenTimeoutAtMost?: number;
  /**
   * Model item-1 FIRST-SEND cap: the FIRST `type` action AWAITS this many ms
   * before returning (a near-hang first-send `type`), draining the first-token
   * envelope so the following `press`'s remaining budget drops below
   * `RETRY_MIN_BUDGET_MS`. Pre-fix `sendTurn` then floored `press`'s timeout to
   * ~1ms — which (with `throwWhenTimeoutAtMost`) Playwright rejects, caught as a
   * generic `level-error` spurious red. Post-fix the first-send min-budget guard
   * throws a DISTINCTLY-classified `SendBudgetExhaustedError`
   * (`errorDesc: send-budget-exhausted`) instead of issuing the doomed ~1ms
   * `press`. Applies to the first `type` only (subsequent resends are covered by
   * the existing `RETRY_MIN_BUDGET_MS` retry guard).
   */
  firstTypeDelayMs?: number;
  /**
   * Model an SSE-ONLY completion: the turn completes via the `runsFinished`
   * transport counter bumping past baseline, but NO fresh DOM `true→false`
   * stop-edge fires for THIS turn, so `lastStoppedAtMs` keeps holding a STALE
   * PRIOR-run page-clock value (never re-stamped for the current turn). This
   * reproduces the grace-window-collapse bug: the pre-fix poll stamps
   * `completeAtMs` from that stale past `lastStoppedAtMs`, so `graceEnd` lands
   * in the past and the grace window collapses to the base floor → a
   * late-but-present first token false-reds. Requires `priorFinishedRuns >= 1`
   * so a genuinely-stale prior stamp exists.
   */
  sseOnlyStaleStop?: boolean;
  /**
   * Age the prior-run stop stamp (`lastStoppedAtMs`) this many ms into the past.
   * With `sseOnlyStaleStop`, makes the stale stamp genuinely old so a pre-fix
   * `graceEnd = staleStop + FIRST_TOKEN_GRACE_MS` lands in the past.
   */
  priorStoppedAgoMs?: number;
  /** Callback invoked with the sendCount on each send (retry-count assertions). */
  onSend?: (sendCount: number) => void;
  /**
   * Callback invoked at the START of every `type` action (before it may throw),
   * with the running count of type ATTEMPTS. Counts resend ATTEMPTS even when
   * the action then throws on a floored timeout — the discriminator for the
   * budget-exhaustion guard (a skipped resend never attempts `type` a 2nd time).
   */
  onTypeAttempt?: (typeCount: number) => void;
  /**
   * Item-3 (telemetry re-capture): per-send agent-message-POST responses driven
   * into the wired `onResponse` seam. Index N is delivered when the Nth `press`
   * (send) fires, modelling each attempt's OWN message-POST response landing
   * after its submit. Lets a retry-rescued run give attempt 0 (stalled) and
   * attempt 1 (winning) DISTINCT edge headers so a test can assert
   * `probe.message.send` re-captures the WINNING attempt's headers rather than
   * staying latched to the stalled first attempt.
   */
  responsesPerSend?: CvdiagResponseEvent[];
}): CvE2eBrowser {
  const completeAt = opts.completeAtDelayMs ?? 0;
  const prior = opts.priorFinishedRuns ?? 0;
  // PER-PAGE state factory. Real Playwright hands each `newContext().newPage()`
  // an INDEPENDENT page; the driver opens a FRESH context+page per level (L3
  // then L4). A single shared `page` singleton leaked `sendCount` /
  // `lastSendAtMs` / `respHandler` from L3 into L4, so L4's per-attempt baseline
  // was polluted by L3's send and the L4 retry/completion path was never
  // genuinely exercised in isolation. Minting fresh state per `newPage()` keeps
  // each level's turn-lifecycle clean, faithful to production.
  const makeLateTokenPage = (): CvE2ePage => {
    let lastSendAtMs = 0;
    let sendCount = 0;
    let typeCount = 0;
    let respHandler: ((r: CvdiagResponseEvent) => void) | undefined;
    // Realistic wall-clock ms for the PRIOR run's stop edge. Normally captured
    // at page construction (just before the user turn); `priorStoppedAgoMs` ages
    // it further into the past to model a prior run that finished well before the
    // current turn — so a pre-fix poll that (wrongly) stamps the grace window
    // from this STALE value computes a `graceEnd` that has already elapsed,
    // collapsing the grace window to the base floor.
    const priorStoppedAtMs = Date.now() - (opts.priorStoppedAgoMs ?? 0);
    const page: CvE2ePage = {
      async goto() {
        return null;
      },
      async type(_sel: string, _text: string, o?: { timeout?: number }) {
        typeCount += 1;
        opts.onTypeAttempt?.(typeCount);
        // Item-1 FIRST-SEND cap: the first `type` near-hangs, consuming
        // wall-clock so the following `press`'s remaining budget drains below
        // the min-budget floor. Only the FIRST type (attempt 0) — resends are
        // covered by the retry budget guard.
        if (
          opts.firstTypeDelayMs !== undefined &&
          typeCount === 1 &&
          opts.firstTypeDelayMs > 0
        ) {
          await new Promise((r) => setTimeout(r, opts.firstTypeDelayMs));
        }
        // Item-1 surface: Playwright rejects a near-zero action timeout. Model it
        // so a retry resend that runs with a drained budget (floored to ~1ms)
        // throws — the pre-fix path that mis-classified as `level-error`.
        if (
          opts.throwWhenTimeoutAtMost !== undefined &&
          o?.timeout !== undefined &&
          o.timeout <= opts.throwWhenTimeoutAtMost
        ) {
          throw new Error(
            `page.type: Timeout ${o.timeout}ms exceeded waiting for selector "textarea"`,
          );
        }
      },
      async press(_sel: string, _key: string, o?: { timeout?: number }) {
        if (
          opts.throwWhenTimeoutAtMost !== undefined &&
          o?.timeout !== undefined &&
          o.timeout <= opts.throwWhenTimeoutAtMost
        ) {
          throw new Error(
            `page.press: Timeout ${o.timeout}ms exceeded waiting for selector "textarea"`,
          );
        }
        // Each Enter is one turn send; the timeline is relative to the LATEST
        // send so a resend restarts the first-token / completion clocks.
        lastSendAtMs = Date.now();
        sendCount += 1;
        opts.onSend?.(sendCount);
        // Item-3: deliver THIS send's own agent-message-POST response into the
        // wired onResponse seam (models each attempt's response landing after its
        // submit) so a retry-rescued run can re-capture the winning attempt's
        // edge headers.
        const perSend = opts.responsesPerSend?.[sendCount - 1];
        if (perSend !== undefined) respHandler?.(perSend);
      },
      async waitForSelector() {},
      async textContent() {
        return "";
      },
      async evaluate<R>(): Promise<R> {
        // The assistant-text poll and the alternate-content histogram read both
        // route through evaluate(). A record return is the histogram read
        // (post-empty-exit) — return {} harmlessly. A string return is the
        // assistant-text poll.
        const elapsed = Date.now() - lastSendAtMs;
        const rescued = opts.retrySucceeds === true && sendCount >= 2;
        const tokenVisible =
          opts.assistantText.length > 0 &&
          elapsed >= opts.firstTokenDelayMs &&
          // A never-completing (unrescued) turn also never renders its token.
          (!opts.neverComplete || rescued);
        if (tokenVisible) {
          return opts.assistantText as unknown as R;
        }
        return "" as unknown as R;
      },
      async readTurnState() {
        // HARMONIZATION surface: the read itself REJECTS mid-poll (transient
        // read fault / page mid-navigation). Every consumer must route through
        // `safeReadTurnState` so this throw becomes a degraded-widen, never a
        // spurious `level-error` (unguarded escape) or a silent base-floor
        // fast-fail (swallowed to `false`).
        if (opts.throwFromReadTurnState === true) {
          throw new Error("readTurnState: page evaluate rejected mid-poll");
        }
        // DEGRADED path (item-2): the interceptor no-op'd, so the page-side
        // globals were NEVER seeded — every counter stays at its zero/absent
        // baseline and `sseAttachFailed` rides true. No completion signal ever
        // arrives; only the DOM token (via `evaluate`) eventually renders.
        if (opts.degradedNoSignal === true) {
          return {
            runsFinished: 0,
            attrPresent: false,
            sawRunningTrue: false,
            runningNow: null,
            runStartCount: 0,
            lastStoppedAtMs: 0,
            sseAttachFailed: true,
          };
        }
        // MONOTONIC page-global counters (they only ever grow, exactly like the
        // real `attachSseInterceptor` globals). `prior` runs already latched
        // before the user's FIRST turn. Every send starts one run
        // (`runStartCount = prior + sendCount`). All PRIOR sends' turns are done;
        // the CURRENT (latest) turn is done once `complete`
        // (`runsFinished = prior + (sendCount - 1) + (complete ? 1 : 0)`). This is
        // what lets a shared page survive L3→L4 (two sequential sends) with the
        // per-attempt baseline correctly scoping completion to each turn.
        const started = sendCount > 0;
        const priorSendsDone = Math.max(0, sendCount - 1);
        const elapsed = Date.now() - lastSendAtMs;
        const rescued = opts.retrySucceeds === true && sendCount >= 2;
        // Completion is a property of the CURRENT (in-flight) turn — it can only be
        // true once a turn has actually been sent (`started`). Before the first
        // send, `lastSendAtMs === 0` makes `elapsed` (≈ epoch ms) spuriously exceed
        // `completeAt`, which used to flip `complete` true at the pre-send BASELINE
        // read the driver takes before `sendTurn()`. That inflated the baseline
        // `runsFinished` to `prior + 1`, so the current turn's real finished edge
        // (`prior + priorSendsDone + 1`) never rose PAST the baseline and the
        // driver's `sseDone = runsFinished > baseline.runsFinished` could never
        // fire — leaving the SSE-only-stale-grace path (which depends on `sseDone`)
        // untested. Gating on `started` makes the baseline read a true baseline
        // (`runsFinished = prior + priorSendsDone`, no current-turn finish) so the
        // finished edge is a genuine THIS-turn transition the driver observes.
        const complete =
          started && (!opts.neverComplete || rescued) && elapsed >= completeAt;
        // SSE-only completion: the transport `runsFinished` counter bumps but the
        // DOM run-lifecycle attribute never registers a fresh `true→false` stop
        // edge for THIS turn, so `runningNow` stays `true` and `lastStoppedAtMs`
        // is NEVER re-stamped — it keeps holding the STALE prior-run value.
        const sseOnly = opts.sseOnlyStaleStop === true;
        const runningNow = started
          ? sseOnly
            ? true
            : !complete
          : prior > 0
            ? false
            : null;
        return {
          runsFinished: prior + priorSendsDone + (complete ? 1 : 0),
          attrPresent: true,
          sawRunningTrue: prior > 0 || started,
          runningNow,
          runStartCount: prior + sendCount,
          // Current turn complete → stamp NOW; else the most-recent stop is a
          // prior run's (a real past timestamp) when any prior run has finished.
          // SSE-only: no fresh DOM stop edge fires, so the stamp STAYS stale.
          lastStoppedAtMs:
            complete && !sseOnly
              ? Date.now()
              : prior > 0 || priorSendsDone > 0
                ? priorStoppedAtMs
                : 0,
          sseAttachFailed: opts.sseAttachFailed === true,
        };
      },
      async close() {},
      onResponse(h) {
        respHandler = h;
      },
    };
    return page;
  };
  return {
    async newContext() {
      // Fresh, independent page per context (mirrors Playwright) — no
      // cross-level state leak.
      const page = makeLateTokenPage();
      const ctx: CvE2eBrowserContext = {
        async newPage() {
          return page;
        },
        async close() {},
      };
      return ctx;
    },
    async close() {},
  };
}

/** Run the driver against a late-token browser and return the L4 result. */
async function runLateToken(
  browser: CvE2eBrowser,
  overrides: { pageTimeoutMs?: number } = {},
): Promise<{
  l4State: string;
  failureSummary: string;
}> {
  const writer = new CapturingWriter();
  const driver = createE2eSmokeDriver({
    launcher: async () => browser as unknown as E2eBrowser,
    // Below the 300ms first-token delay in the tests → pre-fix poll exhausts.
    textPollTimeoutMs: 120,
    // Bounded ceiling for the signal-based wait — plenty above the delay.
    pageTimeoutMs: overrides.pageTimeoutMs ?? 4000,
  });
  await driver.run(baseCtx({ writer }), {
    key: "e2e-smoke:foo",
    backendUrl: "https://x.example.com",
    demos: ["tool-rendering"],
  });
  const l4 = writer.results.find((r) => r.key === "tools:foo");
  const signal = (l4?.signal ?? {}) as { failureSummary?: string };
  return {
    l4State: String(l4?.state ?? "missing"),
    failureSummary: signal.failureSummary ?? "",
  };
}

/**
 * Run the driver against a late-token browser and return the L3 (chat) result.
 * L3 uses the `agentic-chat` demo (no `tool-rendering`), so the aggregate green
 * requires only the chat round-trip. Exercises the SAME first-token poll /
 * grace / fast-fail / retry path as L4 but on the L3 level (which was
 * previously test-covered only at L4).
 */
async function runLateTokenL3(
  browser: CvE2eBrowser,
  overrides: { pageTimeoutMs?: number } = {},
): Promise<{
  l3State: string;
  failureSummary: string;
}> {
  const writer = new CapturingWriter();
  const driver = createE2eSmokeDriver({
    launcher: async () => browser as unknown as E2eBrowser,
    textPollTimeoutMs: 120,
    pageTimeoutMs: overrides.pageTimeoutMs ?? 4000,
  });
  await driver.run(baseCtx({ writer }), {
    key: "e2e-smoke:foo",
    backendUrl: "https://x.example.com",
    // No tool-rendering demo → L4 skipped, aggregate green iff L3 green.
    demos: [],
  });
  const l3 = writer.results.find((r) => r.key === "chat:foo");
  const signal = (l3?.signal ?? {}) as { failureSummary?: string };
  return {
    l3State: String(l3?.state ?? "missing"),
    failureSummary: signal.failureSummary ?? "",
  };
}

describe("d4 L4 first-token wait hardening (readTurnState-driven)", () => {
  it("late-but-present first token (turn completes, token renders after textPollTimeoutMs) PASSES", async () => {
    // The turn genuinely produces content — readTurnState reports complete —
    // but the first DOM token renders at 300ms, AFTER the 120ms poll budget.
    // Pre-fix: RED ("empty assistant response"). Post-fix: GREEN. Exercises the
    // REAL production signal (readTurnState), not the dead onSseEvent seam.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "The weather in San Francisco is sunny, 72 degrees.",
        firstTokenDelayMs: 300,
        completeAtDelayMs: 250,
      }),
    );
    expect(l4State).toBe("green");
    expect(failureSummary).toBe("");
  });

  it("genuinely-empty completed turn (completes, no content ever) still FAILS", async () => {
    // Guard against over-correcting into a false-PASS: a turn that completes
    // but never renders any assistant content must still be a red "empty
    // assistant response", even after the grace window. NOT retried (completed
    // ≠ transient).
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "",
        firstTokenDelayMs: 300,
        completeAtDelayMs: 50,
      }),
    );
    expect(l4State).toBe("red");
    expect(failureSummary).toContain("empty assistant response");
  });

  it("recoverable stall (never completes on attempt 1, rescued on retry) PASSES", async () => {
    // The real 20:16:52Z failure shape: the first turn stalls — never signals
    // completion, never renders — so the poll exhausts its attempt ceiling
    // WITHOUT a completed edge. The non-completion retry resends, and the
    // second turn renders content → GREEN. Distinguishes "never-completed"
    // (transient, retry) from "completed-empty" (real red, no retry).
    // With the per-page state fix, L3 (agentic-chat) AND L4 (tool-rendering) each
    // run their OWN independent stall+retry cycle on a FRESH page, so the whole
    // run exercises both levels' retry paths genuinely (no shared sendCount
    // short-circuit). `pageTimeoutMs` must be generous enough that a legitimate
    // retry still clears the budget-exhaustion guard (item-1,
    // `RETRY_MIN_BUDGET_MS` = 750ms) after attempt 0 burns roughly half the
    // envelope — a too-tight budget would make the guard (correctly) skip the
    // resend and the rescue would never fire.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "The weather in San Francisco is sunny, 72 degrees.",
        firstTokenDelayMs: 100,
        neverComplete: true,
        retrySucceeds: true,
      }),
      { pageTimeoutMs: 4000 },
    );
    expect(l4State).toBe("green");
    expect(failureSummary).toBe("");
  }, 20000);

  it("permanent stall (never completes, retry also stalls) FAILS", async () => {
    // A turn that never completes and never renders even after the retry is a
    // red — but the retry was attempted (transient hypothesis exhausted). Two
    // attempts × the per-attempt ceiling → keep pageTimeoutMs small so the
    // whole envelope stays well under the vitest per-test timeout.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "",
        firstTokenDelayMs: 100,
        neverComplete: true,
      }),
      { pageTimeoutMs: 1500 },
    );
    expect(l4State).toBe("red");
    expect(failureSummary).toContain("empty assistant response");
  }, 10000);

  it("a1 REGRESSION: a PRIOR finished run + still-in-flight user turn does NOT false-red", async () => {
    // The dominant a1 bug: the page already has a PRIOR finished run
    // (auto-greeting / initial-mount run) so the page-GLOBAL monotonic
    // `runsFinished` is already >= 1 when the user's turn starts. The pre-fix
    // poll keyed completion off `runsFinished >= 1`, so it thought THIS turn had
    // already completed the instant it began, saw the still-empty container, and
    // FAST-FAILED red — even though the user's turn was healthily in-flight and
    // renders its token shortly after.
    //
    // With attempt-scoped completion (baseline captured at send time; complete
    // only on a NEW edge past the baseline), the prior run's latched counter no
    // longer satisfies THIS turn, the poll correctly waits for the real
    // first-token, and the turn is GREEN.
    //
    // The token renders at 2400ms — PAST the ~2000ms grace window the pre-fix
    // code stamps from its (false) turn-start "completion". Pre-fix: the prior
    // run makes `runsFinished >= 1` true immediately, completion is stamped at
    // ~send time, the grace window elapses at ~2000ms with the DOM still empty,
    // and the poll REDS ("empty assistant response") before the real 2400ms
    // token. Post-fix: baseline scoping means the prior run does NOT count, the
    // turn is correctly treated as in-flight, the poll waits to its ceiling, and
    // the 2400ms token is captured → GREEN. The turn genuinely completes at
    // 2300ms (just before the token) so no retry-stall.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "The weather in San Francisco is sunny, 72 degrees.",
        firstTokenDelayMs: 2400,
        completeAtDelayMs: 2300,
        priorFinishedRuns: 1,
      }),
      { pageTimeoutMs: 8000 },
    );
    expect(l4State).toBe("green");
    expect(failureSummary).toBe("");
  }, 15000);

  it("SSE-only completion with a STALE lastStoppedAtMs does NOT collapse the grace window (late-but-present token) → GREEN", async () => {
    // Grace-window-collapse bug: the turn completes via the transport
    // `runsFinished` counter (SSE-only) but NO fresh DOM stop-edge fires for
    // THIS turn, so the page-side `lastStoppedAtMs` still holds a STALE prior-run
    // timestamp (here aged 5s into the past). The pre-fix poll stamped
    // `completeAtMs` from that stale `lastStoppedAtMs`, so
    // `graceEnd = staleStop + FIRST_TOKEN_GRACE_MS` landed ~3s in the PAST — the
    // ~2s grace window collapsed to the base poll floor, and the poll declared
    // the turn completed-empty BEFORE the real first token (1000ms after send,
    // 700ms after completion, comfortably inside a healthy grace window) → a
    // false RED. Post-fix stamps `completeAtMs` from the Node clock at the first
    // poll that observes completion, so the grace window measures forward from
    // real completion time and the late-but-present token is captured → GREEN.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "The weather in San Francisco is sunny, 72 degrees.",
        firstTokenDelayMs: 1000,
        completeAtDelayMs: 300,
        priorFinishedRuns: 1,
        sseOnlyStaleStop: true,
        priorStoppedAgoMs: 5000,
      }),
      { pageTimeoutMs: 8000 },
    );
    expect(l4State).toBe("green");
    expect(failureSummary).toBe("");
  }, 15000);

  it("a1 REGRESSION (L3): prior finished run + in-flight chat turn does NOT false-red", async () => {
    // Same a1 regression proven on the L3 (chat) level — the level that runs on
    // EVERY service (L4 is tool-rendering-only). Prior run latches the global
    // counter; the in-flight chat turn must still resolve GREEN once its token
    // renders.
    const { l3State, failureSummary } = await runLateTokenL3(
      makeLateTokenBrowser({
        assistantText: "Hi there! How can I help you today?",
        firstTokenDelayMs: 2400,
        completeAtDelayMs: 2300,
        priorFinishedRuns: 2,
      }),
      { pageTimeoutMs: 8000 },
    );
    expect(l3State).toBe("green");
    expect(failureSummary).toBe("");
  }, 15000);

  it("L3 (chat) late-but-present token: same grace path as L4 → GREEN", async () => {
    // L3 coverage for the grace/fast-fail path (was L4-tools-only). A chat turn
    // whose first token renders after the base poll floor still passes via the
    // completion+grace window.
    const { l3State, failureSummary } = await runLateTokenL3(
      makeLateTokenBrowser({
        assistantText: "A brief and friendly greeting.",
        firstTokenDelayMs: 300,
        completeAtDelayMs: 250,
      }),
    );
    expect(l3State).toBe("green");
    expect(failureSummary).toBe("");
  });

  it("completed-empty does exactly ONE send — fast-fail RED, retry does NOT fire (L3)", async () => {
    // A turn that COMPLETES with empty assistant text is a real red and is NOT
    // transient — the non-completion retry must not fire. L3 runs a SINGLE level
    // (no tool-rendering demo), so `sendCount` is unconfounded: assert exactly
    // one send, proving completed-empty short-circuits without a resend.
    let sends = 0;
    const { l3State, failureSummary } = await runLateTokenL3(
      makeLateTokenBrowser({
        assistantText: "",
        firstTokenDelayMs: 300,
        completeAtDelayMs: 50,
        onSend: (n) => {
          sends = n;
        },
      }),
    );
    expect(l3State).toBe("red");
    expect(failureSummary).toContain("empty assistant response");
    expect(sends).toBe(1);
  });

  it("L3 (chat) recoverable stall: rescued by non-completion retry → GREEN", async () => {
    // L3 coverage for the retry path — attempt 1 stalls (never completes),
    // resend rescues, second attempt renders content.
    const { l3State, failureSummary } = await runLateTokenL3(
      makeLateTokenBrowser({
        assistantText: "Recovered greeting after a retry.",
        firstTokenDelayMs: 100,
        neverComplete: true,
        retrySucceeds: true,
      }),
    );
    expect(l3State).toBe("green");
    expect(failureSummary).toBe("");
  });

  // ── ITEM 2 (follow-up): degraded-path floor when interceptor no-ops ─────────
  it("degraded path (sseAttachFailed, no completion signal) with a late-but-present token → GREEN, not a base-floor false-red", async () => {
    // The interceptor silently no-op'd: `readTurnState` reports
    // `sseAttachFailed: true` and every turn-lifecycle counter stays at its
    // never-seeded baseline, so the poll can only ever fall into the
    // never-observed branch. The DOM token renders at 800ms — AFTER the base
    // poll floor's effective fast-fail (the ~500ms poll iteration at which
    // `now >= baseBudgetEnd(120ms)` first fires) but WELL WITHIN the 4000ms hard
    // ceiling. The 800ms delay is chosen so the base-floor deadline bites on a
    // poll iteration BEFORE the token is visible (the 500ms poll interval means a
    // 300ms token would be read at the 500ms poll regardless, masking the bug).
    //
    // RED (pre-fix): the never-observed branch pinned the deadline to the base
    // floor (`min(baseBudgetEnd=120ms, attemptCeiling)`), so the poll declared
    // the container empty at the ~500ms iteration and false-red'd —
    // reintroducing the exact slow-first-token false-red the main #5882 fix
    // targets, just gated behind a failed interceptor attach.
    // GREEN (post-fix): the degraded flag widens the never-observed wait to the
    // per-attempt ceiling, so the 800ms token is captured → GREEN.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "The weather in San Francisco is sunny, 72 degrees.",
        firstTokenDelayMs: 800,
        degradedNoSignal: true,
      }),
    );
    expect(l4State).toBe("green");
    expect(failureSummary).toBe("");
  });

  it("degraded path (sseAttachFailed) that produces NO content still FAILS (widening does not mask a genuine empty)", async () => {
    // Guard against over-correction: widening the degraded wait to the ceiling
    // must NOT convert a genuinely-empty degraded run into a false-pass. A page
    // whose interceptor no-op'd AND which never renders any token is a real red
    // — it just reds at the ceiling (no signal to fast-fail on) rather than the
    // base floor.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "",
        firstTokenDelayMs: 300,
        degradedNoSignal: true,
      }),
      { pageTimeoutMs: 800 },
    );
    expect(l4State).toBe("red");
    expect(failureSummary).toContain("empty assistant response");
  }, 10000);

  // ── (a) HARMONIZED readTurnState() error handling ───────────────────────────
  it("readTurnState() THROW mid-poll with a late-but-present token → GREEN (degraded widen), not a spurious level-error / base-floor false-red", async () => {
    // The page's `readTurnState()` REJECTS on every call (a transient read fault
    // / page mid-navigation). The DOM token still renders at 800ms — past the
    // 120ms base poll floor but well within the 4000ms hard ceiling.
    //
    // RED (pre-fix): `readBaseline` (unguarded) awaited `page.readTurnState()`
    // BEFORE the send; the rejection escaped, the driver's outer catch caught it,
    // and the level red'd as a generic `level-error` (a spurious red) — the token
    // was never even polled for. (Had baseline somehow survived, `readDegraded`
    // swallowed the throw to `false`, base-floor fast-failing at ~500ms before
    // the 800ms token — a silent false-red either way.)
    // GREEN (post-fix): `safeReadTurnState` turns the throw into a degraded
    // sentinel → `readDegraded` true → the never-observed wait WIDENS to the
    // ceiling, the 800ms token is captured → GREEN, and the fault is observable
    // (one-shot console.warn), never a silent/spurious red.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "The weather in San Francisco is sunny, 72 degrees.",
        firstTokenDelayMs: 800,
        throwFromReadTurnState: true,
      }),
    );
    expect(l4State).toBe("green");
    expect(failureSummary).toBe("");
  });

  it("readTurnState() THROW mid-poll that produces NO content still FAILS (degraded widen does not mask a genuine empty)", async () => {
    // Over-correction guard for the harmonization: a read-throwing page that
    // ALSO never renders any token is a real red. The throw routes onto the
    // degraded widen path (no base-floor fast-fail, no spurious level-error), so
    // it reds at the ceiling with the genuine "empty assistant response" — the
    // throw must not be masked into a false-PASS.
    const { l4State, failureSummary } = await runLateToken(
      makeLateTokenBrowser({
        assistantText: "",
        firstTokenDelayMs: 300,
        throwFromReadTurnState: true,
      }),
      { pageTimeoutMs: 800 },
    );
    expect(l4State).toBe("red");
    expect(failureSummary).toContain("empty assistant response");
  }, 10000);

  // ── ITEM 4 (#4): per-page state isolation exercises L4 retry independently ──
  it("L3 and L4 each run their OWN independent stall+retry on a fresh page (no shared-state leak)", async () => {
    // With the pre-fix SHARED page singleton, L3's sends leaked into L4:
    // `retrySucceeds` gates on `sendCount >= 2`, so after L3 stalled (send 1) and
    // retried (send 2), L4 reused the same page with `sendCount` already at 2 and
    // was rescued on its VERY FIRST send — L4's retry path was never genuinely
    // exercised (only 3 total sends). With per-page state, each level starts at
    // `sendCount = 0`, stalls on its own attempt 0, and rescues on its own retry
    // → 4 total sends (2 per level). The send count is the discriminator.
    let totalSends = 0;
    const writer = new CapturingWriter();
    const driver = createE2eSmokeDriver({
      launcher: async () =>
        makeLateTokenBrowser({
          assistantText: "The weather in San Francisco is sunny, 72 degrees.",
          firstTokenDelayMs: 100,
          neverComplete: true,
          retrySucceeds: true,
          onSend: () => {
            totalSends += 1;
          },
        }) as unknown as E2eBrowser,
      textPollTimeoutMs: 120,
      pageTimeoutMs: 4000,
    });
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      // Runs BOTH L3 (agentic-chat, always) and L4 (tool-rendering).
      demos: ["tool-rendering"],
    });
    expect(result.state).toBe("green");
    // Each level independently: attempt-0 stall (1 send) + retry rescue (1 send).
    // Pre-fix leak → 3 (L4 rescued on first send from L3's carried-over count).
    expect(totalSends).toBe(4);
  }, 20000);

  // ── ITEM 1 (follow-up): budget-exhaustion retry guard ───────────────────────
  it("near-exhausted-budget retry is SKIPPED — no doomed ~1ms-floored resend attempt", async () => {
    // Attempt 0 stalls (observed in-flight, never completes → the retry
    // surface). `textPollTimeoutMs == pageTimeoutMs == 500` (one poll interval):
    // attempt 0 polls to its per-attempt ceiling and the single 500ms poll
    // overrun drains essentially the whole envelope, so the retry (attempt 1)
    // would fire with the budget gone. The fake rejects any `type` whose action
    // timeout is <= 5ms — modelling Playwright's rejection of the ~1ms timeout
    // `sendTurn`'s `Math.max(1, hardCeiling - now)` produces once budget drains.
    //
    // RED (pre-fix): the retry loop unconditionally re-sent, so `sendTurn`
    // ATTEMPTED a second `type` with a ~1ms floored timeout — a doomed action
    // that throws a page-fault-shaped "Timeout 1ms exceeded…" error (swallowed
    // by the fallback into a misleading empty-red, a spurious-red flap source).
    // The discriminator is the resend ATTEMPT itself: pre-fix `type` is invoked
    // TWICE (attempt 0 + the doomed resend).
    // GREEN (post-fix): the budget-exhaustion guard skips the doomed resend
    // entirely, so `type` is invoked exactly ONCE and the stall reds cleanly on
    // its own terms ("empty assistant response") with no 1ms-timeout artifact.
    let typeAttempts = 0;
    const writer = new CapturingWriter();
    const driver = createE2eSmokeDriver({
      launcher: async () =>
        makeLateTokenBrowser({
          assistantText: "",
          firstTokenDelayMs: 100,
          neverComplete: true,
          throwWhenTimeoutAtMost: 5,
          onTypeAttempt: (n) => {
            typeAttempts = n;
          },
        }) as unknown as E2eBrowser,
      textPollTimeoutMs: 500,
      pageTimeoutMs: 500,
    });
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: [],
    });
    expect(result.state).toBe("red");
    const chat = writer.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("red");
    // The discriminator: the doomed ~1ms resend was NEVER attempted → `type`
    // fired exactly once (attempt 0). Pre-fix this is 2 (the doomed resend
    // attempts a second `type` before throwing on its floored timeout).
    expect(typeAttempts).toBe(1);
  }, 10000);

  it("FIRST-SEND cap: a near-hang first `type` does NOT floor `press` to ~1ms → classified send-budget-exhausted, not a generic level-error", async () => {
    // Item-1 first-send fold: the FIRST `type` near-hangs (awaits past the whole
    // 2000ms envelope), so by the time `press` is reached the remaining budget
    // has fully drained — below `RETRY_MIN_BUDGET_MS` (750ms) AND to the ~1ms
    // pre-fix floor. `pageTimeoutMs` (2000ms) exceeds `RETRY_MIN_BUDGET_MS` so the
    // FIRST `type` itself clears the guard (a fresh envelope) — only `press`,
    // reached after the hang, trips it. The fake rejects any `type`/`press` whose
    // action timeout is <= 5ms (Playwright's ~1ms rejection).
    //
    // RED (pre-fix): `sendTurn` floored `press`'s timeout to `Math.max(1,
    // hardCeiling - now)` ≈ 1ms; the fake threw a page-fault-shaped "Timeout 1ms
    // exceeded…", the driver's outer catch red-classified it as a GENERIC
    // `level-error` — a self-inflicted 1ms floor masquerading as a real page
    // fault (spurious-red flap).
    // GREEN (post-fix): the first-send min-budget guard throws a distinctly
    // classified `SendBudgetExhaustedError` BEFORE issuing the doomed `press`, so
    // the red carries `errorDesc: send-budget-exhausted` (observable + specific),
    // never the catch-all `level-error`.
    const writer = new CapturingWriter();
    const driver = createE2eSmokeDriver({
      launcher: async () =>
        makeLateTokenBrowser({
          assistantText: "",
          firstTokenDelayMs: 100,
          // First `type` eats the whole envelope so `press` drains below
          // RETRY_MIN_BUDGET_MS (750ms) and to the ~1ms pre-fix floor.
          firstTypeDelayMs: 2100,
          throwWhenTimeoutAtMost: 5,
        }) as unknown as E2eBrowser,
      textPollTimeoutMs: 2000,
      pageTimeoutMs: 2000,
    });
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: [],
    });
    expect(result.state).toBe("red");
    const chat = writer.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("red");
    const errorDesc = (chat?.signal as { errorDesc?: string } | undefined)
      ?.errorDesc;
    // The discriminator: a distinct, observable classification — NOT the generic
    // `level-error` a floored-1ms `press` throw produced pre-fix.
    expect(errorDesc).toBe("send-budget-exhausted");
  }, 10000);
});

describe("d4 mid-poll abort/timeout classification (follow-up)", () => {
  function bufDirAbort(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-abort-"));
  }

  it("mid-poll EXTERNAL abort with empty container → abort classification (errorDesc=abort, probe.exit=timeout), NOT content-red", async () => {
    // RED (pre-fix): the external `ctx.abortSignal` fires DURING the first-token
    // poll while the assistant container is still empty. `runAttempt` returns
    // empty text WITHOUT throwing, the retry loop breaks, and control falls to
    // the clean-exit path — where the level is misclassified as a generic
    // content red `failureSummary: "empty assistant response"` with `probe.exit`
    // outcome `err` and NO `errorDesc: "abort"`. That masquerades a teardown/
    // abort as a CONTENT failure on the dashboard + CVDIAG.
    //
    // GREEN (post-fix): the aborted-AND-empty run is short-circuited to the SAME
    // abort classification every other abort path uses — `errorDesc: "abort"`,
    // `probe.exit` outcome `timeout` — and is NOT the content-red "empty
    // assistant response".
    const { emitter, writer: cvWriter } = makeCvdiagEmitter();
    // neverComplete + a first-token delay well past the abort instant keeps the
    // poll spinning on an OBSERVED-but-incomplete empty turn, so the abort lands
    // mid-poll (the exact production gap). Generous pageTimeoutMs so the EXTERNAL
    // abort — not the driver hard-timeout — is what fires first.
    const browser = makeLateTokenBrowser({
      assistantText: "The weather in San Francisco is sunny, 72 degrees.",
      firstTokenDelayMs: 5000,
      neverComplete: true,
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 4000,
      pageTimeoutMs: 8000,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDirAbort(),
    });
    const resultWriter = new CapturingWriter();
    const ac = new AbortController();
    // Fire the external abort mid-poll (first poll iteration is ~500ms; abort at
    // 150ms lands squarely inside `runAttempt`'s loop while the container is
    // still empty).
    setTimeout(() => ac.abort(), 150);
    await driver.run(
      baseCtx({ writer: resultWriter, abortSignal: ac.signal }),
      {
        key: "e2e-smoke:foo",
        backendUrl: "https://x.example.com",
        demos: [],
      },
    );
    await emitter.flush();

    const chat = resultWriter.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("red");
    const sig = chat?.signal as
      | { failureSummary?: string; errorDesc?: string }
      | undefined;
    // Classified as an abort, NOT the generic content red.
    expect(sig?.errorDesc).toBe("abort");
    expect(sig?.failureSummary).not.toContain("empty assistant response");
    // probe.exit outcome is `timeout` (the abort/teardown classification every
    // other abort path uses), NOT `err` (the content-red classification).
    const exits = byBoundary(cvWriter, "probe.exit");
    expect(exits.length).toBeGreaterThan(0);
    expect(exits[0]!.metadata.terminal_outcome).toBe("timeout");
  }, 15000);

  it("OVER-CORRECTION GUARD: a genuinely-completed-EMPTY turn (NOT aborted) STAYS content-red 'empty assistant response'", async () => {
    // The discriminator is `abortSignal.aborted`, NOT emptiness alone. A turn
    // that actually FINISHES with no content — nothing aborted — is a real
    // content failure and must remain the content-red "empty assistant
    // response" with `probe.exit` outcome `err`. This proves the abort guard
    // does not over-correct genuine content reds into abort/timeout.
    const { emitter, writer: cvWriter } = makeCvdiagEmitter();
    const browser = makeLateTokenBrowser({
      assistantText: "",
      firstTokenDelayMs: 300,
      completeAtDelayMs: 50,
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 120,
      pageTimeoutMs: 4000,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDirAbort(),
    });
    const resultWriter = new CapturingWriter();
    // No abort signal fired — the turn completes empty on its own.
    await driver.run(baseCtx({ writer: resultWriter }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: [],
    });
    await emitter.flush();

    const chat = resultWriter.results.find((r) => r.key === "chat:foo");
    expect(chat?.state).toBe("red");
    const sig = chat?.signal as
      | { failureSummary?: string; errorDesc?: string }
      | undefined;
    // Stays the genuine content red — NOT reclassified as an abort.
    expect(sig?.failureSummary).toContain("empty assistant response");
    expect(sig?.errorDesc).not.toBe("abort");
    const exits = byBoundary(cvWriter, "probe.exit");
    expect(exits.length).toBeGreaterThan(0);
    expect(exits[0]!.metadata.terminal_outcome).toBe("err");
  }, 10000);
});

describe("d4 retry telemetry re-attribution (follow-up item 3)", () => {
  function bufDirLt(): string {
    return mkdtempSync(join(tmpdir(), "cvdiag-lt-"));
  }

  it("retry-rescued GREEN turn re-captures the WINNING attempt's edge headers for probe.message.send (not the stalled first attempt's)", async () => {
    // A stall on attempt 0 (never completes → retry), rescued by attempt 1. Each
    // attempt lands its OWN agent-message-POST response with DISTINCT edge
    // headers. The stalled attempt's response is the CopilotKit runtime POST
    // (isMessagePost) carrying `cf-mitigated: stalled`; the winning resend's
    // carries `cf-mitigated: winning`.
    //
    // RED (pre-fix): `messageSendEdge` / `lastMessagePostResp` latched to the
    // FIRST (stalled) attempt's response, and `emitMessageSend`'s idempotency
    // meant the winning resend's response never re-captured them — so
    // `probe.message.send` reported the STALLED attempt's `cf-mitigated:stalled`
    // header, mis-attributing edge_interference to the wrong turn.
    // GREEN (post-fix): the retry clears the latches before the resend, so the
    // winning attempt's response re-captures them → `probe.message.send` carries
    // `cf-mitigated: winning`.
    const writer = new CaptureWriter();
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "probe",
      pbWriter: writer,
    });
    const browser = makeLateTokenBrowser({
      assistantText: "Recovered greeting after a retry.",
      firstTokenDelayMs: 100,
      neverComplete: true,
      retrySucceeds: true,
      responsesPerSend: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "cf-mitigated": "stalled", "content-length": "5" },
          contentLength: 5,
          durationMs: 3,
          isMessagePost: true,
        },
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "cf-mitigated": "winning", "content-length": "9" },
          contentLength: 9,
          durationMs: 4,
          isMessagePost: true,
        },
      ],
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 120,
      pageTimeoutMs: 4000,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDirLt(),
    });
    const writerP = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer: writerP }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      // L3-only (agentic-chat) so the retry telemetry is unconfounded by an L4 level.
      demos: [],
    });
    await emitter.flush();
    expect(result.state).toBe("green");

    const send = byBoundary(writer, "probe.message.send");
    // Two real sends (stall + winning resend) → one message.send boundary per
    // send. Pre-fix the retry never re-armed the emit latch, so only the FIRST
    // (stalled) boundary was ever recorded (and the winning attempt's real edge
    // headers were lost). The re-capture fix re-arms the latch on retry, so the
    // winning resend records its OWN boundary.
    expect(send.length).toBe(2);
    // The FINAL (winning) boundary carries the winning attempt's edge headers,
    // NOT the stalled first attempt's — telemetry now attributed to the turn
    // that actually rendered content.
    expect(send[send.length - 1]!.edge_headers["cf-mitigated"]).toBe("winning");
    // And the stalled first attempt is still recorded on its own boundary
    // (nothing is silently dropped).
    expect(send[0]!.edge_headers["cf-mitigated"]).toBe("stalled");
  }, 15000);

  it("retry whose WINNING resend lands NO POST does NOT emit a second NULL-header probe.message.send (single correct attribution)", async () => {
    // Item-3 null-header double-boundary fold. Attempt 0 stalls (never completes
    // → retry) and lands a REAL agent-message POST (`cf-mitigated: real`). The
    // winning resend rescues (renders content → GREEN) but lands NO POST at all
    // (`responsesPerSend[1]` is absent).
    //
    // RED (pre-fix): the retry reset `messageSendEmitted = false` AND cleared
    // `messageSendEdge`, so the `finally`-block fallback `emitMessageSend()` fired
    // a SECOND `probe.message.send` boundary with NULL edge headers — a phantom
    // null-header turn that mis-attributes `edge_interference_signal`.
    // GREEN (post-fix): `messageSendRealPostEmitted` (set when the attempt-0 real
    // POST emitted) SUPPRESSES the null-header fallback, so exactly ONE boundary
    // survives — the real attempt-0 capture. No second null-header emit.
    const writer = new CaptureWriter();
    const emitter = new CvdiagEmitter({
      verbose: true,
      env: {},
      layer: "probe",
      pbWriter: writer,
    });
    const browser = makeLateTokenBrowser({
      assistantText: "Recovered greeting after a retry.",
      firstTokenDelayMs: 100,
      neverComplete: true,
      retrySucceeds: true,
      // Attempt 0 lands a real POST; the winning resend (index 1) lands NONE.
      responsesPerSend: [
        {
          url: "https://x.example.com/api/copilotkit",
          status: 200,
          headers: { "cf-mitigated": "real", "content-length": "5" },
          contentLength: 5,
          durationMs: 3,
          isMessagePost: true,
        },
      ],
    });
    const driver = createE2eSmokeDriver({
      launcher: async () => browser as unknown as E2eBrowser,
      textPollTimeoutMs: 120,
      pageTimeoutMs: 4000,
      cvdiagEmitter: emitter,
      cvdiagBufferDir: bufDirLt(),
    });
    const writerP = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer: writerP }), {
      key: "e2e-smoke:foo",
      backendUrl: "https://x.example.com",
      demos: [],
    });
    await emitter.flush();
    expect(result.state).toBe("green");

    const send = byBoundary(writer, "probe.message.send");
    // Exactly ONE boundary — the real attempt-0 capture. Pre-fix: 2 (the second a
    // spurious NULL-header emit from the finally fallback after the retry re-arm).
    expect(send.length).toBe(1);
    expect(send[0]!.edge_headers["cf-mitigated"]).toBe("real");
  }, 15000);
});

describe("wirePlaywrightPage attach-fault telemetry (finding 3)", () => {
  it("surfaces an interceptor-attach fault via onAttachFault AND readTurnState.sseAttachFailed (not silently swallowed)", async () => {
    // A failed `attachSseInterceptor` must degrade safely (navigation still
    // proceeds) BUT leave a distinguishable, observable signal — not the pre-fix
    // silent fall-back to the inert base-floor path. Assert both surfaces: the
    // injected `onAttachFault` callback fires with the error, AND
    // `readTurnState().sseAttachFailed` reads true.
    const faults: unknown[] = [];
    let gotoCalled = false;
    const rawPage = {
      goto: async () => {
        gotoCalled = true;
        return null;
      },
      type: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      textContent: async () => "",
      // The turn-lifecycle globals were never seeded (attach threw), so the
      // page-side read returns the zeroed defaults; sseAttachFailed rides on top.
      evaluate: async () => ({
        runsFinished: 0,
        attrPresent: false,
        sawRunningTrue: false,
        runningNow: null,
        runStartCount: 0,
        lastStoppedAtMs: 0,
      }),
      close: async () => {},
      on: () => {},
    };
    const wired = wirePlaywrightPage(
      rawPage as unknown as Parameters<typeof wirePlaywrightPage>[0],
      // attachInterceptor throws — the fault path under test.
      async () => {
        throw new Error("CDP session unavailable");
      },
      (err) => faults.push(err),
    );
    // Navigation must still proceed despite the attach fault (degrade safely).
    await wired.goto("https://x.example.com/demos/agentic-chat", {});
    expect(gotoCalled).toBe(true);
    // Fault surfaced through the telemetry callback.
    expect(faults).toHaveLength(1);
    expect((faults[0] as Error).message).toContain("CDP session unavailable");
    // AND observable programmatically via readTurnState.
    const st = await wired.readTurnState!();
    expect(st.sseAttachFailed).toBe(true);
  });

  it("does NOT flag sseAttachFailed when the interceptor attaches cleanly", async () => {
    const rawPage = {
      goto: async () => null,
      type: async () => {},
      press: async () => {},
      waitForSelector: async () => {},
      textContent: async () => "",
      evaluate: async () => ({
        runsFinished: 0,
        attrPresent: false,
        sawRunningTrue: false,
        runningNow: null,
        runStartCount: 0,
        lastStoppedAtMs: 0,
      }),
      close: async () => {},
      on: () => {},
    };
    const wired = wirePlaywrightPage(
      rawPage as unknown as Parameters<typeof wirePlaywrightPage>[0],
      async () => ({ stop: async () => ({}) }),
      () => {
        throw new Error("onAttachFault must not fire on clean attach");
      },
    );
    await wired.goto("https://x.example.com/demos/agentic-chat", {});
    const st = await wired.readTurnState!();
    expect(st.sseAttachFailed).toBe(false);
  });
});
