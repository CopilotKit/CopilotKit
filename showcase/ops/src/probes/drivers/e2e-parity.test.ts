import { describe, it, expect, beforeEach } from "vitest";
import {
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
  return {
    now: () => now,
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
    expect(writes).toEqual([]);
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

    const result = await driver.run(mkCtx(), {
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
});
