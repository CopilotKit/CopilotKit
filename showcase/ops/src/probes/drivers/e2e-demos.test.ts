import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  e2eDemosDriver,
  createE2eDemosDriver,
  type E2eDemosBrowser,
  type E2eDemosBrowserContext,
  type E2eDemosPage,
  type E2eDemosAggregateSignal,
} from "./e2e-demos.js";
import { buildProbeInvoker } from "../loader/probe-invoker.js";
import { createDiscoveryRegistry } from "../discovery/index.js";
import type { DiscoverySource } from "../types.js";
import type { ProbeConfig } from "../loader/schema.js";
import { logger } from "../../logger.js";
import type {
  Logger,
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// In-memory logger spy used by the registry-error and writer-missing
// dedupe tests. Captures level + msg + meta so assertions can pin the
// exact log key + bucketing decision (info vs warn) instead of reading
// stdout. Mirrors the patterns used in railway-services tests.
interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  meta?: Record<string, unknown>;
}
function mkSpyLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const log =
    (level: LogEntry["level"]) =>
    (msg: string, meta?: Record<string, unknown>) => {
      entries.push({ level, msg, meta });
    };
  return {
    logger: {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    },
    entries,
  };
}

// Driver-level tests for the e2e-demos ProbeDriver. The driver fans out over
// every declared demo of a service and emits one `e2e:<slug>/<featureId>`
// side row per demo (plus an aggregate `e2e-demos:<slug>` primary result).
//
// Real chromium is never touched — tests inject a pluggable launcher that
// returns a scripted fake browser. Mirrors the e2e-smoke driver's test
// pattern (see e2e-smoke.test.ts).

// --- Fakes ---------------------------------------------------------------

interface PageScript {
  throwOnGoto?: Error;
  throwOnWaitForSelector?: Error;
}

function makePage(script: PageScript = {}): E2eDemosPage {
  return {
    async goto() {
      if (script.throwOnGoto) throw script.throwOnGoto;
    },
    async waitForSelector() {
      if (script.throwOnWaitForSelector) throw script.throwOnWaitForSelector;
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
): { browser: E2eDemosBrowser; state: FakeBrowserState } {
  let pageIdx = 0;
  const browser: E2eDemosBrowser = {
    async newContext(): Promise<E2eDemosBrowserContext> {
      state.contextsOpened++;
      return {
        async newPage(): Promise<E2eDemosPage> {
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

function mkWriter(): {
  writer: ProbeResultWriter;
  writes: ProbeResult<unknown>[];
} {
  const writes: ProbeResult<unknown>[] = [];
  const writer: ProbeResultWriter = {
    async write(result) {
      writes.push(result);
      return undefined;
    },
  };
  return { writer, writes };
}

function mkCtxWithLogger(
  writer: ProbeResultWriter | undefined,
  env: Record<string, string | undefined>,
  customLogger: Logger,
): ProbeContext {
  return {
    now: () => new Date("2026-04-23T00:00:00Z"),
    logger: customLogger,
    env,
    writer,
    fetchImpl: globalThis.fetch,
    abortSignal: new AbortController().signal,
  };
}

function mkCtx(
  writer?: ProbeResultWriter,
  env: Record<string, string | undefined> = {},
): ProbeContext {
  // C1: provide stubs for fetchImpl + abortSignal so the driver's
  // ProbeContext consumption surface is fully populated. ProbeContext
  // declares both as optional, but a complete stub catches future
  // changes that make them required without rewriting every test.
  return {
    now: () => new Date("2026-04-23T00:00:00Z"),
    logger,
    env,
    writer,
    fetchImpl: globalThis.fetch,
    abortSignal: new AbortController().signal,
  };
}

// --- Core emission behaviour --------------------------------------------

describe("e2e-demos driver", () => {
  // Track tmp dirs / disposables for cleanup across tests in this block.
  // Hoisted to the TOP of the describe so any `cleanups.push(...)` call
  // inside a setup-throwy `it()` (e.g. a writeFileSync that throws after
  // mkdtempSync) doesn't leak the tmp dir — the push runs immediately
  // after mkdtempSync and the afterEach reaper drains the queue regardless
  // of test outcome. Earlier versions placed this declaration AT THE
  // BOTTOM of the describe (via Vitest's hoisting it still worked at
  // runtime, but the source-ordering smell was load-bearing fragile —
  // a test that pushed BEFORE the array initializer line would hit a
  // ReferenceError. Hoist eliminates that footgun.).
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("exposes kind === 'e2e_demos'", () => {
    expect(e2eDemosDriver.kind).toBe("e2e_demos");
  });

  it("emits one e2e:<slug>/<feature> row per declared demo", async () => {
    const { browser, state } = makeBrowser([{}, {}, {}]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      demos: ["agentic-chat", "tool-rendering", "gen-ui-agent"],
      shape: "package",
    });

    // Primary aggregate
    expect(result.key).toBe("e2e-demos:langgraph-python");
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.shape).toBe("package");
    expect(sig.slug).toBe("langgraph-python");
    expect(sig.total).toBe(3);
    expect(sig.passed).toBe(3);
    expect(sig.failed).toEqual([]);

    // Three side rows — one per demo
    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "e2e:langgraph-python/agentic-chat",
      "e2e:langgraph-python/gen-ui-agent",
      "e2e:langgraph-python/tool-rendering",
    ]);
    for (const w of writes) {
      expect(w.state).toBe("green");
    }

    // Browser teardown
    expect(state.closed).toBe(true);
    // One context per demo
    expect(state.contextsOpened).toBe(3);
    expect(state.contextsClosed).toBe(3);
  });

  it("emits red for demos whose page.goto fails", async () => {
    const { browser, state } = makeBrowser([
      {}, // agentic-chat → green
      { throwOnGoto: new Error("net::ERR_CONNECTION_REFUSED") }, // tool-rendering → red
      {}, // gen-ui-agent → green
    ]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      demos: ["agentic-chat", "tool-rendering", "gen-ui-agent"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.total).toBe(3);
    expect(sig.passed).toBe(2);
    expect(sig.failed).toEqual(["tool-rendering"]);

    const byKey = new Map(writes.map((w) => [w.key, w]));
    expect(byKey.get("e2e:langgraph-python/agentic-chat")?.state).toBe("green");
    expect(byKey.get("e2e:langgraph-python/tool-rendering")?.state).toBe("red");
    expect(byKey.get("e2e:langgraph-python/gen-ui-agent")?.state).toBe("green");

    const toolRow = byKey.get("e2e:langgraph-python/tool-rendering");
    const toolSig = toolRow?.signal as { errorDesc?: string };
    expect(toolSig?.errorDesc).toMatch(/ERR_CONNECTION_REFUSED/);

    // C3: every opened context must have been closed even on the
    // goto-failure code path — catches browser-context leaks where a
    // throw inside runDemo() bypasses context.close() in the finally.
    expect(state.contextsClosed).toBe(state.contextsOpened);
  });

  it("emits red for demos whose selector check times out", async () => {
    const { browser } = makeBrowser([
      { throwOnWaitForSelector: new Error("Timeout 30000ms exceeded") },
      {},
    ]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:mastra",
      publicUrl: "https://showcase-mastra.example.com",
      name: "showcase-mastra",
      demos: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.failed).toEqual(["agentic-chat"]);
    const byKey = new Map(writes.map((w) => [w.key, w]));
    expect(byKey.get("e2e:mastra/agentic-chat")?.state).toBe("red");
    expect(byKey.get("e2e:mastra/tool-rendering")?.state).toBe("green");
  });

  it("skips shape=starter entirely: no side rows, aggregate green, no chromium", async () => {
    const { browser, state } = makeBrowser([]);
    // C2: track whether the driver invoked the launcher at all. The
    // starter short-circuit must return BEFORE the launcher is awaited;
    // `state.closed === false` was a weaker proxy that could pass even
    // if the driver had launched but not closed (which would itself be
    // a bug we wouldn't catch).
    let launched = false;
    const driver = createE2eDemosDriver({
      launcher: async () => {
        launched = true;
        return browser;
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:starter-ag2",
      name: "showcase-starter-ag2",
      publicUrl: "https://showcase-starter-ag2.example.com",
      shape: "starter",
      // Even if operator passes demos in YAML for a starter, shape wins.
      demos: ["agentic-chat"],
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.shape).toBe("starter");
    expect(sig.total).toBe(0);
    expect(sig.passed).toBe(0);
    expect(writes).toHaveLength(0);
    // Chromium must not have been touched: launcher never invoked AND
    // no contexts ever opened. Both assertions hold together as the
    // starter short-circuit's semantic contract.
    expect(launched).toBe(false);
    expect(state.contextsOpened).toBe(0);
  });

  it("resolves demos from registry when input lacks demos field", async () => {
    const { browser } = makeBrowser([{}, {}]);
    const resolverCalls: string[] = [];
    const driver = createE2eDemosDriver({
      launcher: async () => browser,
      demosResolver: async (slug) => {
        resolverCalls.push(slug);
        return [
          { id: "agentic-chat", route: "/demos/agentic-chat" },
          { id: "tool-rendering", route: "/demos/tool-rendering" },
        ];
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:langgraph-python",
      name: "showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      shape: "package",
    });

    // Slug passed to resolver must be stripped of `showcase-`
    expect(resolverCalls).toEqual(["langgraph-python"]);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.total).toBe(2);
    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "e2e:langgraph-python/agentic-chat",
      "e2e:langgraph-python/tool-rendering",
    ]);
  });

  it("resolves demos from registry fixture JSON when REGISTRY_JSON_PATH is set", async () => {
    // End-to-end exercise of the default demosResolver: write a fixture
    // registry.json and set REGISTRY_JSON_PATH so the default path reads it.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-demos-"));
    // Register cleanup IMMEDIATELY after mkdtempSync — before any
    // writeFileSync that could throw and leak the tmp dir. Earlier
    // versions registered cleanup AFTER writeFileSync, so a disk-full
    // / permission throw in writeFileSync would orphan the tmp dir
    // for the rest of the test process's lifetime.
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const registryPath = path.join(tmp, "registry.json");
    fs.writeFileSync(
      registryPath,
      JSON.stringify({
        integrations: [
          {
            slug: "mastra",
            demos: [
              { id: "agentic-chat", route: "/demos/agentic-chat" },
              { id: "tool-rendering", route: "/demos/tool-rendering" },
            ],
          },
        ],
      }),
    );

    const { browser } = makeBrowser([{}, {}]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtx(writer, { REGISTRY_JSON_PATH: registryPath }),
      {
        key: "e2e-demos:mastra",
        name: "showcase-mastra",
        publicUrl: "https://showcase-mastra.example.com",
        shape: "package",
      },
    );

    expect(result.state).toBe("green");
    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "e2e:mastra/agentic-chat",
      "e2e:mastra/tool-rendering",
    ]);
  });

  it("red aggregate with launcher-error when chromium launch throws", async () => {
    const driver = createE2eDemosDriver({
      launcher: async () => {
        throw new Error("cannot find chromium-headless-shell");
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:langgraph-python",
      name: "showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      demos: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDemosAggregateSignal & {
      errorDesc?: string;
    };
    expect(sig.errorDesc).toBe("launcher-error");
    // No side rows on launcher failure — nothing was actually tested.
    expect(writes).toHaveLength(0);
  });

  it("empty demos list → aggregate green, no side rows, chromium not launched", async () => {
    let launched = false;
    const driver = createE2eDemosDriver({
      launcher: async () => {
        launched = true;
        const { browser } = makeBrowser([]);
        return browser;
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:empty",
      name: "showcase-empty",
      publicUrl: "https://showcase-empty.example.com",
      demos: [],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.total).toBe(0);
    expect(writes).toHaveLength(0);
    expect(launched).toBe(false);
  });

  it("survives writer failure on one side-emit without swallowing aggregate", async () => {
    const { browser } = makeBrowser([{}, {}]);
    const writer = {
      writes: 0,
      async write(r: ProbeResult<unknown>) {
        this.writes++;
        if (r.key === "e2e:foo/agentic-chat") throw new Error("pb down");
        return undefined;
      },
    };
    const driver = createE2eDemosDriver({ launcher: async () => browser });

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:foo",
      name: "showcase-foo",
      publicUrl: "https://showcase-foo.example.com",
      demos: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    expect(writer.writes).toBe(2);
  });

  // --- Route-handling edge cases ---------------------------------------

  it("emits green without goto for demos lacking route (informational cells)", async () => {
    // Mixed set: `cli-start` is an informational command-cell with no
    // route; `agentic-chat` is a normal navigable demo. Only the
    // navigable demo should consume a page script.
    //
    // C4 coupling note: pageScripts.length === 1 (only agentic-chat,
    // not cli-start) is load-bearing. The driver's "skip newContext for
    // routeless demos" behaviour means cli-start does NOT consume a
    // page script. If pageScripts grew to 2 here the second entry
    // would be silently ignored (makePage() falls back to {} when the
    // index is out of range), but if the driver REGRESSED and started
    // calling newPage() for the routeless cell, it would consume the
    // second pageScripts entry instead of throwing. The gotoCalls
    // assertion below is the load-bearing check that catches that
    // regression — the array length is documentary, not enforcing.
    const pageScripts: PageScript[] = [{} /* agentic-chat only */];
    const { browser, state } = makeBrowser(pageScripts);
    let gotoCalls = 0;
    // Wrap the browser to count goto calls. Cli-start must not produce
    // one.
    const wrappedBrowser: E2eDemosBrowser = {
      async newContext() {
        const ctx = await browser.newContext();
        return {
          async newPage() {
            const page = await ctx.newPage();
            const origGoto = page.goto.bind(page);
            page.goto = async (url, opts) => {
              gotoCalls++;
              return origGoto(url, opts);
            };
            return page;
          },
          close: () => ctx.close(),
        };
      },
      close: () => browser.close(),
    };

    const driver = createE2eDemosDriver({
      launcher: async () => wrappedBrowser,
      demosResolver: async () => [
        { id: "cli-start" /* no route */ },
        { id: "agentic-chat", route: "/demos/agentic-chat" },
      ],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:langgraph-python",
      name: "showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      shape: "package",
    });

    // Aggregate is green: both cells pass (cli-start skipped green,
    // agentic-chat navigated green).
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.total).toBe(2);
    expect(sig.passed).toBe(2);
    expect(sig.failed).toEqual([]);

    // Exactly one goto happened — for agentic-chat. cli-start must not
    // have touched the page at all.
    expect(gotoCalls).toBe(1);
    // Exactly one context was opened (the informational cell does not
    // open a fresh context either).
    expect(state.contextsOpened).toBe(1);

    const byKey = new Map(writes.map((w) => [w.key, w]));
    expect(writes).toHaveLength(2);

    const cliRow = byKey.get("e2e:langgraph-python/cli-start");
    expect(cliRow?.state).toBe("green");
    const cliSig = cliRow?.signal as {
      note?: string;
      url?: string;
      errorClass?: string;
    };
    expect(cliSig?.note).toMatch(/informational cell/i);
    expect(cliSig?.url).toBeUndefined();
    expect(cliSig?.errorClass).toBeUndefined();

    const chatRow = byKey.get("e2e:langgraph-python/agentic-chat");
    expect(chatRow?.state).toBe("green");
    const chatSig = chatRow?.signal as { url?: string; note?: string };
    expect(chatSig?.url).toBe(
      "https://showcase-langgraph-python.example.com/demos/agentic-chat",
    );
    expect(chatSig?.note).toBeUndefined();
  });

  it("matches custom composer via textarea fallback selector", async () => {
    // Simulate a custom-composer demo: the CopilotKit testid selector
    // and the default placeholder selector both time out, but a generic
    // `textarea` does match. The driver must walk the selector chain
    // and emit green on the third selector without failing.
    const selectorsTried: string[] = [];
    const page: E2eDemosPage = {
      async goto() {
        /* ok */
      },
      async waitForSelector(sel: string) {
        selectorsTried.push(sel);
        if (sel === "textarea") return; // match
        throw new Error(`Timeout waiting for ${sel}`);
      },
      async close() {
        /* no-op */
      },
    };
    const browser: E2eDemosBrowser = {
      async newContext(): Promise<E2eDemosBrowserContext> {
        return {
          async newPage() {
            return page;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => browser,
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:langgraph-python",
      name: "showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      demos: ["headless-simple"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.passed).toBe(1);
    expect(sig.failed).toEqual([]);

    // The chain was walked in order: testid → placeholder → textarea
    // (match). Stronger fallbacks past the match are not attempted.
    expect(selectorsTried).toEqual([
      '[data-testid="copilot-chat-input"]',
      'input[placeholder="Type a message"]',
      "textarea",
    ]);

    expect(writes).toHaveLength(1);
    expect(writes[0]?.state).toBe("green");
  });

  it("fails red only when all 5 fallback selectors miss", async () => {
    // Harden the expanded selector chain: if every selector misses the
    // row must still red out as a selector-error (not swallowed as green
    // by the additional fallbacks).
    const selectorsTried: string[] = [];
    const page: E2eDemosPage = {
      async goto() {
        /* ok */
      },
      async waitForSelector(sel: string) {
        selectorsTried.push(sel);
        throw new Error(`Timeout waiting for ${sel}`);
      },
      async close() {
        /* no-op */
      },
    };
    const browser: E2eDemosBrowser = {
      async newContext(): Promise<E2eDemosBrowserContext> {
        return {
          async newPage() {
            return page;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:foo",
      name: "showcase-foo",
      publicUrl: "https://showcase-foo.example.com",
      demos: ["ghost-demo"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    expect(selectorsTried).toEqual([
      '[data-testid="copilot-chat-input"]',
      'input[placeholder="Type a message"]',
      "textarea",
      'input[type="text"]',
      '[role="textbox"]',
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.state).toBe("red");
    const rowSig = writes[0]?.signal as { errorClass?: string };
    expect(rowSig?.errorClass).toBe("selector-error");
  });

  // --- Env-threaded internal cap (E2E_DEMOS_TIMEOUT_MS) ------------------
  //
  // The driver is registered at orchestrator boot as a SINGLETON before
  // probe configs are loaded, so per-probe `cfg.timeout_ms` cannot be
  // wired via constructor injection. Instead the orchestrator sets
  // `process.env.E2E_DEMOS_TIMEOUT_MS = String(cfg.timeout_ms)` at config-
  // diff time, and the driver reads it per-`run()` so the YAML's 20-min
  // cap takes effect regardless of registration order. The default
  // `deps.timeoutMs` (5 min) only applies if the env var is missing or
  // invalid. These tests pin the resolution order: env > deps > default.

  it("env override (E2E_DEMOS_TIMEOUT_MS) wins over the deps default", async () => {
    // A slow launcher that NEVER resolves: if the env override (5000ms)
    // is honored, the driver's internal race resolves the run within a
    // few hundred ms and the test passes; if the deps default (10ms)
    // wins, the driver aborts almost instantly and emits an "abort"
    // side row — which is exactly what we DON'T want here.
    let gotoStarted = false;
    const slowPage: E2eDemosPage = {
      async goto() {
        gotoStarted = true;
        // Resolve quickly so the test doesn't hang; the assertion is
        // about whether the driver-internal cap fired, not wall-clock.
        await new Promise((r) => setTimeout(r, 20));
      },
      async waitForSelector() {
        /* match immediately */
      },
      async close() {
        /* no-op */
      },
    };
    const slowBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return slowPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => slowBrowser,
      // Tiny deps default — env override at 5000ms must trump this.
      timeoutMs: 10,
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtx(writer, { E2E_DEMOS_TIMEOUT_MS: "5000" }),
      {
        key: "e2e-demos:env-test",
        name: "showcase-env-test",
        publicUrl: "https://showcase-env-test.example.com",
        demos: ["d1"],
        shape: "package",
      },
    );

    expect(gotoStarted).toBe(true);
    expect(result.state).toBe("green");
    // No "abort" side rows — the env-threaded cap was generous enough
    // that the per-demo work completed before it fired.
    const aborts = writes.filter(
      (w) => (w.signal as { errorClass?: string })?.errorClass === "abort",
    );
    expect(aborts).toHaveLength(0);
  });

  it("invalid env value (non-numeric / zero) falls back to deps.timeoutMs", async () => {
    // If E2E_DEMOS_TIMEOUT_MS is set to something parseInt rejects
    // (or a non-positive number), the driver MUST ignore it and fall
    // back to the deps.timeoutMs (5 min default if absent). Verify by
    // setting the env to garbage, the deps to 50ms, and a slow goto:
    // the driver's 50ms cap should fire and side-emit "abort" rows.
    const slowPage: E2eDemosPage = {
      async goto() {
        // Sleep longer than the deps cap so the abort race fires.
        await new Promise((r) => setTimeout(r, 200));
      },
      async waitForSelector() {
        /* never gets here */
      },
      async close() {
        /* no-op */
      },
    };
    const slowBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return slowPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => slowBrowser,
      timeoutMs: 50,
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtx(writer, { E2E_DEMOS_TIMEOUT_MS: "not-a-number" }),
      {
        key: "e2e-demos:env-invalid",
        name: "showcase-env-invalid",
        publicUrl: "https://showcase-env-invalid.example.com",
        demos: ["d1", "d2", "d3"],
        shape: "package",
      },
    );

    // Aggregate must be red — at least one demo aborted.
    expect(result.state).toBe("red");
    // At least one abort side row: the deps cap was honored.
    const aborts = writes.filter(
      (w) => (w.signal as { errorClass?: string })?.errorClass === "abort",
    );
    expect(aborts.length).toBeGreaterThan(0);
  });

  // --- L: Driver fires internal cap mid-fan-out, side-emits abort rows ---

  it("driver fires the internal cap mid-fan-out and side-emits errorClass: 'abort' rows for remaining demos", async () => {
    // Drive 5 demos at 30ms each through a driver capped at 50ms. The
    // driver fans out demos serially within a service, so after the
    // first ~2 demos finish the abort fires; the remaining 3+ demos
    // must each receive a side row with errorClass="abort" rather
    // than being silently skipped (or all coalesced into a single
    // aggregate row). The dashboard relies on per-demo dots — silent
    // skip would leave half the cells gray rather than red.
    const slowPage: E2eDemosPage = {
      async goto() {
        await new Promise((r) => setTimeout(r, 30));
      },
      async waitForSelector() {
        /* match immediately */
      },
      async close() {
        /* no-op */
      },
    };
    const slowBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return slowPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => slowBrowser,
      timeoutMs: 50,
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:abort-fanout",
      name: "showcase-abort-fanout",
      publicUrl: "https://showcase-abort-fanout.example.com",
      demos: ["d1", "d2", "d3", "d4", "d5"],
      shape: "package",
    });

    // Aggregate red — at least one abort.
    expect(result.state).toBe("red");

    // Every demo must have a side row (per-demo dot semantics).
    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "e2e:abort-fanout/d1",
      "e2e:abort-fanout/d2",
      "e2e:abort-fanout/d3",
      "e2e:abort-fanout/d4",
      "e2e:abort-fanout/d5",
    ]);

    // At least one row carries errorClass="abort" (the post-cap demos).
    const aborts = writes.filter(
      (w) => (w.signal as { errorClass?: string })?.errorClass === "abort",
    );
    expect(aborts.length).toBeGreaterThan(0);
    // Each abort row must carry an errorDesc mentioning the timeout
    // value so dashboard tooltips render a useful message.
    for (const a of aborts) {
      const sig = a.signal as { errorDesc?: string };
      expect(typeof sig?.errorDesc).toBe("string");
      expect(sig.errorDesc).toMatch(/timeout/i);
    }
  });

  // --- C3: defaultDemosResolver structured registry-error logging --------
  //
  // The default resolver previously swallowed all read/parse errors with
  // an empty `catch {}` — a corrupt or missing registry silently flipped
  // every e2e_demos cell green forever. These tests pin the structured
  // logging buckets (read/parse/shape) so a regression that drops one
  // would surface as a missing log entry instead of silent green.

  it("logs registry-read-failed at info on ENOENT and returns empty demos", async () => {
    // Missing registry → ENOENT — steady-state in dev. Must downgrade to
    // info so the alert stream isn't pulsed every tick.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-demos-enoent-"));
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const missingPath = path.join(tmp, "does-not-exist.json");

    const { logger: spy, entries } = mkSpyLogger();
    const { browser } = makeBrowser([]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtxWithLogger(writer, { REGISTRY_JSON_PATH: missingPath }, spy),
      {
        key: "e2e-demos:any",
        name: "showcase-any",
        publicUrl: "https://showcase-any.example.com",
        shape: "package",
      },
    );

    // Empty demos → aggregate green, no side rows.
    expect(result.state).toBe("green");
    expect(writes).toHaveLength(0);

    // Structural assertion: exactly one info-level read-failed log,
    // no warn-level read-failed log (ENOENT must downgrade to info).
    const reads = entries.filter(
      (e) => e.msg === "probe.e2e-demos.registry-read-failed",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]?.level).toBe("info");
    expect(reads[0]?.meta?.path).toBe(missingPath);
  });

  it("logs registry-parse-failed at warn on corrupt JSON", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-demos-corrupt-"));
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const corruptPath = path.join(tmp, "registry.json");
    fs.writeFileSync(corruptPath, "{ this is not valid json,,,");

    const { logger: spy, entries } = mkSpyLogger();
    const { browser } = makeBrowser([]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtxWithLogger(writer, { REGISTRY_JSON_PATH: corruptPath }, spy),
      {
        key: "e2e-demos:any",
        name: "showcase-any",
        publicUrl: "https://showcase-any.example.com",
        shape: "package",
      },
    );

    expect(result.state).toBe("green");
    expect(writes).toHaveLength(0);

    const parseFails = entries.filter(
      (e) => e.msg === "probe.e2e-demos.registry-parse-failed",
    );
    expect(parseFails).toHaveLength(1);
    expect(parseFails[0]?.level).toBe("warn");
    expect(parseFails[0]?.meta?.path).toBe(corruptPath);
  });

  it("logs registry-shape-invalid at warn when root is not a plain object", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-demos-shape-"));
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const shapePath = path.join(tmp, "registry.json");
    // JSON-valid but wrong root shape — an array, not an object. The
    // resolver's shape guard catches this before the property access
    // would TypeError.
    fs.writeFileSync(shapePath, '["this", "is", "an", "array"]');

    const { logger: spy, entries } = mkSpyLogger();
    const { browser } = makeBrowser([]);
    const driver = createE2eDemosDriver({ launcher: async () => browser });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtxWithLogger(writer, { REGISTRY_JSON_PATH: shapePath }, spy),
      {
        key: "e2e-demos:any",
        name: "showcase-any",
        publicUrl: "https://showcase-any.example.com",
        shape: "package",
      },
    );

    expect(result.state).toBe("green");
    expect(writes).toHaveLength(0);

    const shapeFails = entries.filter(
      (e) => e.msg === "probe.e2e-demos.registry-shape-invalid",
    );
    expect(shapeFails).toHaveLength(1);
    expect(shapeFails[0]?.level).toBe("warn");
    expect(shapeFails[0]?.meta?.isArray).toBe(true);
  });

  // --- C5: AbortError classification via err.name (race-proof) -----------

  it("classifies a non-abort error as driver-error even if abort fires concurrently", async () => {
    // Synthetic launcher that throws a plain TypeError DURING goto AND
    // simultaneously triggers an external abort. The race-prone classifier
    // would read `abortSignal.aborted` after the catch, see the abort flag
    // flipped, and misclassify the TypeError as "abort". The new
    // classifier reads `err.name === "AbortError"` directly so the
    // TypeError stays bucketed as "driver-error" (or the goto-error
    // bucket if the throw happens inside page.goto).
    const externalCtl = new AbortController();
    const racyPage: E2eDemosPage = {
      async goto() {
        // Fire abort first so the flag is set by the time the catch runs.
        externalCtl.abort();
        // Then throw a real driver bug — NOT an AbortError.
        throw new TypeError("undefined is not a function");
      },
      async waitForSelector() {
        /* never reached */
      },
      async close() {
        /* no-op */
      },
    };
    const racyBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return racyPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };
    const driver = createE2eDemosDriver({
      launcher: async () => racyBrowser,
      timeoutMs: 60_000,
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      {
        now: () => new Date("2026-04-23T00:00:00Z"),
        logger,
        env: {},
        writer,
        fetchImpl: globalThis.fetch,
        abortSignal: externalCtl.signal,
      },
      {
        key: "e2e-demos:racy",
        name: "showcase-racy",
        publicUrl: "https://showcase-racy.example.com",
        demos: ["d1"],
        shape: "package",
      },
    );

    expect(result.state).toBe("red");
    // The single demo's side row must NOT be classified as "abort"
    // (which would happen with the prior abortSignal.aborted-after-catch
    // logic). The TypeError is a real driver bug → "goto-error" because
    // the throw happened inside page.goto.
    const sideRow = writes.find((w) => w.key === "e2e:racy/d1");
    expect(sideRow).toBeDefined();
    const sig = sideRow?.signal as { errorClass?: string };
    expect(sig?.errorClass).toBe("goto-error");
    expect(sig?.errorClass).not.toBe("abort");
  });

  // --- C7: selector-loop is abort-responsive ---------------------------

  it("aborts mid-selector-loop without walking all 5 selectors", async () => {
    // Slow waitForSelector + cap fires mid-loop. Without the abort
    // check between iterations, the worst case is 5*pageTimeoutMs per
    // demo. Assert the loop bails after a small constant number of
    // selectors (< 5) once the cap fires.
    const selectorsTried: string[] = [];
    let resolveFirstSel!: () => void;
    const firstSelGate = new Promise<void>((r) => {
      resolveFirstSel = r;
    });

    const slowSelectorPage: E2eDemosPage = {
      async goto() {
        /* immediate */
      },
      async waitForSelector(sel: string) {
        selectorsTried.push(sel);
        if (selectorsTried.length === 1) {
          // First selector: wait until the test releases us, then throw
          // so the loop continues to the next selector. By that time
          // the cap should have fired and the next iteration's abort
          // check should bail.
          await firstSelGate;
          throw new Error(`Timeout for ${sel}`);
        }
        throw new Error(`Timeout for ${sel}`);
      },
      async close() {
        /* no-op */
      },
    };
    const slowSelectorBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return slowSelectorPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => slowSelectorBrowser,
      timeoutMs: 50,
      pageTimeoutMs: 30_000,
    });
    const { writer, writes } = mkWriter();

    const runP = driver.run(mkCtx(writer), {
      key: "e2e-demos:abort-mid-loop",
      name: "showcase-abort-mid-loop",
      publicUrl: "https://showcase-abort-mid-loop.example.com",
      demos: ["d1"],
      shape: "package",
    });

    // Let the cap fire (50ms) before the first selector resolves.
    await new Promise((r) => setTimeout(r, 100));
    resolveFirstSel();
    const result = await runP;

    expect(result.state).toBe("red");
    // Strict: only the first selector should have been attempted; the
    // mid-loop abort check must bail before the second iteration runs.
    expect(selectorsTried.length).toBeLessThan(5);
    // Side row must reflect either abort or selector-error/timeout, NOT
    // a wall-clock-bloated five-selector walk.
    const sideRow = writes.find((w) => w.key === "e2e:abort-mid-loop/d1");
    const sig = sideRow?.signal as { errorClass?: string };
    expect(["abort", "selector-error", "selector-timeout"]).toContain(
      sig?.errorClass,
    );
  });

  // --- C8: empty-string route → red config-invalid row ------------------

  it("emits red config-invalid for entries with route: ''", async () => {
    const { browser } = makeBrowser([]);
    const driver = createE2eDemosDriver({
      launcher: async () => browser,
      demosResolver: async () => [{ id: "broken-demo", route: "" }],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:foo",
      name: "showcase-foo",
      publicUrl: "https://showcase-foo.example.com",
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDemosAggregateSignal;
    expect(sig.failed).toEqual(["broken-demo"]);

    const sideRow = writes.find((w) => w.key === "e2e:foo/broken-demo");
    expect(sideRow?.state).toBe("red");
    const rowSig = sideRow?.signal as {
      errorClass?: string;
      errorDesc?: string;
    };
    expect(rowSig?.errorClass).toBe("config-invalid");
    expect(rowSig?.errorDesc).toBe("route is empty string");
  });

  // --- C9: abort branch fires-and-forgets sideEmit ----------------------

  it("does not block on slow writer when abort fires mid-fan-out", async () => {
    // Slow goto so the cap fires after demo 1; remaining demos hit the
    // pre-iteration abort branch. The writer is intentionally slow on
    // every write — if the driver awaited sideEmit on the abort branch
    // the run would be gated on N * writerLatency, defeating prompt
    // shutdown. With void-ed sideEmit the driver returns promptly and
    // the writes drain in the background.
    let writeCount = 0;
    const slowWriter: ProbeResultWriter = {
      async write() {
        writeCount++;
        await new Promise((r) => setTimeout(r, 200));
        return undefined;
      },
    };
    const slowPage: E2eDemosPage = {
      async goto() {
        await new Promise((r) => setTimeout(r, 30));
      },
      async waitForSelector() {
        /* match immediately */
      },
      async close() {
        /* no-op */
      },
    };
    const slowBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return slowPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => slowBrowser,
      timeoutMs: 40,
    });

    const startedAt = Date.now();
    const result = await driver.run(mkCtxWithLogger(slowWriter, {}, logger), {
      key: "e2e-demos:slow-writer",
      name: "showcase-slow-writer",
      publicUrl: "https://showcase-slow-writer.example.com",
      demos: ["d1", "d2", "d3", "d4", "d5"],
      shape: "package",
    });
    const elapsed = Date.now() - startedAt;

    expect(result.state).toBe("red");
    // The driver must return well before N * 200ms (which would happen
    // if the abort-branch writes were awaited). Allow generous slack:
    // 5 * 200ms = 1000ms; we expect <500ms.
    expect(elapsed).toBeLessThan(500);
    // Drain any pending background writes so the test doesn't leave
    // dangling timers.
    await new Promise((r) => setTimeout(r, 1500));
    // At least one demo's writes started.
    expect(writeCount).toBeGreaterThan(0);
  });

  // --- C10: writer-missing warn fires once per run ----------------------

  it("emits at most one writer-missing warn per run regardless of demo count", async () => {
    const { browser } = makeBrowser([{}, {}, {}, {}, {}]);
    const { logger: spy, entries } = mkSpyLogger();
    const driver = createE2eDemosDriver({ launcher: async () => browser });

    // No writer plumbed.
    const result = await driver.run(mkCtxWithLogger(undefined, {}, spy), {
      key: "e2e-demos:no-writer",
      name: "showcase-no-writer",
      publicUrl: "https://showcase-no-writer.example.com",
      demos: ["d1", "d2", "d3", "d4", "d5"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const warns = entries.filter(
      (e) => e.msg === "probe.e2e-demos.writer-missing",
    );
    // Exactly one warn even though 5 side-emits were attempted.
    expect(warns).toHaveLength(1);
  });

  // --- C11: per-demo wall-clock bound by pageTimeoutMs ------------------

  it("bounds total per-demo wall-clock to pageTimeoutMs across goto + selectors", async () => {
    // Each waitForSelector consumes the remaining budget but never
    // resolves until forced. The total per-demo wall-clock must stay
    // close to pageTimeoutMs (e.g. 200ms) — NOT 5 * pageTimeoutMs
    // (which the prior implementation would have allowed).
    const selectorsTried: string[] = [];
    const sleepyPage: E2eDemosPage = {
      async goto() {
        /* immediate */
      },
      async waitForSelector(sel: string, opts) {
        selectorsTried.push(sel);
        // Honour the per-call timeout. If the driver passed the FULL
        // pageTimeoutMs to every selector, this sleep would multiply
        // up; if it passed a remaining-budget timeout, we'd see a
        // strictly decreasing series of sleeps that sum to <= budget.
        const t = opts && typeof opts.timeout === "number" ? opts.timeout : 50;
        await new Promise((r) => setTimeout(r, t));
        throw new Error(`Timeout waiting for ${sel}`);
      },
      async close() {
        /* no-op */
      },
    };
    const sleepyBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return sleepyPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => sleepyBrowser,
      timeoutMs: 5_000,
      pageTimeoutMs: 200,
    });
    const { writer, writes } = mkWriter();

    const startedAt = Date.now();
    const result = await driver.run(mkCtx(writer), {
      key: "e2e-demos:bounded",
      name: "showcase-bounded",
      publicUrl: "https://showcase-bounded.example.com",
      demos: ["d1"],
      shape: "package",
    });
    const elapsed = Date.now() - startedAt;

    expect(result.state).toBe("red");
    // Sum of selector waits must not exceed pageTimeoutMs (with slack):
    // 1 demo * 200ms budget. Allow 400ms slack for goto + scheduler.
    expect(elapsed).toBeLessThan(600);
    expect(selectorsTried.length).toBeGreaterThan(0);
    expect(writes[0]?.state).toBe("red");
  });

  // --- C12: custom resolver throws → synthetic __resolver red row -------

  it("emits synthetic resolver-error side row when custom resolver throws", async () => {
    const { browser } = makeBrowser([]);
    const driver = createE2eDemosDriver({
      launcher: async () => browser,
      demosResolver: async () => {
        throw new Error("registry adapter exploded");
      },
    });
    const { writer, writes } = mkWriter();
    const { logger: spy, entries } = mkSpyLogger();

    const result = await driver.run(mkCtxWithLogger(writer, {}, spy), {
      key: "e2e-demos:exploded",
      name: "showcase-exploded",
      publicUrl: "https://showcase-exploded.example.com",
      shape: "package",
    });

    // A synthetic side row surfaces the configuration mistake distinctly
    // from a green-aggregate-with-empty-demos masquerade.
    const synthetic = writes.find((w) => w.key === "e2e:exploded/__resolver");
    expect(synthetic).toBeDefined();
    expect(synthetic?.state).toBe("red");
    const sig = synthetic?.signal as {
      errorClass?: string;
      errorDesc?: string;
    };
    expect(sig?.errorClass).toBe("resolver-error");
    expect(sig?.errorDesc).toMatch(/exploded/);

    // Aggregate primary still emits — the orchestrator's writer sees
    // both a synthetic red row and the green aggregate; alert rules
    // can branch on `__resolver` to surface the bug.
    expect(result.key).toBe("e2e-demos:exploded");

    // Log carries errName + stack for debuggability.
    const failLogs = entries.filter(
      (e) => e.msg === "probe.e2e-demos.demos-resolve-failed",
    );
    expect(failLogs).toHaveLength(1);
    expect(failLogs[0]?.meta?.errName).toBe("Error");
  });
});

// --- Integration: shortest-service-first dispatch ------------------------
//
// Drives the WHOLE invoker → e2e-demos driver path against multiple fake
// services with varying demo counts. The sort lives inside
// `buildProbeInvoker`'s discovery path so that a tick with services of
// length [5, 20, 38] dispatches the smallest first under bounded
// concurrency. This integration test catches regressions where the sort
// is bypassed (e.g. moved into the driver instead of the invoker, or
// short-circuited for static targets).

describe("shortest-service-first dispatch (integration)", () => {
  it("dispatches small services before large ones via the invoker", async () => {
    // Per-slug bookkeeping so the assertion can compare finished(small)
    // against started(large) without relying on driver internals.
    //
    // Earlier versions of this test used `Date.now()` + per-goto sleeps
    // to space out goto-events across services, then asserted on
    // millisecond timestamps. That approach was flaky in two ways:
    //   - on a fast host the tiny service's last goto could land in the
    //     same millisecond as the huge service's first goto, making the
    //     assertion tie/flip;
    //   - the per-goto sleep added wall-clock slack (~7s typical) that
    //     bloated the test runtime for no semantic reason.
    // A monotonic ordinal counter trivially eliminates BOTH issues:
    // ordinals are strictly increasing per goto, ties are impossible,
    // and the test no longer needs to sleep at all — the assertion is
    // about dispatch ORDER, not wall-clock timing.
    type SlugTimings = { firstOrd: number; lastOrd: number };
    const timings = new Map<string, SlugTimings>();
    let order = 0;
    const nextOrd = (): number => order++;

    // Single shared fake browser. The slug is recovered from the URL
    // each goto receives (`https://<slug>.example.com/demos/...`), which
    // avoids any race between concurrent runs trying to share a queue
    // variable in the launcher closure.
    function slugFromUrl(url: string): string {
      const m = /^https:\/\/([^.]+)\.example\.com/.exec(url);
      return m?.[1] ?? "unknown";
    }

    const sharedPage: E2eDemosPage = {
      async goto(url) {
        const slug = slugFromUrl(url);
        const t = nextOrd();
        const existing = timings.get(slug);
        if (!existing) {
          timings.set(slug, { firstOrd: t, lastOrd: t });
        } else {
          existing.lastOrd = t;
        }
      },
      async waitForSelector() {
        /* match immediately */
      },
      async close() {
        /* no-op */
      },
    };

    const sharedBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return sharedPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => sharedBrowser,
      // Tighten driver-internal timeouts so this test does not hang for
      // 5 minutes if the dispatch order regresses catastrophically.
      timeoutMs: 30_000,
      pageTimeoutMs: 5_000,
    });

    // Stub StatusWriter — same shape as probe-invoker.test.ts.
    const writes: ProbeResult<unknown>[] = [];
    const writer = {
      async write(r: ProbeResult<unknown>) {
        writes.push(r);
        return {
          previousState: null,
          newState: r.state,
          transition: "first" as const,
          firstFailureAt: null,
          failCount: 0,
        };
      },
    };

    // Discovery source returns services in REVERSE size order so that a
    // missing or broken sort sends the 38-demo service into the first
    // concurrency slot. With shortest-first sort, the 5-demo service
    // claims a slot first.
    const fakeSource: DiscoverySource = {
      name: "fake-services",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [
          {
            name: "showcase-huge",
            publicUrl: "https://huge.example.com",
            demos: Array.from({ length: 38 }, (_, i) => `demo-${i}`),
            shape: "package",
          },
          {
            name: "showcase-medium",
            publicUrl: "https://medium.example.com",
            demos: Array.from({ length: 20 }, (_, i) => `demo-${i}`),
            shape: "package",
          },
          {
            name: "showcase-tiny",
            publicUrl: "https://tiny.example.com",
            demos: Array.from({ length: 5 }, (_, i) => `demo-${i}`),
            shape: "package",
          },
        ];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(fakeSource);

    const cfg: ProbeConfig = {
      kind: "e2e_demos",
      id: "e2e-demos-integration",
      schedule: "*/15 * * * *",
      max_concurrency: 2,
      discovery: {
        source: "fake-services",
        filter: {},
        key_template: "e2e-demos:${name}",
      },
    };

    const invoker = buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      logger,
      fetchImpl: globalThis.fetch,
      env: {} as Readonly<Record<string, string | undefined>>,
      now: () => new Date("2026-04-25T00:00:00Z"),
    });

    await invoker();

    // Sanity: every service produced an aggregate row.
    const aggregates = writes.filter((w) => w.key.startsWith("e2e-demos:"));
    expect(aggregates.map((w) => w.key).sort()).toEqual([
      "e2e-demos:showcase-huge",
      "e2e-demos:showcase-medium",
      "e2e-demos:showcase-tiny",
    ]);

    // Load-bearing assertion: the 5-demo service finished its LAST goto
    // BEFORE the 38-demo service issued its FIRST goto. This holds only
    // if the invoker dispatched shortest-first under max_concurrency=2.
    const tiny = timings.get("tiny");
    const huge = timings.get("huge");
    expect(tiny).toBeDefined();
    expect(huge).toBeDefined();
    expect(tiny!.lastOrd).toBeLessThan(huge!.firstOrd);
  });

  it("records driver dispatch order ascending by demo count", async () => {
    // Companion assertion: the order in which run() is invoked across
    // services must be [tiny(5), medium(20), huge(38)] when discovery
    // returned them in reverse. Captures the dispatch ordering by
    // recording the slug of the FIRST goto each service issues. With
    // max_concurrency=1, those firsts are strictly ordered by dispatch.
    const dispatchOrder: string[] = [];

    function slugFromUrl(url: string): string {
      const m = /^https:\/\/([^.]+)\.example\.com/.exec(url);
      return m?.[1] ?? "unknown";
    }

    const seenSlugs = new Set<string>();
    const sharedPage: E2eDemosPage = {
      async goto(url) {
        const slug = slugFromUrl(url);
        if (!seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          dispatchOrder.push(slug);
        }
      },
      async waitForSelector() {
        /* immediate match */
      },
      async close() {
        /* no-op */
      },
    };
    const sharedBrowser: E2eDemosBrowser = {
      async newContext() {
        return {
          async newPage() {
            return sharedPage;
          },
          async close() {
            /* no-op */
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDemosDriver({
      launcher: async () => sharedBrowser,
      timeoutMs: 30_000,
      pageTimeoutMs: 5_000,
    });

    const writer = {
      async write(r: ProbeResult<unknown>) {
        return {
          previousState: null,
          newState: r.state,
          transition: "first" as const,
          firstFailureAt: null,
          failCount: 0,
        };
      },
    };

    const fakeSource: DiscoverySource = {
      name: "fake-services-2",
      configSchema: z.object({}).passthrough(),
      async enumerate() {
        return [
          {
            name: "showcase-huge",
            publicUrl: "https://huge.example.com",
            demos: Array.from({ length: 38 }, (_, i) => `demo-${i}`),
            shape: "package",
          },
          {
            name: "showcase-medium",
            publicUrl: "https://medium.example.com",
            demos: Array.from({ length: 20 }, (_, i) => `demo-${i}`),
            shape: "package",
          },
          {
            name: "showcase-tiny",
            publicUrl: "https://tiny.example.com",
            demos: Array.from({ length: 5 }, (_, i) => `demo-${i}`),
            shape: "package",
          },
        ];
      },
    };
    const discoveryRegistry = createDiscoveryRegistry();
    discoveryRegistry.register(fakeSource);

    const cfg: ProbeConfig = {
      kind: "e2e_demos",
      id: "e2e-demos-dispatch-order",
      schedule: "*/15 * * * *",
      // Concurrency=1 so dispatch order is observable as resolver-call
      // order without parallel interleaving noise.
      max_concurrency: 1,
      discovery: {
        source: "fake-services-2",
        filter: {},
        key_template: "e2e-demos:${name}",
      },
    };

    await buildProbeInvoker(cfg, {
      driver,
      discoveryRegistry,
      writer,
      logger,
      fetchImpl: globalThis.fetch,
      env: {} as Readonly<Record<string, string | undefined>>,
      now: () => new Date("2026-04-25T00:00:00Z"),
    })();

    expect(dispatchOrder).toEqual(["tiny", "medium", "huge"]);
  });
});
