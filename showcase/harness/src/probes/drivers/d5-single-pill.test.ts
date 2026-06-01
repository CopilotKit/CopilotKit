import { describe, it, expect, beforeEach } from "vitest";
import {
  createE2eDeepDriver,
  createPooledE2eDeepLauncher,
  D5_SCRIPT_FILE_MATCHER,
  DEPLOY_CHURN_GRACE_MS,
  e2eDeepDriver,
  FEATURE_CONCURRENCY,
  Semaphore,
} from "./d5-single-pill.js";
import type {
  E2eDeepAggregateSignal,
  E2eDeepBrowser,
  E2eDeepBrowserContext,
  E2eDeepFeatureSignal,
  E2eDeepPage,
} from "./d5-single-pill.js";
import {
  __clearD5RegistryForTesting,
  registerD5Script,
} from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
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
    async waitForFunction() {
      /* hydration guard — fake passes immediately */
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
  nowFn?: () => Date,
): ProbeContext {
  return {
    now: nowFn ?? (() => new Date("2026-04-25T00:00:00Z")),
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
    // Timeout budget: fillAndVerifySend retries up to
    // SEND_VERIFY_MAX_ATTEMPTS (3) × (SEND_VERIFY_INITIAL_DELAY_MS +
    // remaining poll window) ≈ 6s when stallEvaluate prevents the user
    // message count from growing, plus the 200ms responseTimeoutMs
    // deadline. 15s absorbs CI variance without masking real hangs.
  }, 15_000);

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
    //   - `shared-state-read-write` → `shared-state-write` (write half;
    //     the read half is owned by the standalone recipe-editor probe)
    //   - `voice` → `voice` (mapped, but no script → skipped).
    // Only the shared-state-write script is registered, so
    // `tool-rendering` lands in `skipped[]` — the test exercises
    // both the mapping AND the closed-set filter without paying
    // the per-feature ~1.5s settle window for every demo.
    registerD5Script(
      makeScript({
        featureTypes: ["shared-state-write"],
        fixtureFile: "shared-state.json",
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
      // No `features` field — production discovery shape.
      demos: [
        "tool-rendering-default-catchall", // → tool-rendering-default-catchall (skipped, no script in this test's mock loader)
        "shared-state-read-write", // → shared-state-write (run); the read half is owned by the standalone recipe-editor probe
        "voice", // → voice (skipped, no script in this test's mock loader)
      ],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    // 3 mapped D5 types: tool-rendering-default-catchall (skipped) +
    // shared-state-write (run) + voice (skipped). The Phase-2A
    // registry split repointed `tool-rendering-default-catchall`
    // (registry id) to its own D5 type of the same name; mock loader
    // here only registers shared-state-write, so the other two skip.
    expect(sig.total).toBe(3);
    expect(sig.passed).toBe(1);
    expect(sig.failed).toEqual([]);
    expect(sig.skipped).toEqual(["tool-rendering-default-catchall", "voice"]);

    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "d5:langgraph-python/shared-state-write",
      "d5:langgraph-python/tool-rendering-default-catchall",
      "d5:langgraph-python/voice",
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

// ---------------------------------------------------------------------
// B0: Semaphore concurrency tests — verifies the counting semaphore
// gates concurrent access to a bounded resource.
// ---------------------------------------------------------------------
describe("Semaphore", () => {
  it("never allows more than `limit` concurrent acquires", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    let completed = 0;

    const task = async (): Promise<void> => {
      await sem.acquire();
      active++;
      if (active > peak) peak = active;
      // Hold the slot for 50ms to give other tasks a chance to
      // attempt acquisition and queue behind the semaphore.
      await new Promise((r) => setTimeout(r, 50));
      active--;
      completed++;
      sem.release();
    };

    await Promise.all([task(), task(), task(), task(), task()]);

    expect(peak).toBeLessThanOrEqual(2);
    expect(completed).toBe(5);
  });

  it("with limit=1, tasks run sequentially (peak concurrency is 1)", async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let peak = 0;

    const task = async (): Promise<void> => {
      await sem.acquire();
      active++;
      if (active > peak) peak = active;
      await new Promise((r) => setTimeout(r, 20));
      active--;
      sem.release();
    };

    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(1);
  });

  it("with limit >= task count, all tasks run concurrently", async () => {
    const sem = new Semaphore(10);
    let active = 0;
    let peak = 0;

    const task = async (): Promise<void> => {
      await sem.acquire();
      active++;
      if (active > peak) peak = active;
      await new Promise((r) => setTimeout(r, 20));
      active--;
      sem.release();
    };

    await Promise.all([task(), task(), task()]);
    expect(peak).toBe(3);
  });
});

// ---------------------------------------------------------------------
// B0: Feature parallelism — verifies that with FEATURE_CONCURRENCY=2,
// features execute concurrently (not sequentially).
// ---------------------------------------------------------------------
describe("e2e-deep feature parallelism", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("FEATURE_CONCURRENCY is 2", () => {
    // Smoke check: the constant exported from the driver is the value
    // the spec mandates. If someone changes it the parallelism tests
    // become invalid.
    expect(FEATURE_CONCURRENCY).toBe(2);
  });

  it("features with a registered script run concurrently (wall-clock < sequential)", async () => {
    // Register 4 features. Each conversation will take ~50ms (the
    // page.press sleep in the fake). With FEATURE_CONCURRENCY=2,
    // batched execution takes ~2 batches × settle time instead of 4.
    // We can't use the settle timer (1500ms default) because that
    // would make the test take 6+ seconds. Instead we measure that
    // contexts are opened concurrently by tracking overlap in the
    // browser fake.
    const featureTypes = [
      "agentic-chat",
      "tool-rendering",
      "shared-state-read",
      "shared-state-write",
    ] as const;

    for (const ft of featureTypes) {
      registerD5Script(
        makeScript({
          featureTypes: [ft],
          fixtureFile: `${ft}.json`,
          buildTurns: () => [{ input: `test ${ft}` }],
        }),
      );
    }

    // Track concurrent context opens to verify parallelism.
    let activeContexts = 0;
    let peakContexts = 0;
    let totalContexts = 0;

    const browser: E2eDeepBrowser = {
      async newContext(): Promise<E2eDeepBrowserContext> {
        activeContexts++;
        totalContexts++;
        if (activeContexts > peakContexts) peakContexts = activeContexts;
        return {
          async newPage(): Promise<E2eDeepPage> {
            return makePage({});
          },
          async close() {
            activeContexts--;
          },
        };
      },
      async close() {
        /* no-op */
      },
    };

    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* registry already populated */
      },
    });
    const { writer } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-test",
      publicUrl: "https://showcase-test.example.com",
      name: "showcase-test",
      features: [...featureTypes],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(4);
    expect(totalContexts).toBe(4);
    // With FEATURE_CONCURRENCY=2, peak concurrent contexts should be 2
    // (not 4 and not 1).
    expect(peakContexts).toBe(2);
  });
});

// ---------------------------------------------------------------------
// B2: Feature-type filtering — verifies the trigger layer's
// featureTypes filter is threaded to the driver and restricts which
// features run.
// ---------------------------------------------------------------------
describe("e2e-deep feature-type filtering (driver level)", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("only runs features matching ctx.featureTypes, skips others with 'filtered-by-trigger'", async () => {
    // Register two features but only allow one via the trigger filter.
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );
    registerD5Script(
      makeScript({
        featureTypes: ["tool-rendering"],
        fixtureFile: "tool-rendering.json",
        buildTurns: () => [{ input: "weather" }],
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

    // Pass featureTypes filter on ProbeContext — only tool-rendering.
    const ctx = mkCtx(writer);
    ctx.featureTypes = ["tool-rendering"];

    const result = await driver.run(ctx, {
      key: "e2e-deep:showcase-test",
      publicUrl: "https://showcase-test.example.com",
      name: "showcase-test",
      features: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    // total includes both features
    expect(sig.total).toBe(2);
    // only tool-rendering passed (ran); agentic-chat is skipped
    expect(sig.passed).toBe(1);
    expect(sig.skipped).toContain("agentic-chat");
    expect(sig.failed).toEqual([]);

    // Verify the skipped row carries the "filtered-by-trigger" note
    const byKey = new Map(writes.map((w) => [w.key, w]));
    const skippedRow = byKey.get("d5:test/agentic-chat");
    expect(skippedRow).toBeDefined();
    expect(skippedRow?.state).toBe("green");
    const skippedSig = skippedRow?.signal as E2eDeepFeatureSignal;
    expect(skippedSig.note).toBe("filtered-by-trigger");

    // The running row should be green with no note
    const ranRow = byKey.get("d5:test/tool-rendering");
    expect(ranRow).toBeDefined();
    expect(ranRow?.state).toBe("green");
  });

  it("when all features are filtered out, returns green with 'all runnable features filtered by trigger'", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );

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
    const { writer, writes } = mkWriter();

    const ctx = mkCtx(writer);
    ctx.featureTypes = ["hitl-text-input"]; // scriptLoader no-op so no probe loaded

    const result = await driver.run(ctx, {
      key: "e2e-deep:showcase-test",
      publicUrl: "https://showcase-test.example.com",
      name: "showcase-test",
      features: ["agentic-chat"],
      shape: "package",
    });

    // No browser launched because all runnable features were filtered
    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.note).toMatch(/all runnable features filtered by trigger/);
    expect(sig.skipped).toContain("agentic-chat");

    // The skipped row should carry "filtered-by-trigger"
    expect(writes).toHaveLength(1);
    const fSig = writes[0].signal as E2eDeepFeatureSignal;
    expect(fSig.note).toBe("filtered-by-trigger");
  });
});

// ---------------------------------------------------------------------
// B0: Graceful degradation — with FEATURE_CONCURRENCY=1, behaviour is
// equivalent to sequential execution.
// ---------------------------------------------------------------------
describe("e2e-deep graceful degradation (FEATURE_CONCURRENCY=1 equivalent)", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("single-concurrency driver still runs all features and produces correct results", async () => {
    // We can't change the constant at runtime, but we can verify that
    // a driver with custom deps that creates a Semaphore(1) still
    // completes correctly. The real FEATURE_CONCURRENCY constant is
    // tested above; here we just verify the driver's run() produces
    // correct aggregate results regardless of execution ordering.
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );
    registerD5Script(
      makeScript({
        featureTypes: ["tool-rendering"],
        fixtureFile: "tool-rendering.json",
        buildTurns: () => [{ input: "weather" }],
      }),
    );

    const { browser, state } = makeBrowser([{}, {}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-test",
      publicUrl: "https://showcase-test.example.com",
      name: "showcase-test",
      features: ["agentic-chat", "tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(2);
    expect(sig.passed).toBe(2);
    expect(sig.failed).toEqual([]);

    // Both features produced side rows
    const sideKeys = writes.map((w) => w.key).sort();
    expect(sideKeys).toEqual([
      "d5:test/agentic-chat",
      "d5:test/tool-rendering",
    ]);

    // All contexts were opened and closed properly
    expect(state.contextsOpened).toBe(2);
    expect(state.contextsClosed).toBe(2);
    expect(state.closed).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Context-pool migration: createPooledE2eDeepLauncher now checks out a
// pooled CONTEXT per newContext() (pool.acquire) and releases it on close
// (pool.release). maxContexts (reinterpreted POOL_SIZE) is the global cap;
// each context acquire/release moves inUse by 1. On abort the launcher
// closes its open contexts (each releasing its context) — NO browser fork.
// The per-feature X-AIMock-Context / X-Test-Id headers must flow through
// to pool.acquire so aimock routing still works.
// ---------------------------------------------------------------------
/**
 * Fake context-pool tracking per-CONTEXT acquire/release and the
 * contextOptions each acquire was called with (so header forwarding is
 * observable). `maxContexts` is the global cap. Module-scoped so oxlint's
 * consistent-function-scoping is satisfied (captures no parent state).
 */
function makeDeepFakeContextPool(maxContexts: number) {
  let nextCtxId = 0;
  // Track the set of currently-live contexts so release fidelity matches
  // the real BrowserPool: an unknown / double release is a no-op (does
  // NOT decrement the count). The previous unconditional decrement could
  // drive `live` negative and silently mask a double-release bug.
  const liveContexts = new Set<object>();
  const releaseLog: number[] = [];
  const acquireLog: number[] = [];
  const acquireOptions: Array<
    { extraHTTPHeaders?: Record<string, string> } | undefined
  > = [];

  return {
    async acquire(options?: {
      extraHTTPHeaders?: Record<string, string>;
    }): Promise<unknown> {
      if (liveContexts.size >= maxContexts) throw new Error("FakePool: at cap");
      const id = nextCtxId++;
      acquireLog.push(id);
      acquireOptions.push(options);
      const ctx = {
        __id: id,
        async newPage() {
          return {
            on: () => {},
            waitForSelector: async () => {},
            fill: async () => {},
            press: async () => {},
            evaluate: async () => 0,
            goto: async () => {},
            close: async () => {},
            click: async () => {},
            waitForFunction: async () => {},
          };
        },
        async close() {},
      };
      liveContexts.add(ctx);
      return ctx;
    },
    async release(ctx: unknown): Promise<void> {
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
    get _acquireLog() {
      return acquireLog;
    },
    get _acquireOptions() {
      return acquireOptions;
    },
  };
}

describe("createPooledE2eDeepLauncher context checkout + abort release", () => {
  it("checks out one context per newContext() and moves inUse by 1", async () => {
    const pool = makeDeepFakeContextPool(4);
    const launcher = createPooledE2eDeepLauncher(
      pool as unknown as import("../helpers/browser-pool.js").BrowserPool,
    );
    const browser = await launcher();
    expect(pool.stats().inUse).toBe(0);

    const ctx = await browser.newContext();
    expect(pool.stats().inUse).toBe(1);
    expect(pool.stats().available).toBe(3);

    await ctx.close();
    expect(pool.stats().inUse).toBe(0);
    expect(pool._releaseLog).toHaveLength(1);
  });

  it("forwards newContext(opts).extraHTTPHeaders into pool.acquire", async () => {
    const pool = makeDeepFakeContextPool(2);
    const launcher = createPooledE2eDeepLauncher(
      pool as unknown as import("../helpers/browser-pool.js").BrowserPool,
    );
    const browser = await launcher();
    await browser.newContext({
      extraHTTPHeaders: {
        "X-AIMock-Context": "slug-x",
        "X-Test-Id": "d5-slug-x",
      },
    });
    expect(pool._acquireOptions[0]).toEqual({
      extraHTTPHeaders: {
        "X-AIMock-Context": "slug-x",
        "X-Test-Id": "d5-slug-x",
      },
    });
  });

  it("closes open contexts on abort (each releasing its pooled context)", async () => {
    const pool = makeDeepFakeContextPool(2);
    const launcher = createPooledE2eDeepLauncher(
      pool as unknown as import("../helpers/browser-pool.js").BrowserPool,
    );

    const abortCtrl = new AbortController();
    const browser = await launcher(abortCtrl.signal);

    const ctx = await browser.newContext();
    const _page = await ctx.newPage();
    expect(pool.stats().inUse).toBe(1);

    abortCtrl.abort();
    await new Promise((r) => setTimeout(r, 10));

    expect(pool._releaseLog).toHaveLength(1);
    expect(pool.stats().inUse).toBe(0);
  });

  it("launcher-level close is a no-op (contexts release themselves)", async () => {
    const pool = makeDeepFakeContextPool(2);
    const launcher = createPooledE2eDeepLauncher(
      pool as unknown as import("../helpers/browser-pool.js").BrowserPool,
    );
    const browser = await launcher();
    const ctx = await browser.newContext();
    await ctx.close();
    await browser.close(); // no-op
    expect(pool._releaseLog).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------
// Deploy-churn grace window — verifies that the driver skips all
// features for a service that deployed within DEPLOY_CHURN_GRACE_MS,
// emitting green side rows with a skip note and an aggregate green.
// ---------------------------------------------------------------------
describe("e2e-deep deploy-churn grace window", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("DEPLOY_CHURN_GRACE_MS is 120_000 (2 minutes)", () => {
    expect(DEPLOY_CHURN_GRACE_MS).toBe(120_000);
  });

  it("skips all features when deployedAt is within the grace window", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );
    registerD5Script(
      makeScript({
        featureTypes: ["tool-rendering"],
        fixtureFile: "tool-rendering.json",
        buildTurns: () => [{ input: "weather" }],
      }),
    );

    let launched = false;
    const driver = createE2eDeepDriver({
      launcher: async () => {
        launched = true;
        const { browser } = makeBrowser([{}, {}]);
        return browser;
      },
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer, writes } = mkWriter();

    // Service deployed 30 seconds ago — well within the 120s grace.
    const now = new Date("2026-04-25T00:02:00Z");
    const deployedAt = new Date("2026-04-25T00:01:30Z").toISOString();

    const result = await driver.run(
      mkCtx(writer, {}, () => now),
      {
        key: "e2e-deep:showcase-langgraph-python",
        publicUrl: "https://showcase-langgraph-python.example.com",
        name: "showcase-langgraph-python",
        features: ["agentic-chat", "tool-rendering"],
        shape: "package",
        deployedAt,
      },
    );

    // No browser launched — the skip fires before chromium.
    expect(launched).toBe(false);

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(2);
    expect(sig.passed).toBe(0);
    expect(sig.failed).toEqual([]);
    expect(sig.skipped).toEqual(["agentic-chat", "tool-rendering"]);
    expect(sig.note).toMatch(/deploy-churn skip/);
    expect(sig.note).toMatch(/30s ago/);

    // Both features emitted as green side rows with skip note.
    expect(writes).toHaveLength(2);
    for (const w of writes) {
      expect(w.state).toBe("green");
      const fSig = w.signal as E2eDeepFeatureSignal;
      expect(fSig.note).toMatch(/skipped: deploy in progress/);
      expect(fSig.note).toMatch(/30s ago/);
    }
  });

  it("proceeds normally when deployedAt is older than the grace window", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
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

    // Service deployed 5 minutes ago — outside the 120s grace.
    const now = new Date("2026-04-25T00:05:00Z");
    const deployedAt = new Date("2026-04-25T00:00:00Z").toISOString();

    const result = await driver.run(
      mkCtx(writer, {}, () => now),
      {
        key: "e2e-deep:showcase-langgraph-python",
        publicUrl: "https://showcase-langgraph-python.example.com",
        name: "showcase-langgraph-python",
        features: ["agentic-chat"],
        shape: "package",
        deployedAt,
      },
    );

    // Normal execution — the feature ran.
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(1);
    expect(sig.note).toBeUndefined();

    expect(writes).toHaveLength(1);
    expect(writes[0]!.state).toBe("green");
    const fSig = writes[0]!.signal as E2eDeepFeatureSignal;
    expect(fSig.note).toBeUndefined();
  });

  it("proceeds normally when deployedAt is absent (backwards compat)", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
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
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
      // No deployedAt field — legacy input shape.
    });

    // Normal execution.
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(1);
  });

  it("proceeds normally when deployedAt is an empty string", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );

    const { browser } = makeBrowser([{}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
      deployedAt: "",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(1);
  });

  it("proceeds normally when deployedAt is an unparseable string", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );

    const { browser } = makeBrowser([{}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
      deployedAt: "not-a-date",
    });

    // Unparseable date → no skip, normal execution.
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(1);
  });

  it("skips at exactly 0s age (just deployed)", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

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
    const { writer, writes } = mkWriter();

    const now = new Date("2026-04-25T00:00:00Z");

    const result = await driver.run(
      mkCtx(writer, {}, () => now),
      {
        key: "e2e-deep:showcase-mastra",
        publicUrl: "https://showcase-mastra.example.com",
        name: "showcase-mastra",
        features: ["agentic-chat"],
        shape: "package",
        deployedAt: now.toISOString(), // ageMs === 0
      },
    );

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.note).toMatch(/deploy-churn skip/);
    expect(sig.note).toMatch(/0s ago/);

    expect(writes).toHaveLength(1);
    expect((writes[0]!.signal as E2eDeepFeatureSignal).note).toMatch(
      /skipped: deploy in progress/,
    );
  });

  it("does NOT skip when age equals exactly DEPLOY_CHURN_GRACE_MS (boundary)", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );

    const { browser } = makeBrowser([{}]);
    const driver = createE2eDeepDriver({
      launcher: async () => browser,
      scriptLoader: async () => {
        /* no-op */
      },
    });
    const { writer } = mkWriter();

    // deployedAt exactly 120_000ms (2 min) ago — boundary, should NOT skip.
    const now = new Date("2026-04-25T00:02:00Z");
    const deployedAt = new Date(
      now.getTime() - DEPLOY_CHURN_GRACE_MS,
    ).toISOString();

    const result = await driver.run(
      mkCtx(writer, {}, () => now),
      {
        key: "e2e-deep:showcase-langgraph-python",
        publicUrl: "https://showcase-langgraph-python.example.com",
        name: "showcase-langgraph-python",
        features: ["agentic-chat"],
        shape: "package",
        deployedAt,
      },
    );

    // Should proceed normally (ageMs === DEPLOY_CHURN_GRACE_MS, not <).
    expect(result.state).toBe("green");
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(1);
    expect(sig.note).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Pooled-context budget: feature-timeout must NOT free the semaphore slot
// until the orphaned (still-in-flight) runFeature's context is actually
// released. Otherwise a freed slot lets a new feature acquire a context
// while the orphan still holds one → live contexts exceed
// FEATURE_CONCURRENCY's budget.
//
// We model the pool with a launcher that tracks live/peak contexts and
// supports a controllably-slow context.close(). Each feature's goto hangs
// past `featureTimeoutMs` so the per-feature timer fires the synthetic
// `feature-timeout` verdict while runFeature keeps running and holding its
// context; context teardown then completes a tick later.
// ---------------------------------------------------------------------
/** Module-scoped timer helper (oxlint consistent-function-scoping). */
function testSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Launcher whose contexts simulate pooled checkout: `newContext` increments
 * a live counter (tracking peak), each context's page `goto` resolves only
 * after `gotoDelayMs`, and `close()` resolves only after `closeDelayMs`
 * (the orphan window). Module-scoped so oxlint's consistent-function-scoping
 * is satisfied.
 */
function makeSlowTeardownLauncher(opts: {
  gotoDelayMs: number;
  closeDelayMs: number;
}): {
  launcher: () => Promise<E2eDeepBrowser>;
  state: { live: number; peakLive: number; opened: number; closed: number };
} {
  const state = { live: 0, peakLive: 0, opened: 0, closed: 0 };
  const browser: E2eDeepBrowser = {
    async newContext(): Promise<E2eDeepBrowserContext> {
      state.live++;
      state.opened++;
      if (state.live > state.peakLive) state.peakLive = state.live;
      return {
        async newPage(): Promise<E2eDeepPage> {
          // Mirror makePage's growing-count contract so the conversation
          // settles quickly (no 30s response timeout): baseline 0, then
          // each press bumps the count so the runner detects growth and
          // settles. runFeature then reaches its finally and calls the
          // (deliberately slow) context.close().
          let messageCount = 0;
          return {
            async goto() {
              // Hang past the per-feature timeout so the synthetic
              // feature-timeout verdict resolves while this runFeature
              // (and its held context) is still in flight.
              await testSleep(opts.gotoDelayMs);
            },
            async waitForSelector() {},
            async fill() {},
            async press() {
              messageCount++;
            },
            async evaluate<R>() {
              return messageCount as unknown as R;
            },
            async click() {},
            async waitForFunction() {},
            async close() {},
          };
        },
        async close() {
          // The orphan window: the context stays live until this resolves.
          await testSleep(opts.closeDelayMs);
          state.live--;
          state.closed++;
        },
      };
    },
    async close() {},
  };
  return { launcher: async () => browser, state };
}

describe("e2e-deep feature-timeout pooled-context budget", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("does not exceed FEATURE_CONCURRENCY live contexts when features time out (slot release gated on orphan teardown)", async () => {
    // 3 features, FEATURE_CONCURRENCY=2. Features 1 & 2 acquire slots and
    // time out (goto hangs past featureTimeoutMs) but keep holding their
    // contexts until close() resolves (closeDelayMs later). Feature 3
    // waits in the semaphore queue. If the slot is freed at timeout
    // BEFORE the orphan's context is released, feature 3 acquires a 3rd
    // live context → peakLive === 3 (over budget). Gating slot release on
    // the in-flight runFeature settling keeps peakLive <= 2.
    expect(FEATURE_CONCURRENCY).toBe(2);

    const featureTypes = [
      "agentic-chat",
      "tool-rendering",
      "shared-state-read",
    ] as const;
    for (const ft of featureTypes) {
      registerD5Script(
        makeScript({
          featureTypes: [ft],
          fixtureFile: `${ft}.json`,
          buildTurns: () => [{ input: `test ${ft}` }],
        }),
      );
    }

    const { launcher, state } = makeSlowTeardownLauncher({
      gotoDelayMs: 60,
      closeDelayMs: 80,
    });

    const driver = createE2eDeepDriver({
      launcher,
      scriptLoader: async () => {},
      featureTimeoutMs: 20,
    });
    const { writer } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-test",
      publicUrl: "https://showcase-test.example.com",
      name: "showcase-test",
      features: [...featureTypes],
      shape: "package",
    });

    // All three features ran (timed out → red rows), and at no point did
    // more than FEATURE_CONCURRENCY contexts coexist.
    expect(state.opened).toBe(3);
    expect(state.peakLive).toBeLessThanOrEqual(FEATURE_CONCURRENCY);
    expect(state.live).toBe(0); // all released by the time run() resolves
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.total).toBe(3);
  }, 20_000);
});

// ---------------------------------------------------------------------
// Per-feature retry uses an isolated AbortController per attempt: a retry
// after a RETRY-ELIGIBLE failure must actually execute the second attempt
// rather than being silently short-circuited by a poisoned (pre-aborted)
// signal. We observe attempt execution via context-open count: runFeature
// returns `abort` WITHOUT opening a context if entered with an aborted
// signal, so a poisoned retry would open only ONE context. A healthy
// retry opens TWO.
// ---------------------------------------------------------------------
/**
 * Launcher whose first context FAILS with a retry-eligible `goto-error`
 * (goto rejects) and whose second context SUCCEEDS. Attempt 1's goto is
 * padded past RETRY_MIN_DURATION_MS so the retry gate fires. Tracks
 * contexts opened (one per executed attempt).
 */
function makeRetryLauncher(opts: { attempt1DelayMs: number }): {
  launcher: () => Promise<E2eDeepBrowser>;
  state: { opened: number };
} {
  const state = { opened: 0 };
  const browser: E2eDeepBrowser = {
    async newContext(): Promise<E2eDeepBrowserContext> {
      const attempt = ++state.opened;
      return {
        async newPage(): Promise<E2eDeepPage> {
          let messageCount = 0;
          return {
            async goto() {
              if (attempt === 1) {
                // Burn > RETRY_MIN_DURATION_MS, then fail retry-eligibly.
                await testSleep(opts.attempt1DelayMs);
                throw new Error("nav blip (retryable)");
              }
            },
            async waitForSelector() {},
            async fill() {},
            async press() {
              messageCount++;
            },
            async evaluate<R>() {
              return messageCount as unknown as R;
            },
            async click() {},
            async waitForFunction() {},
            async close() {},
          };
        },
        async close() {},
      };
    },
    async close() {},
  };
  return { launcher: async () => browser, state };
}

describe("e2e-deep per-feature retry signal isolation", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("executes the second attempt after a retry-eligible failure (fresh, non-aborted signal)", async () => {
    // Attempt 1 fails with a retry-eligible conversation-error after
    // >= RETRY_MIN_DURATION_MS (2s); attempt 2 succeeds. The retry must
    // run with a fresh, un-aborted signal — observed by TWO contexts
    // being opened (a poisoned/aborted retry would open only one because
    // runFeature short-circuits to `abort` before newContext()).
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
        buildTurns: () => [{ input: "hello" }],
      }),
    );

    const { launcher, state } = makeRetryLauncher({ attempt1DelayMs: 2_100 });

    const driver = createE2eDeepDriver({
      launcher,
      scriptLoader: async () => {},
      featureTimeoutMs: 30_000, // well above attempt durations — no timeout
    });
    const { writer } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-deep:showcase-test",
      publicUrl: "https://showcase-test.example.com",
      name: "showcase-test",
      features: ["agentic-chat"],
      shape: "package",
    });

    // Two attempts executed → two contexts opened; attempt 2 succeeded.
    expect(state.opened).toBe(2);
    const sig = result.signal as E2eDeepAggregateSignal;
    expect(sig.passed).toBe(1);
    expect(sig.failed).toEqual([]);
  }, 15_000);
});
