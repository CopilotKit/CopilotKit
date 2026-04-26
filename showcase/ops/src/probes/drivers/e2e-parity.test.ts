import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createDefaultFleetResolver,
  createE2eParityDriver,
  e2eParityDriver,
  type E2eParityAggregateSignal,
  type E2eParityBrowser,
  type E2eParityBrowserContext,
  type E2eParityFeatureSignal,
  type E2eParityPage,
} from "./e2e-parity.js";
import {
  __clearD5RegistryForTesting,
  registerD5Script,
  type D5FeatureType,
  type D5Script,
} from "../helpers/d5-registry.js";
import type { ParitySnapshot } from "../helpers/parity-compare.js";
import type { LoadReferenceResult } from "../helpers/d6-scoping.js";
import type {
  SseCapture,
  SseInterceptorHandle,
} from "../helpers/sse-interceptor.js";
import { logger } from "../../logger.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

/**
 * Driver tests for the e2e-parity (D6) ProbeDriver.
 *
 * All collaborators are mocked — no chromium, no CDP, no filesystem.
 *   - browser / page → scripted fakes
 *   - SSE interceptor → returns a stub `SseCapture`
 *   - DOM serializer → returns a static `DomElement[]`
 *   - reference loader → returns a synthetic `ParitySnapshot`
 *   - conversation runner → returns success per-turn
 *   - fleet resolver → returns a static slug list (no registry.json)
 *
 * Each test populates the D5 registry with the scripts it needs,
 * configures the loader / capture pair to produce the parity verdict
 * the test asserts against, and verifies the side-emit + aggregate
 * shape.
 */

// --- Fakes ----------------------------------------------------------------

function makePage(opts: { throwOnGoto?: Error } = {}): E2eParityPage {
  return {
    async goto() {
      if (opts.throwOnGoto) throw opts.throwOnGoto;
    },
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate<R>(fn: () => R): Promise<R> {
      void fn;
      return undefined as unknown as R;
    },
    async close() {},
  };
}

interface FakeBrowserState {
  closed: boolean;
  contextsOpened: number;
  contextsClosed: number;
}

function makeBrowser(
  pageFactory: () => E2eParityPage = () => makePage(),
  state: FakeBrowserState = {
    closed: false,
    contextsOpened: 0,
    contextsClosed: 0,
  },
): { browser: E2eParityBrowser; state: FakeBrowserState } {
  const browser: E2eParityBrowser = {
    async newContext(): Promise<E2eParityBrowserContext> {
      state.contextsOpened++;
      return {
        async newPage(): Promise<E2eParityPage> {
          return pageFactory();
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
  now: Date = new Date("2026-04-25T00:00:00Z"),
): ProbeContext {
  // Default existing tests to D6_ENABLED=true so they exercise the
  // post-gate behaviour. Tests that specifically cover the gate
  // (disabled / case-insensitive / falsy) override this explicitly.
  const mergedEnv: Record<string, string | undefined> = {
    D6_ENABLED: "true",
    ...env,
  };
  return {
    now: () => now,
    logger,
    env: mergedEnv,
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

function makeSnapshot(overrides: Partial<ParitySnapshot> = {}): ParitySnapshot {
  return {
    domElements: overrides.domElements ?? [
      { tag: "div", classes: ["copilotkit-chat"] },
    ],
    toolCalls: overrides.toolCalls ?? [],
    streamProfile: overrides.streamProfile ?? {
      ttft_ms: 100,
      p50_chunk_ms: 50,
      total_chunks: 5,
    },
    contractShape: overrides.contractShape ?? {
      "messages[].role": "string",
    },
  };
}

function makeCapture(): SseCapture {
  return {
    toolCalls: [],
    streamProfile: {
      ttft_ms: 100,
      inter_chunk_ms: [50, 50, 50, 50],
      p50_chunk_ms: 50,
      total_chunks: 5,
      duration_ms: 200,
    },
    contractFields: { "messages[].role": "string" },
    raw_event_count: 5,
  };
}

function stubInterceptor(capture: SseCapture): {
  attachInterceptor: (page: E2eParityPage) => Promise<SseInterceptorHandle>;
  attachCount: () => number;
} {
  let count = 0;
  return {
    attachInterceptor: async () => {
      count++;
      return {
        async stop() {
          return capture;
        },
      };
    },
    attachCount: () => count,
  };
}

// --- Tests ---------------------------------------------------------------

describe("e2e-parity driver", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("exposes kind === 'e2e_parity'", () => {
    expect(e2eParityDriver.kind).toBe("e2e_parity");
  });

  // ── D6_ENABLED hard gate ─────────────────────────────────────────────
  //
  // The driver short-circuits with aggregate green + disabled-note when
  // D6_ENABLED is anything other than the literal string "true"
  // (case-insensitive). All collaborators (scoping, fleet, scriptLoader,
  // launcher, attachInterceptor, serializeDom, runConversation,
  // loadReference, fleetResolver) must NEVER be called when the flag
  // is off — proven via mock call counts.

  it("D6_ENABLED unset → aggregate green disabled-note, no side rows, no collaborators called", async () => {
    let scriptLoaderCalls = 0;
    let launcherCalls = 0;
    let attachCalls = 0;
    let serializeCalls = 0;
    let loadReferenceCalls = 0;
    let runConversationCalls = 0;
    let fleetResolverCalls = 0;

    const driver = createE2eParityDriver({
      launcher: async () => {
        launcherCalls++;
        return makeBrowser().browser;
      },
      attachInterceptor: async () => {
        attachCalls++;
        return {
          async stop() {
            return makeCapture();
          },
        };
      },
      serializeDom: async () => {
        serializeCalls++;
        return [];
      },
      loadReference: async () => {
        loadReferenceCalls++;
        return {
          status: "ok",
          snapshot: makeSnapshot(),
          snapshotPath: "/fake/x.json",
        };
      },
      runConversation: async () => {
        runConversationCalls++;
        return {
          turns_completed: 1,
          total_turns: 1,
          turn_durations_ms: [100],
        };
      },
      fleetResolver: async () => {
        fleetResolverCalls++;
        return ["langgraph-python"];
      },
      scriptLoader: async () => {
        scriptLoaderCalls++;
      },
    });
    const { writer, writes } = mkWriter();

    // Explicitly override env to be empty (mkCtx defaults D6_ENABLED to
    // "true"; this test wants the disabled path so we override it).
    const result = await driver.run(mkCtx(writer, { D6_ENABLED: undefined }), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.note).toMatch(/D6 disabled/);
    expect(sig.note).toMatch(/D6_ENABLED=true/);
    expect(sig.selectedThisTick).toBe(false);
    expect(sig.total).toBe(0);
    expect(sig.passed).toBe(0);
    expect(sig.amber).toBe(0);
    expect(sig.red).toBe(0);

    // No side rows emitted.
    expect(writes).toHaveLength(0);

    // No collaborators called — driver exits before any work.
    expect(scriptLoaderCalls).toBe(0);
    expect(launcherCalls).toBe(0);
    expect(attachCalls).toBe(0);
    expect(serializeCalls).toBe(0);
    expect(loadReferenceCalls).toBe(0);
    expect(runConversationCalls).toBe(0);
    expect(fleetResolverCalls).toBe(0);
  });

  it("D6_ENABLED='true' → driver proceeds (scoping/fleet collaborators ARE called)", async () => {
    registerD5Script(makeScript());
    let fleetResolverCalls = 0;
    let scriptLoaderCalls = 0;

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => {
        fleetResolverCalls++;
        return ["langgraph-python"];
      },
      scriptLoader: async () => {
        scriptLoaderCalls++;
      },
    });
    const { writer } = mkWriter();

    await driver.run(mkCtx(writer, { D6_ENABLED: "true" }), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    // Both collaborators MUST be called when the flag is on.
    expect(scriptLoaderCalls).toBe(1);
    expect(fleetResolverCalls).toBe(1);
  });

  it("D6_ENABLED='TRUE' → enabled (case-insensitive)", async () => {
    registerD5Script(makeScript());
    let fleetResolverCalls = 0;

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => {
        fleetResolverCalls++;
        return ["langgraph-python"];
      },
    });
    const { writer } = mkWriter();

    const result = await driver.run(mkCtx(writer, { D6_ENABLED: "TRUE" }), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(fleetResolverCalls).toBe(1);
    // Driver proceeded past the gate; no disabled note on the
    // aggregate signal.
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.note ?? "").not.toMatch(/D6 disabled/);
  });

  it("D6_ENABLED='false' → disabled", async () => {
    let fleetResolverCalls = 0;
    const driver = createE2eParityDriver({
      fleetResolver: async () => {
        fleetResolverCalls++;
        return ["langgraph-python"];
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer, { D6_ENABLED: "false" }), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.note).toMatch(/D6 disabled/);
    expect(fleetResolverCalls).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("D6_ENABLED='' (empty string) → disabled", async () => {
    let fleetResolverCalls = 0;
    const driver = createE2eParityDriver({
      fleetResolver: async () => {
        fleetResolverCalls++;
        return ["langgraph-python"];
      },
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer, { D6_ENABLED: "" }), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.note).toMatch(/D6 disabled/);
    expect(fleetResolverCalls).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("emits aggregate green and one green side row when parity passes on all axes", async () => {
    registerD5Script(
      makeScript({
        featureTypes: ["agentic-chat"],
        fixtureFile: "agentic-chat.json",
      }),
    );

    const reference = makeSnapshot();
    const { browser, state } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => [{ tag: "div", classes: ["copilotkit-chat"] }],
      loadReference: async (): Promise<LoadReferenceResult> => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/agentic-chat.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.selectedThisTick).toBe(true);
    expect(sig.passed).toBe(1);
    expect(sig.amber).toBe(0);
    expect(sig.red).toBe(0);

    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("green");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.severity).toBe("green");
    expect(fsig.axes).toEqual({
      dom: "pass",
      tools: "pass",
      stream: "pass",
      contract: "pass",
    });

    expect(state.closed).toBe(true);
  });

  it("maps 1-2 axis failures to amber → state 'degraded'", async () => {
    registerD5Script(makeScript());

    // Reference has 1 toolCall, captured has 0 → tools axis fails.
    // Everything else matches → 1 axis failure → amber.
    const reference = makeSnapshot({ toolCalls: ["weather"] });
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/agentic-chat.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("degraded");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.amber).toBe(1);
    expect(sig.passed).toBe(0);
    expect(sig.red).toBe(0);

    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("degraded");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.severity).toBe("amber");
    expect(fsig.axisFailures).toBe(1);
  });

  it("maps 3-4 axis failures to red", async () => {
    registerD5Script(makeScript());

    // Reference vs captured drift on 3 axes:
    //   - tools differ (weather vs none)
    //   - DOM differs (extra reference element)
    //   - contract differs (extra reference field)
    // stream still matches.
    const reference = makeSnapshot({
      toolCalls: ["weather"],
      domElements: [
        { tag: "div", classes: ["copilotkit-chat"] },
        { tag: "button", classes: ["send"] },
      ],
      contractShape: {
        "messages[].role": "string",
        "extra.field": "boolean",
      },
    });

    const { browser } = makeBrowser();
    // Captured has none of those — produces 3 axis failures.
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => [{ tag: "div", classes: ["copilotkit-chat"] }],
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/agentic-chat.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.red).toBe(1);

    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("red");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.severity).toBe("red");
    expect(fsig.axisFailures).toBeGreaterThanOrEqual(3);
  });

  it("skips features without a registered D5 script (green note row)", async () => {
    // tool-rendering not registered — should produce a green skip row.
    const driver = createE2eParityDriver({
      launcher: async () => makeBrowser().browser,
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => [],
      loadReference: async () => ({
        status: "ok",
        snapshot: makeSnapshot(),
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["tool-rendering"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.skipped).toContain("tool-rendering");

    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/tool-rendering",
    );
    expect(sideRow?.state).toBe("green");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.note).toMatch(/no script registered/);
  });

  it("skips features without a reference snapshot (green note row)", async () => {
    registerD5Script(makeScript());

    const driver = createE2eParityDriver({
      launcher: async () => makeBrowser().browser,
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => [],
      loadReference: async () => ({
        status: "missing",
        snapshotPath: "/fake/agentic-chat.json",
        reason: "no reference snapshot",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.skipped).toContain("agentic-chat");

    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("green");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.note).toMatch(/no reference snapshot/);
  });

  it("emits red when reference snapshot is invalid", async () => {
    registerD5Script(makeScript());

    const driver = createE2eParityDriver({
      launcher: async () => makeBrowser().browser,
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => [],
      loadReference: async () => ({
        status: "invalid",
        snapshotPath: "/fake/agentic-chat.json",
        reason: "JSON parse failed",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("red");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.errorClass).toBe("invalid-reference");
  });

  it("on-demand mode requires D6_TARGET_INTEGRATION env", async () => {
    registerD5Script(makeScript());

    const driver = createE2eParityDriver({
      launcher: async () => makeBrowser().browser,
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => [],
      loadReference: async () => ({
        status: "ok",
        snapshot: makeSnapshot(),
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });

    const result = await driver.run(
      mkCtx(undefined, { D6_MODE: "on-demand" }),
      {
        key: "e2e-parity:showcase-langgraph-python",
        publicUrl: "https://showcase-langgraph-python.example.com",
        name: "showcase-langgraph-python",
        features: ["agentic-chat"],
        shape: "package",
      },
    );

    expect(result.state).toBe("red");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.errorDesc).toBe("scoping-error");
    expect(sig.failureSummary).toMatch(/D6_TARGET_INTEGRATION/);
  });

  it("on-demand mode runs the operator-supplied target", async () => {
    registerD5Script(makeScript());

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/agentic-chat.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["mastra", "langgraph-python", "ag2"],
    });
    const { writer } = mkWriter();

    const result = await driver.run(
      mkCtx(writer, {
        D6_MODE: "on-demand",
        D6_TARGET_INTEGRATION: "mastra",
      }),
      {
        key: "e2e-parity:showcase-mastra",
        publicUrl: "https://showcase-mastra.example.com",
        name: "showcase-mastra",
        features: ["agentic-chat"],
        shape: "package",
      },
    );

    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.mode).toBe("on-demand");
    expect(sig.selectedThisTick).toBe(true);
    expect(result.state).toBe("green");
  });

  it("weekly-rotation mode skips integrations that aren't this week's target", async () => {
    registerD5Script(makeScript());

    const reference = makeSnapshot();
    let launched = false;
    const driver = createE2eParityDriver({
      launcher: async () => {
        launched = true;
        return makeBrowser().browser;
      },
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      // Fleet of 5; week 17 mod 5 = 2 → sorted[2] = "c". This invocation
      // is for "a" (not selected) → driver should skip without
      // launching browser, aggregate green.
      fleetResolver: async () => ["a", "b", "c", "d", "e"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(
      mkCtx(writer, {}, new Date("2026-04-25T00:00:00Z")),
      {
        key: "e2e-parity:showcase-a",
        publicUrl: "https://showcase-a.example.com",
        name: "showcase-a",
        features: ["agentic-chat"],
        shape: "package",
      },
    );

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.selectedThisTick).toBe(false);
    expect(sig.note).toMatch(/not selected/);
    // Bug fix R10: per-feature side rows are emitted (green, with note)
    // for every requested-known feature so dashboard cells refresh
    // instead of staying red on whatever the previous selection-tick
    // produced. The aggregate stays green and the side rows clearly
    // say "not selected this tick" so they don't claim parity was
    // verified.
    expect(writes).toHaveLength(1);
    const sideRow = writes[0]!;
    // Slug is "a" — derived from `e2e-parity:showcase-a` with the
    // "showcase-" prefix stripped.
    expect(sideRow.key).toBe("d6:a/agentic-chat");
    expect(sideRow.state).toBe("green");
    const sideSig = sideRow.signal as E2eParityFeatureSignal;
    expect(sideSig.note).toMatch(/not selected/);
    expect(sideSig.featureType).toBe("agentic-chat");
  });

  it("weekly-rotation mode runs the integration matching this week's index", async () => {
    registerD5Script(makeScript());
    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      // Week 17 mod 5 = 2 → sorted[2] = "c" — invocation runs for "c".
      fleetResolver: async () => ["a", "b", "c", "d", "e"],
    });
    const { writer } = mkWriter();

    const result = await driver.run(
      mkCtx(writer, {}, new Date("2026-04-25T00:00:00Z")),
      {
        key: "e2e-parity:showcase-c",
        publicUrl: "https://showcase-c.example.com",
        name: "showcase-c",
        features: ["agentic-chat"],
        shape: "package",
      },
    );

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.selectedThisTick).toBe(true);
    expect(sig.scopingReason).toMatch(/week 17/);
  });

  it("short-circuits green for starter shape without launching browser", async () => {
    let launched = false;
    const driver = createE2eParityDriver({
      launcher: async () => {
        launched = true;
        return makeBrowser().browser;
      },
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => [],
      loadReference: async () => ({
        status: "ok",
        snapshot: makeSnapshot(),
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });

    const result = await driver.run(mkCtx(), {
      key: "e2e-parity:showcase-langgraph-python-starter",
      publicUrl: "https://x.example.com",
      name: "showcase-langgraph-python-starter",
      features: ["agentic-chat"],
      shape: "starter",
    });

    expect(launched).toBe(false);
    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.shape).toBe("starter");
  });

  it("emits red with launcher-error when chromium fails to launch", async () => {
    registerD5Script(makeScript());
    const { writer, writes } = mkWriter();

    const driver = createE2eParityDriver({
      launcher: async () => {
        throw new Error("chromium launch failed: ENOENT");
      },
      attachInterceptor: async () => ({
        async stop() {
          return makeCapture();
        },
      }),
      serializeDom: async () => [],
      loadReference: async () => ({
        status: "ok",
        snapshot: makeSnapshot(),
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.errorDesc).toBe("launcher-error");
    expect(sig.failureSummary).toMatch(/chromium launch failed/);

    // Per A13 — side rows MUST be emitted for every runnable feature
    // so the per-feature dashboard cells reflect the launcher failure
    // instead of going stale.
    const sideRows = writes.filter((w) => w.key.startsWith("d6:"));
    expect(sideRows.length).toBe(1);
    const sideRow = sideRows[0]!;
    expect(sideRow.state).toBe("red");
    expect(sideRow.key).toBe("d6:langgraph-python/agentic-chat");
    const sideSignal = sideRow.signal as {
      errorClass?: string;
      errorDesc?: string;
    };
    expect(sideSignal.errorClass).toBe("launcher-error");
    expect(sideSignal.errorDesc).toMatch(/chromium launch failed/);
  });

  it("emits red when goto fails", async () => {
    registerD5Script(makeScript());

    const reference = makeSnapshot();
    const { browser } = makeBrowser(() =>
      makePage({ throwOnGoto: new Error("net::ERR_CONNECTION_REFUSED") }),
    );
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.errorClass).toBe("goto-error");
    expect(fsig.errorDesc).toMatch(/ERR_CONNECTION_REFUSED/);
  });

  it("emits red when conversation reports failure_turn", async () => {
    registerD5Script(
      makeScript({
        buildTurns: () => [{ input: "first" }, { input: "second" }],
      }),
    );

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 0,
        total_turns: 1,
        failure_turn: 1,
        error: "timed out waiting for assistant",
        turn_durations_ms: [],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    const result = await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("red");
    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("red");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.errorClass).toBe("conversation-error");
  });

  // Bug fix R7: per-turn capture slices the conversation, so
  // `runConversation` always reports `failure_turn === 1`. The driver
  // must translate to the OUTER 1-based index when constructing the
  // error message — otherwise every per-turn failure looks like
  // "turn 1 failed" no matter which turn actually failed.
  it("conversation-error errorDesc reports the OUTER turn index, not the slice-local 1", async () => {
    registerD5Script(
      makeScript({
        buildTurns: () => [
          { input: "first" },
          { input: "second" },
          { input: "third" },
        ],
      }),
    );

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    let turnCount = 0;
    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => {
        turnCount++;
        if (turnCount < 3) {
          return {
            turns_completed: 1,
            total_turns: 1,
            turn_durations_ms: [100],
          };
        }
        // Third call (outer turn 3) fails. The slice-local
        // `failure_turn` is 1 because we always pass [turn].
        return {
          turns_completed: 0,
          total_turns: 1,
          failure_turn: 1,
          error: "timed out on third turn",
          turn_durations_ms: [],
        };
      },
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer, writes } = mkWriter();

    await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    const sideRow = writes.find(
      (w) => w.key === "d6:langgraph-python/agentic-chat",
    );
    expect(sideRow?.state).toBe("red");
    const fsig = sideRow?.signal as E2eParityFeatureSignal;
    expect(fsig.errorClass).toBe("conversation-error");
    expect(fsig.errorDesc).toMatch(/turn 3/);
    expect(fsig.errorDesc).not.toMatch(/^turn 1:/);
    expect(fsig.errorDesc).toMatch(/timed out on third turn/);
  });

  it("uses PB key shape `d6:<slug>/<featureType>`", async () => {
    registerD5Script(makeScript());

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/agentic-chat.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["mastra"],
    });
    const { writer, writes } = mkWriter();

    await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-mastra",
      publicUrl: "https://showcase-mastra.example.com",
      name: "showcase-mastra",
      features: ["agentic-chat"],
      shape: "package",
    });

    const sideKeys = writes.map((w) => w.key);
    // Key shape: `d6:<slug>/<featureType>`. Slug derived from the
    // input key (showcase- stripped). FeatureType is the D5
    // featureType literal.
    expect(sideKeys).toContain("d6:mastra/agentic-chat");
  });

  it("attaches the SSE interceptor once per turn (multi-turn conversation)", async () => {
    // Drive a 3-turn script. The driver MUST attach + stop the
    // interceptor once per turn (see B12's reference-capture for the
    // canonical pattern). If the driver attaches once per feature
    // instead of per turn, only the first turn's stream is captured
    // — and with B10's first-match-wins semantics that means missing
    // tool calls + truncated stream profile + corrupt parity verdict.
    registerD5Script(
      makeScript({
        buildTurns: () => [
          { input: "first" },
          { input: "second" },
          { input: "third" },
        ],
      }),
    );

    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const stub = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor: stub.attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
    });
    const { writer } = mkWriter();

    await driver.run(mkCtx(writer), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    // 3 turns × 1 feature = 3 attaches.
    expect(stub.attachCount()).toBe(3);
  });

  it("invokes the injected scriptLoader exactly once per run()", async () => {
    // Without a scriptLoader injection point, the driver couldn't be
    // run standalone — the registry would be empty and every feature
    // would skip. Wave-2b drivers populate the registry via this
    // loader; tests assert wiring (call count) without hitting disk.
    let loaderCalls = 0;
    const reference = makeSnapshot();
    const { browser } = makeBrowser();
    const { attachInterceptor } = stubInterceptor(makeCapture());

    const driver = createE2eParityDriver({
      launcher: async () => browser,
      attachInterceptor,
      serializeDom: async () => reference.domElements,
      loadReference: async () => ({
        status: "ok",
        snapshot: reference,
        snapshotPath: "/fake/x.json",
      }),
      runConversation: async () => ({
        turns_completed: 1,
        total_turns: 1,
        turn_durations_ms: [100],
      }),
      fleetResolver: async () => ["langgraph-python"],
      scriptLoader: async () => {
        loaderCalls++;
        // The loader's job is to populate D5_REGISTRY via side-effect
        // imports. The test pre-populates the registry directly.
        registerD5Script(makeScript());
      },
    });

    const result = await driver.run(mkCtx(), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    // Loader must be called exactly once: at the top of run() so the
    // registry is populated before fleet/feature partitioning.
    expect(loaderCalls).toBe(1);
    // And the registered script must be picked up — aggregate green
    // proves the partition saw a runnable feature.
    expect(result.state).toBe("green");
  });

  it("uses fleetSlugs verbatim when self-slug missing from fleet (no defensive append)", async () => {
    // A3 fix: per-invocation appending of `slug` to fleet broke
    // rotation determinism — different invocations produce different
    // fleet sizes. With the fix, a slug not in the fleet simply sits
    // out the rotation. Aggregate stays green; the note flags drift.
    registerD5Script(makeScript());

    const driver = createE2eParityDriver({
      // Fleet does NOT include `langgraph-python` — registry drift.
      fleetResolver: async () => ["mastra", "ag2", "pydantic-ai"],
      launcher: async () => makeBrowser().browser,
      // Use weekly-rotation default (no env). With fleet of 3 the
      // rotation picks one of them — but never our slug, so we sit out.
    });

    const result = await driver.run(mkCtx(), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    expect(result.state).toBe("green");
    const sig = result.signal as E2eParityAggregateSignal;
    expect(sig.selectedThisTick).toBe(false);
    // The note must call out the registry-drift case so operators
    // aren't left wondering why the slug never runs.
    expect(sig.note).toMatch(/missing from fleet/);
  });

  it("survives a throwing scriptLoader (logs, doesn't throw out)", async () => {
    // Per A1 spec: a thrown loader must not crash the driver; it logs
    // a warning and continues. The featureType then ends up in
    // skippedScript because the registry is empty.
    const { browser } = makeBrowser();
    const driver = createE2eParityDriver({
      launcher: async () => browser,
      fleetResolver: async () => ["langgraph-python"],
      scriptLoader: async () => {
        throw new Error("loader-blew-up");
      },
      loadReference: async () => ({
        status: "ok",
        snapshot: makeSnapshot(),
        snapshotPath: "/fake/x.json",
      }),
    });

    const result = await driver.run(mkCtx(), {
      key: "e2e-parity:showcase-langgraph-python",
      publicUrl: "https://showcase-langgraph-python.example.com",
      name: "showcase-langgraph-python",
      features: ["agentic-chat"],
      shape: "package",
    });

    // The driver returns a normal result; nothing throws out.
    expect(result.state).toBe("green");
  });
});

describe("createDefaultFleetResolver", () => {
  it("retries the file read after a transient failure (does not cache failures)", async () => {
    // A4 fix: pre-fix code cached `[]` permanently after any read
    // error, so a transient ENOENT during process startup would
    // disable D6 forever. Caching only successful reads means the
    // resolver self-heals on the next call.
    const dir = await fs.mkdtemp(path.join(tmpdir(), "e2e-parity-fleet-"));
    const registryPath = path.join(dir, "registry.json");

    const resolver = createDefaultFleetResolver();

    // First call: file does NOT exist yet → read fails → resolver
    // returns [] but does NOT cache.
    const ctx = mkCtx(undefined, { REGISTRY_JSON_PATH: registryPath });
    const first = await resolver(ctx);
    expect(first).toEqual([]);

    // Now write a valid registry.
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        integrations: [{ slug: "langgraph-python" }, { slug: "mastra" }],
      }),
      "utf-8",
    );

    // Second call: read succeeds → resolver returns the parsed list.
    // If the failure had been cached this would still be [].
    const second = await resolver(ctx);
    expect(second).toEqual(["langgraph-python", "mastra"]);

    // Third call: cached success → same list, no re-read.
    const third = await resolver(ctx);
    expect(third).toEqual(["langgraph-python", "mastra"]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("ignores non-string slug entries", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "e2e-parity-fleet-"));
    const registryPath = path.join(dir, "registry.json");
    await fs.writeFile(
      registryPath,
      JSON.stringify({
        integrations: [
          { slug: "valid" },
          { slug: 42 }, // non-string — must be skipped
          { slug: "" }, // empty — must be skipped
          {}, // missing slug — must be skipped
          { slug: "another" },
        ],
      }),
      "utf-8",
    );

    const resolver = createDefaultFleetResolver();
    const ctx = mkCtx(undefined, { REGISTRY_JSON_PATH: registryPath });
    const slugs = await resolver(ctx);
    expect(slugs).toEqual(["valid", "another"]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  // Bug fix R8: cache must invalidate when the source file's mtime
  // changes OR after the TTL elapses. Without this, an operator
  // editing registry.json (adding a new integration) needs a process
  // restart for D6 rotation to see the new fleet.
  it("invalidates the cache when registry.json mtime changes", async () => {
    let now = 1_000_000;
    let mtime = 100;
    const reads: string[] = [];

    const fakeStat = async (
      _filePath: string,
    ): Promise<{ mtimeMs: number }> => ({ mtimeMs: mtime });

    // Use a real on-disk file so the resolver's actual readFile path
    // exercises end-to-end. We control mtime via the injected stat.
    const dir = await fs.mkdtemp(
      path.join(tmpdir(), "e2e-parity-fleet-mtime-"),
    );
    const registryPath = path.join(dir, "registry.json");
    const writeRegistry = async (slugs: string[]): Promise<void> => {
      reads.push(slugs.join(","));
      await fs.writeFile(
        registryPath,
        JSON.stringify({ integrations: slugs.map((s) => ({ slug: s })) }),
        "utf-8",
      );
    };

    await writeRegistry(["initial"]);

    const resolver = createDefaultFleetResolver({
      now: () => now,
      stat: fakeStat,
    });
    const ctx = mkCtx(undefined, { REGISTRY_JSON_PATH: registryPath });

    // First read populates cache at mtime=100.
    expect(await resolver(ctx)).toEqual(["initial"]);

    // Same mtime, within TTL → cached value served (no re-read).
    // Switching the on-disk file but keeping mtime=100 should NOT
    // be observed by the resolver.
    await writeRegistry(["sneaky"]);
    expect(await resolver(ctx)).toEqual(["initial"]);

    // Advance mtime to simulate a real edit. Cache must invalidate.
    mtime = 200;
    await writeRegistry(["fresh", "added"]);
    expect(await resolver(ctx)).toEqual(["fresh", "added"]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("invalidates the cache after the TTL elapses even when mtime is unchanged", async () => {
    let now = 1_000_000;
    const fakeStat = async (
      _filePath: string,
    ): Promise<{ mtimeMs: number }> => ({ mtimeMs: 100 });

    const dir = await fs.mkdtemp(path.join(tmpdir(), "e2e-parity-fleet-ttl-"));
    const registryPath = path.join(dir, "registry.json");
    const writeRegistry = async (slugs: string[]): Promise<void> => {
      await fs.writeFile(
        registryPath,
        JSON.stringify({ integrations: slugs.map((s) => ({ slug: s })) }),
        "utf-8",
      );
    };
    await writeRegistry(["initial"]);

    const resolver = createDefaultFleetResolver({
      now: () => now,
      stat: fakeStat,
    });
    const ctx = mkCtx(undefined, { REGISTRY_JSON_PATH: registryPath });

    expect(await resolver(ctx)).toEqual(["initial"]);

    // Replace file content while mtime stays 100 (clock skew or
    // atomic replace edge case). Within TTL → cache wins.
    await writeRegistry(["replaced"]);
    expect(await resolver(ctx)).toEqual(["initial"]);

    // Advance "now" past the 60s TTL. Cache must invalidate even
    // though the stub mtime is unchanged.
    now += 61 * 1000;
    expect(await resolver(ctx)).toEqual(["replaced"]);

    await fs.rm(dir, { recursive: true, force: true });
  });
});
