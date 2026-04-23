import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  e2eDemosDriver,
  createE2eDemosDriver,
  type E2eDemosBrowser,
  type E2eDemosBrowserContext,
  type E2eDemosPage,
  type E2eDemosAggregateSignal,
} from "./e2e-demos.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

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

function mkCtx(
  writer?: ProbeResultWriter,
  env: Record<string, string | undefined> = {},
): ProbeContext {
  return {
    now: () => new Date("2026-04-23T00:00:00Z"),
    logger,
    env,
    writer,
  };
}

// --- Core emission behaviour --------------------------------------------

describe("e2e-demos driver", () => {
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
    const { browser } = makeBrowser([
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
    const driver = createE2eDemosDriver({ launcher: async () => browser });
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
    // Chromium must not have been touched.
    expect(state.contextsOpened).toBe(0);
    expect(state.closed).toBe(false);
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
    cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
        return {};
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

  // Track tmp dirs for cleanup across fixture-backed tests.
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });
});
