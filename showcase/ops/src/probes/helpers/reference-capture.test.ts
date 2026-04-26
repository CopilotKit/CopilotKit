import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSnapshot,
  captureAllReferences,
  captureReferenceForFeature,
  serializeRelevantDom,
  type ReferenceCaptureBrowserHandle,
  type ReferenceCaptureContext,
  type ReferenceCaptureDeps,
  type ReferenceCapturePage,
} from "./reference-capture.js";
import {
  D5_REGISTRY,
  __clearD5RegistryForTesting,
  registerD5Script,
  type D5FeatureType,
  type D5Script,
} from "./d5-registry.js";
import type { ParitySnapshot } from "./parity-compare.js";
import type { SseCapture, SseInterceptorHandle } from "./sse-interceptor.js";
import type { ConversationTurn } from "./conversation-runner.js";

/**
 * Unit tests for `reference-capture.ts`. Mocks every collaborator —
 * launcher, page, SSE interceptor, conversation runner, DOM
 * serializer, snapshot writer. No live browser, no filesystem.
 *
 * The helper's contract:
 *   1. Look up script in `D5_REGISTRY`. Missing → skipped (no
 *      browser launch, no nav).
 *   2. Launch browser. Failure → failed.
 *   3. Navigate. Failure → failed (browser still closed).
 *   4. Build turns; for each turn: attach interceptor, run that turn,
 *      stop interceptor.
 *   5. If conversation `failure_turn` set → failed (no snapshot
 *      written, browser closed).
 *   6. Serialize DOM, build snapshot, write file.
 *   7. Always close browser in finally.
 */

const FEATURE: D5FeatureType = "agentic-chat";

function makeScript(
  featureType: D5FeatureType,
  turns: ConversationTurn[],
): D5Script {
  return {
    featureTypes: [featureType],
    fixtureFile: "fake-fixture.json",
    buildTurns: () => turns,
  };
}

function makePage(): ReferenceCapturePage {
  return {
    async waitForSelector() {},
    async fill() {},
    async press() {},
    async evaluate() {
      return undefined as never;
    },
    async goto() {},
    async close() {},
  };
}

function makeCapture(overrides: Partial<SseCapture> = {}): SseCapture {
  return {
    toolCalls: overrides.toolCalls ?? [],
    streamProfile: overrides.streamProfile ?? {
      ttft_ms: 0,
      inter_chunk_ms: [],
      p50_chunk_ms: 0,
      total_chunks: 0,
      duration_ms: 0,
    },
    contractFields: overrides.contractFields ?? {},
    raw_event_count: overrides.raw_event_count ?? 0,
  };
}

interface DepsHarness {
  deps: ReferenceCaptureDeps;
  calls: string[];
  closed: boolean;
  writes: Array<{ path: string; snapshot: ParitySnapshot }>;
  attachCount: number;
  stopCount: number;
}

function makeDeps(
  opts: {
    page?: ReferenceCapturePage;
    launchError?: Error;
    gotoError?: Error;
    serializeDomError?: Error;
    writeError?: Error;
    conversationResult?:
      | {
          turns_completed: number;
          total_turns: number;
          failure_turn?: number;
          error?: string;
          turn_durations_ms: number[];
        }
      | ((turn: ConversationTurn) => {
          turns_completed: number;
          total_turns: number;
          failure_turn?: number;
          error?: string;
          turn_durations_ms: number[];
        });
    perTurnCaptures?: SseCapture[];
    domElements?: Awaited<
      ReturnType<NonNullable<ReferenceCaptureDeps["serializeDom"]>>
    >;
  } = {},
): DepsHarness {
  const calls: string[] = [];
  const writes: DepsHarness["writes"] = [];
  let attachCount = 0;
  let stopCount = 0;
  let closed = false;
  const captures = opts.perTurnCaptures ?? [];

  const page =
    opts.page ??
    (() => {
      const p = makePage();
      if (opts.gotoError) {
        p.goto = async () => {
          throw opts.gotoError as Error;
        };
      } else {
        p.goto = async () => {
          calls.push("goto");
        };
      }
      return p;
    })();

  const handle: ReferenceCaptureBrowserHandle = {
    page,
    close: async () => {
      closed = true;
      calls.push("browser.close");
    },
  };

  const deps: ReferenceCaptureDeps = {
    launchBrowser: async () => {
      calls.push("launchBrowser");
      if (opts.launchError) throw opts.launchError;
      return handle;
    },
    attachSseInterceptor: async () => {
      attachCount++;
      const idx = attachCount - 1;
      calls.push(`attach#${attachCount}`);
      const handle: SseInterceptorHandle = {
        stop: async () => {
          stopCount++;
          calls.push(`stop#${stopCount}`);
          return captures[idx] ?? makeCapture();
        },
      };
      return handle;
    },
    runConversation: async (_page, turns) => {
      calls.push(`runConversation(turns=${turns.length})`);
      const cr = opts.conversationResult;
      if (typeof cr === "function") {
        return cr(turns[0]!);
      }
      return (
        cr ?? {
          turns_completed: turns.length,
          total_turns: turns.length,
          turn_durations_ms: turns.map(() => 1),
        }
      );
    },
    serializeDom: async () => {
      calls.push("serializeDom");
      if (opts.serializeDomError) throw opts.serializeDomError;
      return (
        opts.domElements ?? [
          {
            tag: "button",
            classes: ["copilotkit-send"],
            testId: "send-button",
          },
        ]
      );
    },
    writeSnapshot: async (filePath, snapshot) => {
      calls.push(`writeSnapshot(${filePath})`);
      if (opts.writeError) throw opts.writeError;
      writes.push({ path: filePath, snapshot });
    },
    now: () => 0,
  };

  return {
    deps,
    calls,
    get closed() {
      return closed;
    },
    writes,
    get attachCount() {
      return attachCount;
    },
    get stopCount() {
      return stopCount;
    },
  };
}

const ctx: ReferenceCaptureContext = {
  baseUrl: "https://lgp.example.com",
  integrationSlug: "langgraph-python",
  outputDir: "/abs/fixtures/d6-reference",
};

beforeEach(() => {
  __clearD5RegistryForTesting();
});

afterEach(() => {
  __clearD5RegistryForTesting();
  vi.restoreAllMocks();
});

describe("captureReferenceForFeature", () => {
  it("returns skipped when no script is registered for the featureType", async () => {
    const harness = makeDeps();
    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);
    expect(result).toEqual({
      featureType: FEATURE,
      status: "skipped",
      reason: "no script registered",
    });
    // No browser launch, no writes.
    expect(harness.calls).toEqual([]);
    expect(harness.writes).toHaveLength(0);
  });

  it("happy path: launches, navigates, runs all turns, writes one snapshot", async () => {
    const turns: ConversationTurn[] = [{ input: "first" }, { input: "second" }];
    registerD5Script(makeScript(FEATURE, turns));

    const captures: SseCapture[] = [
      makeCapture({
        toolCalls: ["tool_a"],
        streamProfile: {
          ttft_ms: 100,
          inter_chunk_ms: [10, 20],
          p50_chunk_ms: 15,
          total_chunks: 3,
          duration_ms: 150,
        },
        contractFields: { "messages[].role": "string" },
      }),
      makeCapture({
        toolCalls: ["tool_b"],
        streamProfile: {
          ttft_ms: 200,
          inter_chunk_ms: [40, 80],
          p50_chunk_ms: 60,
          total_chunks: 5,
          duration_ms: 250,
        },
        contractFields: { "messages[].content": "string" },
      }),
    ];

    const harness = makeDeps({
      perTurnCaptures: captures,
      domElements: [
        { tag: "div", classes: ["copilotkit-message"] },
        { tag: "button", classes: ["copilotkit-send"], testId: "send-button" },
      ],
    });

    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);

    expect(result.status).toBe("captured");
    expect(result.snapshotPath).toBe(
      "/abs/fixtures/d6-reference/agentic-chat.json",
    );
    expect(result.reason).toBeUndefined();

    // Per-turn attach/stop, not "attach once".
    expect(harness.attachCount).toBe(2);
    expect(harness.stopCount).toBe(2);

    // Call order: launch → goto → (attach → run → stop) × 2 → DOM →
    // writeSnapshot → browser.close.
    expect(harness.calls).toEqual([
      "launchBrowser",
      "goto",
      "attach#1",
      "runConversation(turns=1)",
      "stop#1",
      "attach#2",
      "runConversation(turns=1)",
      "stop#2",
      "serializeDom",
      "writeSnapshot(/abs/fixtures/d6-reference/agentic-chat.json)",
      "browser.close",
    ]);

    expect(harness.writes).toHaveLength(1);
    const snap = harness.writes[0]!.snapshot;
    expect(snap.toolCalls).toEqual(["tool_a", "tool_b"]); // arrival order preserved
    // ttft mean of (100, 200) = 150; p50 median of (15, 60) = 37.5.
    expect(snap.streamProfile.ttft_ms).toBe(150);
    expect(snap.streamProfile.p50_chunk_ms).toBe(37.5);
    expect(snap.streamProfile.total_chunks).toBe(8);
    // Contract union, sorted keys.
    expect(Object.keys(snap.contractShape)).toEqual([
      "messages[].content",
      "messages[].role",
    ]);
    // DOM sorted by (testId, tag, classes).
    expect(snap.domElements).toEqual([
      { tag: "div", classes: ["copilotkit-message"] },
      { tag: "button", classes: ["copilotkit-send"], testId: "send-button" },
    ]);
  });

  it("returns failed and does NOT write a snapshot when browser launch throws", async () => {
    registerD5Script(makeScript(FEATURE, [{ input: "x" }]));
    const harness = makeDeps({ launchError: new Error("chromium boom") });

    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("browser launch failed");
    expect(result.reason).toContain("chromium boom");
    expect(result.snapshotPath).toBeUndefined();
    expect(harness.writes).toHaveLength(0);
    // No interceptor / nav happened.
    expect(harness.attachCount).toBe(0);
    expect(harness.calls).toEqual(["launchBrowser"]);
  });

  it("returns failed when navigation throws; closes browser; no snapshot", async () => {
    registerD5Script(makeScript(FEATURE, [{ input: "x" }]));
    const harness = makeDeps({ gotoError: new Error("net::ERR_FAILED") });

    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("navigation failed");
    expect(harness.writes).toHaveLength(0);
    expect(harness.closed).toBe(true);
    expect(harness.attachCount).toBe(0);
  });

  it("returns failed when conversation has a failure_turn; no snapshot written", async () => {
    registerD5Script(
      makeScript(FEATURE, [{ input: "first" }, { input: "second" }]),
    );

    let turnIndex = 0;
    const harness = makeDeps({
      perTurnCaptures: [makeCapture(), makeCapture()],
      conversationResult: () => {
        turnIndex++;
        // First turn succeeds, second turn fails.
        if (turnIndex === 1) {
          return {
            turns_completed: 1,
            total_turns: 1,
            turn_durations_ms: [10],
          };
        }
        return {
          turns_completed: 0,
          total_turns: 1,
          failure_turn: 1,
          error: "timeout: assistant did not respond",
          turn_durations_ms: [],
        };
      },
    });

    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);

    expect(result.status).toBe("failed");
    // Bug fix R7: the per-turn slice always reports `failure_turn === 1`
    // (its slice-local index). The capture helper must translate to
    // the OUTER 1-based turn index — here, the SECOND turn failed, so
    // the reason must say "turn 2", NOT "turn 1".
    expect(result.reason).toContain("conversation failed on turn 2");
    expect(result.reason).not.toContain("conversation failed on turn 1");
    expect(result.reason).toContain("timeout");
    expect(harness.writes).toHaveLength(0);
    // Both turn interceptors attach/stop happened.
    expect(harness.attachCount).toBe(2);
    expect(harness.stopCount).toBe(2);
    // DOM serialization is skipped on conversation failure.
    expect(harness.calls).not.toContain("serializeDom");
    expect(harness.closed).toBe(true);
  });

  it("returns failed when the script produces zero turns", async () => {
    registerD5Script(makeScript(FEATURE, []));
    const harness = makeDeps();

    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("zero turns");
    expect(harness.writes).toHaveLength(0);
    expect(harness.closed).toBe(true);
  });

  it("propagates writeSnapshot failure as failed status", async () => {
    registerD5Script(makeScript(FEATURE, [{ input: "go" }]));
    const harness = makeDeps({
      perTurnCaptures: [makeCapture()],
      writeError: new Error("ENOSPC"),
    });

    const result = await captureReferenceForFeature(FEATURE, ctx, harness.deps);

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("write snapshot failed");
    expect(result.reason).toContain("ENOSPC");
  });
});

describe("captureAllReferences", () => {
  it("iterates every registered featureType once and aggregates results", async () => {
    registerD5Script({
      featureTypes: ["agentic-chat", "tool-rendering"],
      fixtureFile: "shared.json",
      buildTurns: () => [{ input: "go" }],
    });

    const harness = makeDeps({
      perTurnCaptures: [makeCapture(), makeCapture()],
    });

    const results = await captureAllReferences(ctx, harness.deps);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.featureType).sort()).toEqual([
      "agentic-chat",
      "tool-rendering",
    ]);
    expect(results.every((r) => r.status === "captured")).toBe(true);
  });
});

describe("buildSnapshot", () => {
  it("produces an all-zero stream profile when captures is empty", () => {
    const snap = buildSnapshot([], []);
    expect(snap.toolCalls).toEqual([]);
    expect(snap.domElements).toEqual([]);
    expect(snap.streamProfile).toEqual({
      ttft_ms: 0,
      p50_chunk_ms: 0,
      total_chunks: 0,
    });
    expect(snap.contractShape).toEqual({});
  });

  it("first-seen contract type wins on path collision", () => {
    const snap = buildSnapshot(
      [
        makeCapture({ contractFields: { "x.y": "string" } }),
        makeCapture({ contractFields: { "x.y": "number" } }),
      ],
      [],
    );
    expect(snap.contractShape["x.y"]).toBe("string");
  });

  it("sorts DOM elements by (testId, tag, classes); per-element classes sorted", () => {
    const snap = buildSnapshot(
      [],
      [
        { tag: "span", classes: ["c", "a", "b"], testId: "z" },
        { tag: "div", classes: ["a"] },
        { tag: "div", classes: ["a", "b"] },
        { tag: "button", classes: ["x"], testId: "a" },
      ],
    );
    // (testId="" tag="div" classes=["a"]) < (""," div", ["a","b"]) <
    // ("a", "button", ["x"]) < ("z", "span", ["a","b","c"])
    expect(snap.domElements).toEqual([
      { tag: "div", classes: ["a"] },
      { tag: "div", classes: ["a", "b"] },
      { tag: "button", classes: ["x"], testId: "a" },
      { tag: "span", classes: ["a", "b", "c"], testId: "z" },
    ]);
  });

  it("excludes zero-chunk turns from TTFT mean and computes total_chunks as sum", () => {
    const snap = buildSnapshot(
      [
        makeCapture({
          streamProfile: {
            ttft_ms: 999, // ignored — total_chunks=0
            inter_chunk_ms: [],
            p50_chunk_ms: 0,
            total_chunks: 0,
            duration_ms: 0,
          },
        }),
        makeCapture({
          streamProfile: {
            ttft_ms: 100,
            inter_chunk_ms: [10],
            p50_chunk_ms: 10,
            total_chunks: 2,
            duration_ms: 50,
          },
        }),
        makeCapture({
          streamProfile: {
            ttft_ms: 300,
            inter_chunk_ms: [50],
            p50_chunk_ms: 50,
            total_chunks: 4,
            duration_ms: 200,
          },
        }),
      ],
      [],
    );
    expect(snap.streamProfile.ttft_ms).toBe(200); // mean of 100, 300
    expect(snap.streamProfile.p50_chunk_ms).toBe(30); // median of 10, 50
    expect(snap.streamProfile.total_chunks).toBe(6);
  });
});

describe("serializeRelevantDom", () => {
  it("returns flat DomElement list from a chat-root match (no fallback warning)", async () => {
    const page = makePage();
    page.evaluate = async <R>(_fn: () => R) =>
      ({
        fallback: false,
        elements: [
          { tag: "div", classes: ["copilotkit-message"] },
          { tag: "button", classes: ["copilotkit-send"], testId: "send" },
        ],
      }) as unknown as R;

    const warn = vi.fn();
    const out = await serializeRelevantDom(page, warn);
    expect(out).toEqual([
      { tag: "div", classes: ["copilotkit-message"] },
      { tag: "button", classes: ["copilotkit-send"], testId: "send" },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("calls warn when fallback to body is signalled", async () => {
    const page = makePage();
    page.evaluate = async <R>(_fn: () => R) =>
      ({
        fallback: true,
        elements: [{ tag: "h1", classes: [] }],
      }) as unknown as R;

    const warn = vi.fn();
    const out = await serializeRelevantDom(page, warn);
    expect(out).toEqual([{ tag: "h1", classes: [] }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("dom-fallback-to-body");
  });

  it("drops empty-string testId values defensively", async () => {
    const page = makePage();
    page.evaluate = async <R>(_fn: () => R) =>
      ({
        fallback: false,
        elements: [{ tag: "input", classes: ["x"], testId: "" }],
      }) as unknown as R;

    const out = await serializeRelevantDom(page);
    expect(out).toEqual([{ tag: "input", classes: ["x"] }]);
  });
});

describe("D5_REGISTRY isolation between tests", () => {
  it("starts empty thanks to beforeEach __clearD5RegistryForTesting", () => {
    expect(D5_REGISTRY.size).toBe(0);
  });
});
