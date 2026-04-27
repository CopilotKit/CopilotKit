import { describe, it, expect, beforeEach } from "vitest";
import {
  createE2eDeepDriver,
  D5_SCRIPT_FILE_MATCHER,
  e2eDeepDriver,
  type E2eDeepAggregateSignal,
  type E2eDeepBrowser,
  type E2eDeepBrowserContext,
  type E2eDeepFeatureSignal,
  type E2eDeepPage,
} from "./e2e-deep.js";
import {
  __clearD5RegistryForTesting,
  registerD5Script,
  type D5Script,
} from "../helpers/d5-registry.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver tests for the e2e-deep (D5) ProbeDriver.
//
// We mock the browser, the registry (via the registerD5Script + clear
// helper), and the script loader (a no-op so the test never touches
// disk). Each test populates the registry with the script(s) it needs.

// --- Page / browser fakes -------------------------------------------------

interface PageScript {
  /** Throw on the goto call — surfaces as `errorClass: "goto-error"`. */
  throwOnGoto?: Error;
  /**
   * If true, every `page.evaluate` call returns `0` — the assistant
   * never "responds", so the conversation-runner times out. Used by
   * the failure-mode tests.
   */
  stallEvaluate?: boolean;
}

/**
 * Turn-aware page fake. The conversation-runner pattern:
 *   - reads baseline count once before the loop (call N)
 *   - for each turn: fills+presses, then polls evaluate until count
 *     grows past baseline AND stays stable for `assistantSettleMs`.
 *
 * To make each turn settle promptly we route evaluate calls through a
 * counter that grows after every `press()`. The first evaluate after
 * a press returns `prevCount + 1`, subsequent evaluates within the
 * same turn return the same count (stable → settle window elapses).
 *
 * The default `assistantSettleMs` (1500ms) means each successful turn
 * still costs ~1.5s of wall time — unavoidable without overriding
 * the option, which the driver does NOT expose. Tests that exercise
 * the happy path keep the turn count at 1 so the test budget stays
 * reasonable; multi-turn assertions live in the conversation-runner's
 * own tests.
 */
function makePage(script: PageScript = {}): E2eDeepPage {
  let messageCount = 0;
  return {
    async goto() {
      if (script.throwOnGoto) throw script.throwOnGoto;
    },
    async waitForSelector() {
      /* always resolves — chat input found */
    },
    async fill() {
      /* no-op */
    },
    async press() {
      // Simulate the assistant generating a new message after the
      // user's press(Enter). Without stallEvaluate the count grows
      // by one; the runner's poll then detects growth and settles.
      if (!script.stallEvaluate) {
        messageCount++;
      }
    },
    async evaluate<R>(fn: () => R): Promise<R> {
      void fn;
      return messageCount as unknown as R;
    },
    async click() {
      /* no-op */
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
): { browser: E2eDeepBrowser; state: FakeBrowserState } {
  let pageIdx = 0;
  const browser: E2eDeepBrowser = {
    async newContext(): Promise<E2eDeepBrowserContext> {
      state.contextsOpened++;
      return {
        async newPage(): Promise<E2eDeepPage> {
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
    now: () => new Date("2026-04-25T00:00:00Z"),
    logger,
    env,
    writer,
  };
}

function makeScript(overrides: Partial<D5Script> = {}): D5Script {
  return {
    featureTypes: ["agentic-chat"],
    fixtureFile: "agentic-chat.json",
    buildTurns: () => [{ input: "hello there" }],
    ...overrides,
  };
}

// --- Tests ---------------------------------------------------------------

describe("e2e-deep driver", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("exposes kind === 'e2e_deep'", () => {
    expect(e2eDeepDriver.kind).toBe("e2e_deep");
  });

  it("emits aggregate green and one side row per declared feature when scripts run cleanly", async () => {
    // Single-turn scripts keep the wall-clock cost low (~1.5s per
    // settle window × 2 features = ~3s). Multi-turn behaviour is
    // covered by the conversation-runner's own tests.
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "good name for a goldfish" }],
      }),
    );
    registerD5Script(
      makeScript({
        featureTypes: ["tool-rendering"],
        fixtureFile: "tool-rendering.json",
        buildTurns: () => [{ input: "weather in SF" }],
      }),
    );

    const { browser, state } = makeBrowser([{}, {}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* registry already populated above */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.key).toBe("e2e-deep:showcase-langgraph-python");
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.shape).toBe("package");
    expect(sig.slug).toBe("langgraph-python");
    expect(sig.total).toBe(2);
    expect(sig.passed).toBe(2);
    expect(sig.failed).toEqual([]);
    expect(sig.skipped).toEqual([]);

    // Per-feature key shape `d5:<slug>/<featureType>`.
    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "d5:langgraph-python/agentic-chat",
      "d5:langgraph-python/tool-rendering",
    ]);
    for (const w of writes) {
      expect(w.state).toBe("green");
      const fsig = w.signal as E2eDeepFeatureSignal;
      expect(fsig.slug).toBe("langgraph-python");
      expect(fsig.fixtureFile).toBeDefined();
      // Default route: /demos/<featureType>
      expect(fsig.url).toMatch(/\/demos\/(agentic-chat|tool-rendering)$/);
    }

    // Browser teardown.
    expect(state.closed).toBe(true);
    expect(state.contextsOpened).toBe(2);
    expect(state.contextsClosed).toBe(2);
  });

  it("skips features without a registered script and emits a green note row", async () => {
    // Only register agentic-chat; tool-rendering should be marked
    // skipped (Wave 2b not landed yet).
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

    const { browser } = makeBrowser([{}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-mastra",
      publicUrl: "https://showcase-mastra.example.com",
      name: "showcase-mastra",
      features: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(2);
    expect(sig.passed).toBe(1);
    expect(sig.failed).toEqual([]);
    expect(sig.skipped).toEqual(["tool-rendering"]);

    const byKey = new Map(writes.map((w) => [w.key, w]));
    const skipped = byKey.get("d5:mastra/tool-rendering");
    expect(skipped?.state).toBe("green");
    const skippedSig = skipped?.signal as E2eDeepFeatureSignal;
    expect(skippedSig?.note).toMatch(/no script registered/);

    const ran = byKey.get("d5:mastra/agentic-chat");
    expect(ran?.state).toBe("green");
  });

  it("emits red when the conversation-runner reports a failure_turn", async () => {
    // Drive a 2-turn script. The fake page's evaluate sequence holds
    // count at 0 forever after baseline so the runner times out on
    // turn 1 — runner returns failure_turn=1.
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [
          // Tight per-turn timeout so the test doesn't sit on the
          // default 30s response timeout.
          { input: "first turn", responseTimeoutMs: 200 },
          { input: "second turn" },
        ],
      }),
    );

    // Stall evaluate — assistant never "responds", so the runner times
    // out per the per-turn responseTimeoutMs override above.
    const { browser } = makeBrowser([{ stallEvaluate: true }]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.failed).toEqual(["agentic-chat"]);
    expect(sig.passed).toBe(0);

    const sideRow = writes.find(
      (w) => w.key === "d5:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("red");
    const fsig = sideRow?.signal as E2eDeepFeatureSignal;
    expect(fsig.failure_turn).toBe(1);
    expect(fsig.errorClass).toBe("conversation-error");
    expect(fsig.errorDesc).toMatch(/timeout/i);
  });

  it("emits red with goto-error when navigation fails", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

    const { browser } = makeBrowser([
      { throwOnGoto: new Error("net::ERR_CONNECTION_REFUSED") },
    ]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-mastra",
      publicUrl: "https://showcase-mastra.example.com",
      name: "showcase-mastra",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.failed).toEqual(["agentic-chat"]);

    const sideRow = writes.find((w) => w.key === "d5:mastra/agentic-chat");
    expect(sideRow?.state).toBe("red");
    const fsig = sideRow?.signal as E2eDeepFeatureSignal;
    expect(fsig.errorClass).toBe("goto-error");
    expect(fsig.errorDesc).toMatch(/ERR_CONNECTION_REFUSED/);
  });

  it("uses preNavigateRoute when the script overrides the default", async () => {
    // mcp-apps maps to /demos/subagents in the LGP showcase per
    // fixture README — exercise that route override.
    registerD5Script(
      makeScript({
        featureTypes: ["mcp-apps"],
        fixtureFile: "mcp-subagents.json",
        preNavigateRoute: () => "/demos/subagents",
        buildTurns: () => [{ input: "delegate to research" }],
      }),
    );

    const { browser } = makeBrowser([{}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer, writes } = mkWriter();

    await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["mcp-apps"],
      shape: "package",
    });

    const sideRow = writes.find(
      (w) => w.key === "d5:langgraph-python/mcp-apps",
    );
    const fsig = sideRow?.signal as E2eDeepFeatureSignal;
    expect(fsig.url).toBe(
      "https://showcase-langgraph-python.example.com/demos/subagents",
    );
  });

  it("short-circuits green for starter shape without launching browser", async () => {
    let launched = false;
    const driver = createE2eDeepDriver({
      launcher: async () => {
        launched = true;
        const { browser } = makeBrowser([{}]);
        return browser;
      },
      scriptLoader: async () => {
        /* no-op */
      },
    });

    const result = await driver.run(mkCtx(), {
      key: "e2e-deep:showcase-mastra-starter",
      publicUrl: "https://showcase-mastra-starter.example.com",
      name: "showcase-mastra-starter",
      features: ["agentic-chat"],
      shape: "starter",
    });

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.shape).toBe("starter");
    expect(sig.note).toMatch(/starter/);
  });

  it("returns aggregate green with zero rows and no browser launch when scripts directory is empty", async () => {
    // Wave 2b not yet landed: no scripts registered, no scripts on
    // disk. The driver must still typecheck and run cleanly. Empty
    // registry + features list both empty → aggregate green, no
    // browser launch, no rows emitted.
    let launched = false;
    const driver = createE2eDeepDriver({
      launcher: async () => {
        launched = true;
        const { browser } = makeBrowser([{}]);
        return browser;
      },
      scriptLoader: async () => {
        /* registry stays empty */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      // No features declared → short-circuit BEFORE script-loader.
      features: [],
      shape: "package",
    });

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(0);
    expect(sig.note).toMatch(/no D5 features declared/);
    expect(writes).toEqual([]);
  });

  it("when only skipped features remain, emits green aggregate + skipped side rows without launching browser", async () => {
    // Features declared, but no scripts registered for ANY of them →
    // aggregate green (no failures), skipped[] populated, no chromium.
    let launched = false;
    const driver = createE2eDeepDriver({
      launcher: async () => {
        launched = true;
        const { browser } = makeBrowser([{}]);
        return browser;
      },
      scriptLoader: async () => {
        /* registry stays empty */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-mastra",
      publicUrl: "https://showcase-mastra.example.com",
      name: "showcase-mastra",
      features: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.skipped.sort()).toEqual(["agentic-chat", "tool-rendering"]);
    expect(sig.passed).toBe(0);
    expect(sig.failed).toEqual([]);

    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "d5:mastra/agentic-chat",
      "d5:mastra/tool-rendering",
    ]);
  });

  it("returns red with launcher-error when the browser fails to launch", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

    const driver = createE2eDeepDriver({
      launcher: async () => {
        throw new Error("chromium launch failed: ENOENT");
      },
      scriptLoader: async () => {
        /* no-op */
      },
    });

    const result = await driver.run(mkCtx(), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.errorDesc).toBe("launcher-error");
    expect(sig.failureSummary).toMatch(/chromium launch failed/);
  });

  it("derives features from demos[] when explicit features are absent", async () => {
    // Production discovery (`railway-services`) populates `demos`
    // with registry feature IDs; the driver maps them to D5 feature
    // types via `demosToFeatureTypes`. Use the registry → D5 mapping
    // to drive a service whose declared `demos[]` carry IDs that
    // DON'T match a D5 type verbatim:
    //   - `tool-rendering-default-catchall` → `tool-rendering`
    //   - `shared-state-read-write` → BOTH `shared-state-read` AND
    //     `shared-state-write` (one-to-many)
    //   - `voice` is unmapped and silently dropped.
    // Only the shared-state script is registered, so
    // `tool-rendering` lands in `skipped[]` — the test exercises
    // both the mapping AND the closed-set filter without paying
    // the per-feature ~1.5s settle window for every demo.
    registerD5Script(
      makeScript({
        featureTypes: ["shared-state-read", "shared-state-write"],
        fixtureFile: "shared-state.json",
      }),
    );

    const { browser } = makeBrowser([{}, {}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* registry already populated above */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      // No `features` field — production discovery shape.
      demos: [
        "tool-rendering-default-catchall", // → tool-rendering (skipped, no script)
        "shared-state-read-write", // → shared-state-read + shared-state-write (run)
        "voice", // unmapped → dropped
      ],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    // 3 mapped D5 types: tool-rendering (skipped) + shared-state-read
    // + shared-state-write (both run). `voice` was dropped before
    // counting.
    expect(sig.total).toBe(3);
    expect(sig.passed).toBe(2);
    expect(sig.failed).toEqual([]);
    expect(sig.skipped).toEqual(["tool-rendering"]);

    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "d5:langgraph-python/shared-state-read",
      "d5:langgraph-python/shared-state-write",
      "d5:langgraph-python/tool-rendering",
    ]);
  });

  it("explicit features wins over demos when both are present", async () => {
    // Tests pass `features` directly. Verify the demos fallback is
    // NOT consulted when `features` carries entries — otherwise the
    // existing test suite's `features: [...]` calls would silently
    // pull in extra D5 types from a populated `demos` field.
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

    const { browser } = makeBrowser([{}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* registry already populated above */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      // demos would normally add tool-rendering + more — overridden
      // by explicit features, so the driver runs only agentic-chat.
      demos: ["tool-rendering", "hitl-in-app", "shared-state-read-write"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(1);
    expect(sig.passed).toBe(1);
    expect(writes.map((w) => w.key)).toEqual([
      "d5:langgraph-python/agentic-chat",
    ]);
  });

  it("short-circuits 'no D5 features declared' when both demos and features are empty", async () => {
    // Both empty: discovery emitted a record with neither field
    // populated (e.g. unmapped service whose slug isn't in
    // registry.json). The driver must still take the no-op green
    // path WITHOUT launching chromium — otherwise we pay the launch
    // cost on every unmapped service.
    let launched = false;
    const driver = createE2eDeepDriver({
      launcher: async () => {
        launched = true;
        const { browser } = makeBrowser([{}]);
        return browser;
      },
      scriptLoader: async () => {
        /* registry stays empty */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-mystery",
      publicUrl: "https://showcase-mystery.example.com",
      name: "showcase-mystery",
      features: [],
      demos: [],
      shape: "package",
    });

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(0);
    expect(sig.note).toMatch(/no D5 features declared/);
    expect(writes).toEqual([]);
  });
});

describe("D5_SCRIPT_FILE_MATCHER", () => {
  it("accepts canonical d5-<name>.{js,ts} files", () => {
    expect(D5_SCRIPT_FILE_MATCHER.test("d5-agentic-chat.ts")).toBe(true);
    expect(D5_SCRIPT_FILE_MATCHER.test("d5-tool-rendering.js")).toBe(true);
    expect(D5_SCRIPT_FILE_MATCHER.test("d5-hitl-approve-deny.ts")).toBe(true);
  });

  it("rejects co-located test files (would re-import script under test)", () => {
    expect(D5_SCRIPT_FILE_MATCHER.test("d5-agentic-chat.test.ts")).toBe(false);
    expect(D5_SCRIPT_FILE_MATCHER.test("d5-tool-rendering.test.js")).toBe(
      false,
    );
  });

  it("rejects TypeScript declaration files", () => {
    expect(D5_SCRIPT_FILE_MATCHER.test("d5-agentic-chat.d.ts")).toBe(false);
  });

  it("rejects shared helpers and non-d5 files", () => {
    expect(D5_SCRIPT_FILE_MATCHER.test("_hitl-shared.ts")).toBe(false);
    expect(D5_SCRIPT_FILE_MATCHER.test("d6-capture-references.ts")).toBe(false);
    expect(D5_SCRIPT_FILE_MATCHER.test("README.md")).toBe(false);
  });
});

// Regression test for the ASI bug in the page-evaluated transcript reader.
//
// D5 probe helpers (readAssistantTranscript, readLatestAssistantText, etc.)
// build a code string from a template literal, wrap it via
// `new Function("return " + code)`, and pass the result to `page.evaluate`.
// When the code string begins with a newline, JavaScript's Automatic
// Semicolon Insertion (ASI) terminates the `return` statement BEFORE the
// IIFE runs, so the function returns `undefined` and the assistant message
// count stays at 0 — the conversation-runner then times out on every turn.
//
// The fix is to `.trim()` the code before concatenation so the IIFE
// follows `return ` on the same line.
describe("ASI / new Function evaluate", () => {
  // The code shape our probe helpers use:
  //   new Function("return " + code)()
  // When code opens with "\n  (() => ...)()" ASI bites.
  const codeWithLeadingNewline = '\n  (() => { return "hello"; })()\n';

  it("demonstrates the ASI bug: leading-newline code returns undefined", () => {
    // This mirrors the BROKEN call shape:
    //   new Function("return " + "\n  (() => {...})()\n")()
    // ASI inserts a semicolon after `return`, the IIFE becomes dead
    // code, and the function returns undefined.
    const broken = new Function("return " + codeWithLeadingNewline);
    expect(broken()).toBeUndefined();
  });

  it("trim() fix: leading newline removed → IIFE is reached and value returned", () => {
    // The fix: strip leading whitespace/newlines before concatenation
    // so `return` and the IIFE share a line. A trailing semicolon is
    // also added defensively.
    const fixed = new Function("return " + codeWithLeadingNewline.trim() + ";");
    expect(fixed()).toBe("hello");
  });

  it("ASI bug also bites realistic transcript-reader code shape", () => {
    // Approximates the readAssistantTranscript pattern: a page-side
    // IIFE that walks the DOM and returns a count. Without trim() the
    // function returns undefined; with trim() it returns the count.
    const transcriptLikeCode = `
      (() => {
        const fakeMessages = [1, 2, 3];
        return fakeMessages.length;
      })()
    `;

    const broken = new Function("return " + transcriptLikeCode);
    expect(broken()).toBeUndefined();

    const fixed = new Function("return " + transcriptLikeCode.trim() + ";");
    expect(fixed()).toBe(3);
  });
});
