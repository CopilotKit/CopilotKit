import { describe, it, expect } from "vitest";
import {
  e2eSmokeDriver,
  createE2eSmokeDriver,
  type E2eBrowser,
  type E2eBrowserContext,
  type E2ePage,
  type E2eSmokeLevelSignal,
  type E2eSmokeSignal,
} from "./e2e-smoke.js";
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

describe("e2eSmokeDriver.inputSchema", () => {
  it("accepts { key, backendUrl, demos }", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e-smoke:foo",
      backendUrl: "https://example.com",
      demos: ["agentic-chat", "tool-rendering"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts omitted demos (no L4)", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e-smoke:foo",
      backendUrl: "https://example.com",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects empty key", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "",
      backendUrl: "https://example.com",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-URL backendUrl", () => {
    const parsed = e2eSmokeDriver.inputSchema.safeParse({
      key: "e2e-smoke:foo",
      backendUrl: "not-a-url",
    });
    expect(parsed.success).toBe(false);
  });
});

// --- L3 behaviour --------------------------------------------------------

describe("e2eSmokeDriver L3 (chat)", () => {
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
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
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

describe("e2eSmokeDriver L4 (tools)", () => {
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

describe("e2eSmokeDriver error paths", () => {
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
    const sig = result.signal as E2eSmokeSignal;
    expect(result.state).toBe("red");
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
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.failureSummary).toMatch(/ERR_CONNECTION_REFUSED/);
  });

  it("red with timeout errorDesc when driver hard-timeout fires during launch", async () => {
    // Hanging launcher: resolves only when its AbortSignal fires (which
    // it will, from the driver's hard-timeout). Ensures the driver maps
    // the abort into `errorDesc: "timeout"` rather than masquerading as
    // `launcher-error`. Tests the Procedure 0 fail-loud distinction
    // between "chromium missing" and "remote stack slow".
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
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.errorDesc).toBe("timeout");
    expect(sig.failureSummary).toMatch(/timeout after/);
  });
});

// --- Side-emit / writer plumbing ----------------------------------------

describe("e2eSmokeDriver side-emits", () => {
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

// --- Starter shape: skip L3/L4 ---------------------------------------
//
// Starters are single-app integrations deployed from showcase/starters/*;
// they mount at `/` with no `/demos/*` routing. Running L3/L4 against a
// starter would 404 the navigation step and produce false-red alerts on
// every tick. The driver must detect `shape === "starter"` (from the
// discovery source) and skip both levels with explicit `l3/l4: "skipped"`
// rather than silently producing a red page-error. This also avoids the
// registry-lookup path (starters aren't keyed in registry.json).

describe("e2eSmokeDriver starter shape", () => {
  it("aggregate green-skipped when shape='starter' — L3 and L4 both skipped", async () => {
    // The fake browser is never used, but we still wire it in to verify
    // the driver short-circuits BEFORE launching chromium (no newContext
    // calls, no pages opened).
    const { browser, state } = makeBrowser([]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const writer = new CapturingWriter();
    const result = await driver.run(baseCtx({ writer }), {
      key: "e2e-smoke:starter-ag2",
      name: "showcase-starter-ag2",
      backendUrl: "https://showcase-starter-ag2-production.up.railway.app",
      shape: "starter",
    });
    expect(result.state).toBe("green");
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("skipped");
    expect(sig.l4).toBe("skipped");
    // Zero chromium contexts opened — shape check happens before launch.
    expect(state.contextsOpened).toBe(0);
    // No side-emits written for skipped levels so dashboards don't count
    // them as flaps; operators reading the primary aggregate see the
    // explicit `skipped` state.
    expect(writer.results).toHaveLength(0);
  });

  it("starter shape: never navigates to /demos/* (no registry lookup needed)", async () => {
    // Regression guard: the pre-fix driver navigated to
    // `${backendUrl}/demos/agentic-chat` for every discovered service.
    // On a starter (no /demos/* routing) that fires a 404 and flips the
    // row red. We assert the driver never asks for a new page — it
    // short-circuits on shape BEFORE any page.goto() call.
    let gotoCalled = false;
    const scriptedBrowser: E2eBrowser = {
      async newContext(): Promise<E2eBrowserContext> {
        return {
          async newPage(): Promise<E2ePage> {
            return {
              async goto() {
                gotoCalled = true;
                throw new Error("should not be called on starter shape");
              },
              async type() {},
              async press() {},
              async waitForSelector() {},
              async textContent() {
                return "";
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
      async close() {},
    };
    const driver = createE2eSmokeDriver({
      launcher: async () => scriptedBrowser,
    });
    await driver.run(baseCtx(), {
      key: "e2e-smoke:starter-mastra",
      name: "showcase-starter-mastra",
      backendUrl: "https://showcase-starter-mastra-production.up.railway.app",
      shape: "starter",
    });
    expect(gotoCalled).toBe(false);
  });

  it("starter shape: in-band `demos` field is ignored (starters have no /demos/*)", async () => {
    // Even if an operator accidentally passes demos in the YAML for a
    // starter, the driver must honour the shape flag and skip — shape
    // wins over demos.
    const { browser, state } = makeBrowser([]);
    const driver = createE2eSmokeDriver({ launcher: async () => browser });
    const result = await driver.run(baseCtx(), {
      key: "e2e-smoke:starter-ag2",
      name: "showcase-starter-ag2",
      backendUrl: "https://showcase-starter-ag2-production.up.railway.app",
      shape: "starter",
      demos: ["agentic-chat", "tool-rendering"],
    });
    const sig = result.signal as E2eSmokeSignal;
    expect(sig.l3).toBe("skipped");
    expect(sig.l4).toBe("skipped");
    expect(state.contextsOpened).toBe(0);
  });
});

describe("e2eSmokeDriver module export", () => {
  it("module-level e2eSmokeDriver has kind === 'e2e_smoke'", () => {
    expect(e2eSmokeDriver.kind).toBe("e2e_smoke");
    expect(typeof e2eSmokeDriver.run).toBe("function");
  });
});
