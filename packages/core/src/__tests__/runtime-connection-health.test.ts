import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitCore,
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} from "../core";
import { ɵRUNTIME_PROBE_TIMEOUT_MS } from "../core/agent-registry";
import type { RuntimeRequestInit } from "../utils/runtime-request";
import { RUNTIME_REQUEST_WATCHDOG_MS } from "../utils/runtime-request";
import { ɵcreateThreadStore, ɵTHREAD_REQUEST_TIMEOUT_MS } from "../threads";
import { waitForCondition } from "./test-utils";
import { logger } from "@copilotkit/shared";

const RUNTIME_URL = "https://runtime.example/api";
/** A second runtime, for the "the configuration changed" cases. */
const ALT_RUNTIME_URL = "https://other-runtime.example/api";
const INFO_URL = `${RUNTIME_URL}/info`;
const RUN_URL = `${RUNTIME_URL}/agent/default/run`;

/**
 * Long enough that any plausible background period would have fired many times
 * inside it. Absences are asserted over this window on FAKE timers: a window
 * shorter than the behaviour under test can only catch a retry loop whose
 * period happens to be shorter than the observation, which is precisely the
 * shape the PRD rejects by name.
 *
 * THE BOUNDARY, stated so nobody over-reads these tests: ten minutes of
 * virtual time is all the suite ever sees, so scheduled work with a period
 * longer than that is invisible to every absence test here. Extending the
 * window does not fix that — it only moves the boundary, and any fixed window
 * has one. What actually covers the gap is the complementary
 * `vi.getTimerCount()` assertion: it is period-independent, so a timer left
 * armed is caught whatever interval it would have used. Prefer adding one of
 * those over lengthening this.
 */
const TEN_MINUTES_MS = 10 * 60_000;

const encoder = new TextEncoder();

/** A 200 SSE response carrying exactly the given events, then closing. */
function sseEvents(events: unknown[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A minimal, well-formed SSE run response — a run that genuinely succeeds. */
function sseResponse(): Response {
  return sseEvents([
    { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
    {
      type: "RUN_FINISHED",
      threadId: "test-thread",
      runId: "test-run",
      result: { newMessages: [] },
    },
  ]);
}

/**
 * A 200 SSE response whose stream stays open until the test closes it. The
 * response resolves immediately — which is what makes the run count as a
 * successful runtime request — while its events are still being pushed, so a
 * recovery re-sync runs mid-stream, exactly as it does against a real runtime.
 */
function controllableSseStream(): {
  response: Response;
  push: (event: unknown) => void;
  close: () => void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push: (event: unknown) => {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close: () => controller.close(),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

type Handler = (init?: RequestInit) => Promise<Response>;

/**
 * A runtime that ACCEPTS the connection and never answers — the second way a
 * server fails, and the one a stopped dev server does not model. A container
 * mid-rollout, a half-switched deploy and a dropped tunnel all look like this.
 *
 * It honours an abort, as a real `fetch` does. That matters: a caller giving up
 * on its own clock only learns anything because the aborted request rejects,
 * and a mock that ignored the signal would hide whether the outcome is reported
 * at all.
 */
const hangs: Handler = (init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAsAborted = () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (!signal) return;
    if (signal.aborted) {
      rejectAsAborted();
      return;
    }
    signal.addEventListener("abort", rejectAsAborted, { once: true });
  });

const DEFAULT_INFO = {
  version: "1.0.0",
  agents: { default: { description: "assistant", capabilities: {} } },
};

describe("runtime connection health (OSS-904)", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  let fetchMock: ReturnType<typeof vi.fn>;
  /** Answers `/info` — the startup handshake AND the confirmation probe. */
  let infoHandler: Handler;
  /** Answers the agent run route. */
  let runHandler: Handler;
  /** Answers the SECOND runtime, used by the configuration-change cases. */
  let altInfoHandler: Handler;
  let altRunHandler: Handler;
  /** Answers `${runtimeUrl}/threads?…` and `${runtimeUrl}/threads/subscribe`. */
  let threadListHandler: Handler;
  let threadSubscribeHandler: Handler;
  let infoCalls: number;
  let runCalls: number;
  let altInfoCalls: number;
  let otherCalls: string[];
  /** The diagnosis the developer actually reads. */
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    (globalThis as { window?: unknown }).window = {};
    infoCalls = 0;
    runCalls = 0;
    altInfoCalls = 0;
    otherCalls = [];
    infoHandler = async () => jsonResponse(DEFAULT_INFO);
    runHandler = async () => sseResponse();
    altInfoHandler = async () => jsonResponse(DEFAULT_INFO);
    altRunHandler = async () => sseResponse();
    threadListHandler = async () => jsonResponse({ threads: [] });
    threadSubscribeHandler = async () => jsonResponse({ joinToken: "token" });
    fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      const method = (init?.method ?? "GET").toUpperCase();

      if (target.startsWith(`${RUNTIME_URL}/threads/subscribe`)) {
        return threadSubscribeHandler(init);
      }
      if (target.startsWith(`${RUNTIME_URL}/threads`)) {
        return threadListHandler(init);
      }

      // Single-endpoint transport: every call is a POST to the runtime root
      // carrying an envelope that names the operation.
      if (target === RUNTIME_URL && method === "POST") {
        let envelopeMethod = "";
        try {
          envelopeMethod = String(
            (JSON.parse(String(init?.body ?? "{}")) as { method?: unknown })
              .method ?? "",
          );
        } catch {
          envelopeMethod = "";
        }
        if (envelopeMethod === "info") {
          infoCalls += 1;
          return infoHandler(init);
        }
        runCalls += 1;
        return runHandler(init);
      }

      if (target === INFO_URL) {
        infoCalls += 1;
        return infoHandler(init);
      }
      if (target.startsWith(`${RUNTIME_URL}/agent/`)) {
        runCalls += 1;
        return runHandler(init);
      }
      if (target === `${ALT_RUNTIME_URL}/info`) {
        altInfoCalls += 1;
        return altInfoHandler(init);
      }
      if (target.startsWith(`${ALT_RUNTIME_URL}/agent/`)) {
        return altRunHandler(init);
      }
      otherCalls.push(target);
      throw new Error(`Unexpected fetch: ${target}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  /** A core connected to a reachable runtime — the state at page load. */
  async function bootConnectedCore(
    options?: Parameters<typeof createCore>[0],
  ): Promise<CopilotKitCore> {
    const core = createCore(options);
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    return core;
  }

  function createCore(options?: {
    runtimeUrl?: string;
    runtimeTransport?: "rest" | "single" | "auto";
  }): CopilotKitCore {
    return new CopilotKitCore({
      runtimeUrl: options?.runtimeUrl ?? RUNTIME_URL,
      runtimeTransport: options?.runtimeTransport ?? "rest",
    });
  }

  /**
   * Everything to the runtime now fails outright — the dev server is gone.
   *
   * `hang` models the OTHER way a server dies: the connection is accepted and
   * the answer never comes. `info` and `runs` are independent because the
   * interesting cases are asymmetric — a runtime whose run route answers while
   * `/info` hangs is a container mid-rollout, and it is the case that keeps the
   * status green forever if the probe is unbounded.
   */
  function takeRuntimeDown(
    options: { hang?: boolean | { info?: boolean; runs?: boolean } } = {},
  ): void {
    const hang = options.hang ?? false;
    const hangInfo = hang === true || (hang !== false && hang.info === true);
    const hangRuns = hang === true || (hang !== false && hang.runs === true);
    const refuse: Handler = async () => {
      throw new TypeError("Failed to fetch");
    };
    infoHandler = hangInfo ? hangs : refuse;
    runHandler = hangRuns ? hangs : refuse;
  }

  function bringRuntimeUp(info: unknown = DEFAULT_INFO): void {
    infoHandler = async () => jsonResponse(info);
    runHandler = async () => sseResponse();
  }

  /**
   * A runtime that is PART-WAY BACK: it answers `/info` truthfully and with a
   * 200, but with a different — often empty — agent list, because it has not
   * finished booting. Its report cannot be trusted to mean "these agents are
   * gone".
   */
  function bringRuntimePartWayBack(
    agents: Record<string, { description: string; capabilities: object }> = {},
    version = "1.0.0",
  ): void {
    bringRuntimeUp({ version, agents });
  }

  const runOnce = (core: CopilotKitCore, agentId = "default") =>
    core.runAgent({ agent: core.getAgent(agentId) as AbstractAgent });

  const waitForStatus = (
    core: CopilotKitCore,
    status: CopilotKitCoreRuntimeConnectionStatus,
  ) => waitForCondition(() => core.runtimeConnectionStatus === status);

  /**
   * `waitForCondition` on FAKE timers: it drives the clock instead of waiting
   * on it, so anything the implementation schedules (a probe timeout, and any
   * background work that should not exist) fires inside the window.
   */
  async function waitForConditionVirtual(
    condition: () => boolean,
    budgetMs = 30_000,
  ): Promise<void> {
    const step = 10;
    let elapsed = 0;
    while (!condition()) {
      if (elapsed > budgetMs) {
        throw new Error("Timeout waiting for condition (virtual clock)");
      }
      await vi.advanceTimersByTimeAsync(step);
      elapsed += step;
    }
    // Let any promise chain the condition unblocked run to completion.
    await vi.advanceTimersByTimeAsync(0);
  }

  const waitForStatusVirtual = (
    core: CopilotKitCore,
    status: CopilotKitCoreRuntimeConnectionStatus,
  ) => waitForConditionVirtual(() => core.runtimeConnectionStatus === status);

  // --- 1/2: detection -----------------------------------------------------

  it("moves the status to error and notifies subscribers when the runtime went away after load", async () => {
    const core = await bootConnectedCore();
    const statuses: CopilotKitCoreRuntimeConnectionStatus[] = [];
    core.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        statuses.push(status);
      },
    });

    takeRuntimeDown();
    await runOnce(core);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(statuses).toEqual([CopilotKitCoreRuntimeConnectionStatus.Error]);
    // Exactly one confirmation probe — the startup handshake plus one.
    expect(infoCalls).toBe(2);
  });

  it("emits RUNTIME_INFO_FETCH_FAILED with the runtime url, alongside the run failure", async () => {
    const core = await bootConnectedCore();
    const errors: Array<{
      code: CopilotKitCoreErrorCode;
      context?: Record<string, unknown>;
    }> = [];
    core.subscribe({
      onError: (event) => {
        errors.push(event as never);
      },
    });

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    const wiring = errors.find(
      (e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    );
    expect(wiring).toBeDefined();
    expect(wiring?.context?.runtimeUrl).toBe(RUNTIME_URL);
    // The failed run is still reported as a failed run: what failed AND why.
    expect(
      errors.some((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED),
    ).toBe(true);
  });

  // --- 3: nothing is destroyed on the way in ------------------------------

  it("preserves the agent instance, its messages and threadId, and the runtime knowledge", async () => {
    infoHandler = async () =>
      jsonResponse({
        ...DEFAULT_INFO,
        intelligence: { wsUrl: "wss://realtime.example" },
        threadEndpoints: {
          list: true,
          inspect: true,
          mutations: true,
          realtimeMetadata: false,
        },
      });
    const core = await bootConnectedCore();

    const agent = core.getAgent("default")!;
    agent.setMessages([
      { id: "assistant-1", role: "assistant", content: "Hello from run-1" },
    ]);
    agent.threadId = "thread-run-1";

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The conversation is what the user is looking at — it must not move.
    expect(core.getAgent("default")).toBe(agent);
    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0]?.id).toBe("assistant-1");
    expect(agent.threadId).toBe("thread-run-1");

    // Runtime knowledge is preserved too — the narrow path touches none of it.
    expect(core.runtimeVersion).toBe("1.0.0");
    expect(core.intelligence).toEqual({ wsUrl: "wss://realtime.example" });
    expect(core.threadEndpoints).toEqual({
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: false,
    });
  });

  // --- 4/5: recovery ------------------------------------------------------

  it("returns to connected on the next successful runtime request", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    bringRuntimeUp();
    await runOnce(core);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
  });

  it("re-syncs on recovery: an agent added appears and the version refreshes", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          retired: { description: "going away", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    const agent = core.getAgent("default")!;
    expect(Object.keys(core.agents).sort()).toEqual(["default", "retired"]);

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The dev server comes back with a different agent set and a new version.
    bringRuntimeUp({
      version: "2.0.0",
      agents: {
        default: { description: "assistant", capabilities: {} },
        added: { description: "brand new", capabilities: {} },
      },
    });
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    // Added, updated — and `retired` pruned. A non-empty list that omits an
    // agent is credible evidence that agent is gone, and `retired` is backing
    // nothing: no messages, no thread bound to it. See the two conditions in
    // `reconcileRecoveredAgents`.
    expect(Object.keys(core.agents).sort()).toEqual(["added", "default"]);
    expect(core.runtimeVersion).toBe("2.0.0");
    // The open conversation survived the re-sync.
    expect(core.getAgent("default")).toBe(agent);
  });

  // --- 6: the regression the whole design exists to prevent ---------------

  it("keeps the agents and stays at error when the recovery re-sync itself fails", async () => {
    const core = await bootConnectedCore();
    const agent = core.getAgent("default")!;
    agent.setMessages([
      { id: "assistant-1", role: "assistant", content: "Hello from run-1" },
    ]);

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // A runtime only part-way back: the run route answers, /info does not —
    // a container mid-rollout, a tunnel re-establishing. This is the window
    // where the destructive failure branch would have dropped the agents,
    // emptied the conversation and closed the submission gate, leaving an
    // error state that no successful request could ever be issued from.
    runHandler = async () => sseResponse();
    await runOnce(core);

    // It passes through connecting and lands back on error.
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
          CopilotKitCoreRuntimeConnectionStatus.Error && infoCalls >= 3,
    );
    await settle();

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    // Everything survived: same instance, same messages, same knowledge.
    expect(core.getAgent("default")).toBe(agent);
    expect(agent.messages).toHaveLength(1);
    expect(Object.keys(core.agents)).toEqual(["default"]);
    expect(core.runtimeVersion).toBe("1.0.0");

    // And it is still recoverable: the state can be left.
    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(core.getAgent("default")).toBe(agent);
  });

  it("bounds recovery /info so a hang cannot leave the status at connecting", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    const agent = core.getAgent("default")!;

    takeRuntimeDown();
    void runOnce(core).catch(() => undefined);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    // Run answers, /info hangs: the container is mid-rollout. Recovery must
    // not wait on that /info forever — connecting would pin Intelligence
    // realtime down, and later successes could not start a new /info.
    runHandler = async () => sseResponse();
    infoHandler = hangs;
    await runOnce(core);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    await vi.advanceTimersByTimeAsync(ɵRUNTIME_PROBE_TIMEOUT_MS - 100);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );

    await vi.advanceTimersByTimeAsync(200);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(core.getAgent("default")).toBe(agent);

    bringRuntimeUp();
    await runOnce(core);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(core.getAgent("default")).toBe(agent);
  });

  it("does not emit an unhandled rejection when the probe timeout aborts /info", async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    takeRuntimeDown({ hang: { info: true } });
    void runOnce(core).catch(() => undefined);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    await vi.advanceTimersByTimeAsync(0);

    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
  });

  // --- 7/8/9: the trigger rules ------------------------------------------

  it("probes on a non-ok HTTP response and never on an ok one", async () => {
    const core = await bootConnectedCore();
    expect(infoCalls).toBe(1);

    // An ok response: the runtime demonstrably answered — nothing to check.
    await runOnce(core);
    await settle();
    expect(infoCalls).toBe(1);

    // A gateway error in front of a stopped runtime: the production shape.
    runHandler = async () => new Response("Bad Gateway", { status: 502 });
    infoHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    await runOnce(core);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);
  });

  it("ignores a cancelled request — the AbortError mechanism", async () => {
    const core = await bootConnectedCore();
    runHandler = async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    };

    await runOnce(core);
    await settle();

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(1);
  });

  it("ignores a cancelled request — the message-string mechanism", async () => {
    const core = await bootConnectedCore();

    for (const message of [
      "Fetch is aborted",
      "signal is aborted without reason",
      "component unmounted",
    ]) {
      runHandler = async () => {
        throw new Error(message);
      };
      await runOnce(core);
    }
    await settle();

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(1);
  });

  it("a single ambiguous failure against a runtime that is up costs one probe and changes nothing", async () => {
    const core = await bootConnectedCore();
    // The request fails, but the runtime is fine — a blip.
    runHandler = async () => {
      throw new TypeError("Failed to fetch");
    };

    await runOnce(core);
    await waitForCondition(() => infoCalls === 2);
    await settle();

    expect(infoCalls).toBe(2);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  // --- 10: one probe per burst --------------------------------------------

  it("answers a burst of simultaneous failures with exactly one probe", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();

    // Several runtime requests fail at once — several agents on one dead
    // runtime, or a chat run and a panel load together.
    const runtimeFetch = core.ɵruntimeFetch;
    await Promise.all(
      Array.from({ length: 5 }, () =>
        runtimeFetch(RUN_URL, { method: "POST" }).catch(() => undefined),
      ),
    );

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    // Long enough for a per-failure probe to have shown up. Collapsing the
    // burst is the in-flight latch's job and nothing else's — there is no
    // post-probe window absorbing anything.
    await settle(500);

    // One probe answered for all of them, not one per failure.
    expect(infoCalls).toBe(2);
  });

  // --- 11/12: absences ----------------------------------------------------

  // These two are the ONLY evidence for "no polling, no heartbeat, no retry
  // loop". They run entirely on fake timers, installed BEFORE the core exists,
  // so a timer armed anywhere in the implementation is a fake one and fires
  // inside the window. Observing a real 2.5s window instead would only catch a
  // loop whose period is shorter than the observation — which is exactly the
  // behaviour the PRD rejects ("works for the first minute and then stops").

  it("issues no requests at all over ten minutes while the status is error", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    takeRuntimeDown();
    void runOnce(core).catch(() => undefined);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    const callsAtRed = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(fetchMock.mock.calls.length).toBe(callsAtRed);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
  });

  it("issues no extra requests over ten minutes in the healthy case", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(1);

    await runOnce(core);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    // Exactly what the application caused: one handshake, one run.
    expect(infoCalls).toBe(1);
    expect(runCalls).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(otherCalls).toEqual([]);
  });

  // --- 13: ordering -------------------------------------------------------

  it("does not let a late unreachable verdict override an earlier success", async () => {
    const core = await bootConnectedCore();

    // The probe hangs; we release it only after a later request has succeeded.
    let releaseProbe: () => void = () => {};
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    infoHandler = async () => {
      await probeGate;
      throw new TypeError("Failed to fetch");
    };
    runHandler = async () => {
      throw new TypeError("Failed to fetch");
    };

    await runOnce(core);
    await waitForCondition(() => infoCalls === 2);

    // The user retries and the runtime answers.
    runHandler = async () => sseResponse();
    await runOnce(core);
    await settle();
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // Only now does the stale probe come back with "unreachable".
    releaseProbe();
    await settle(100);

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  // --- 14: server rendering -----------------------------------------------

  it("does nothing during server rendering", async () => {
    const core = await bootConnectedCore();
    const runtimeFetch = core.ɵruntimeFetch;
    expect(infoCalls).toBe(1);

    delete (globalThis as { window?: unknown }).window;
    runHandler = async () => {
      throw new TypeError("Failed to fetch");
    };

    await expect(
      runtimeFetch(RUN_URL, { method: "POST" }),
    ).rejects.toBeInstanceOf(TypeError);
    await settle(100);

    // No probe, no status change: nothing new executes on the server.
    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  // --- the seam itself ----------------------------------------------------

  it("passes responses and errors through unchanged", async () => {
    const core = await bootConnectedCore();
    const runtimeFetch = core.ɵruntimeFetch;

    const expected = sseResponse();
    runHandler = async () => expected;
    await expect(runtimeFetch(RUN_URL, { method: "POST" })).resolves.toBe(
      expected,
    );

    const failure = new TypeError("Failed to fetch");
    runHandler = async () => {
      throw failure;
    };
    await expect(runtimeFetch(RUN_URL, { method: "POST" })).rejects.toBe(
      failure,
    );
  });

  // --- a runtime that HANGS ------------------------------------------------
  //
  // The second way a server fails. Everything above models a runtime that
  // REFUSES, which fails fast; a container mid-rollout, a half-switched deploy
  // and a dropped tunnel accept the connection and never answer.

  it("confirms a hung runtime as unreachable instead of staying green forever", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The run route is refused and `/info` never answers — the shape of a
    // container that is up enough to accept sockets and not up enough to serve.
    takeRuntimeDown({ hang: { info: true } });
    void runOnce(core).catch(() => undefined);

    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    // Still exactly one probe: the bound is a timeout, not a second attempt.
    expect(infoCalls).toBe(2);
  });

  it("bounds the probe rather than waiting on the runtime indefinitely", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    takeRuntimeDown({ hang: { info: true } });
    void runOnce(core).catch(() => undefined);
    await waitForConditionVirtual(() => infoCalls === 2);

    // Just short of the bound the verdict is still open.
    await vi.advanceTimersByTimeAsync(ɵRUNTIME_PROBE_TIMEOUT_MS - 100);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    await vi.advanceTimersByTimeAsync(200);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
  });

  it("releases the probe latch when a probe never answers, so later failures are still checked", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // Probe 1 hangs and is abandoned at the bound.
    takeRuntimeDown({ hang: { info: true } });
    void runOnce(core).catch(() => undefined);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(infoCalls).toBe(2);

    // The runtime comes back and the user retries: recovery re-syncs.
    bringRuntimeUp();
    await runOnce(core);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(3);

    // It dies again. A latch left stuck by the abandoned probe would swallow
    // this failure and leave the status green — the original bug, restored.
    takeRuntimeDown();
    void runOnce(core).catch(() => undefined);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(infoCalls).toBe(4);
  });

  it("does not let a probe against the previous runtime block checks after the runtime url changes", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // A probe is in flight against the runtime we are about to leave.
    takeRuntimeDown({ hang: { info: true } });
    void runOnce(core).catch(() => undefined);
    await waitForConditionVirtual(() => infoCalls === 2);

    // The developer points the app at a different runtime, which answers.
    core.setRuntimeUrl(ALT_RUNTIME_URL);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(altInfoCalls).toBe(1);

    // The new runtime then goes away. The abandoned probe belongs to a runtime
    // this application no longer talks to and must not gate this check.
    altRunHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    altInfoHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    void runOnce(core).catch(() => undefined);

    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(altInfoCalls).toBe(2);
  });

  // --- a request that never settles (the watchdog) -------------------------
  //
  // Everything above reacts to the OUTCOME of a request. A runtime that
  // accepts the connection and never answers produces no outcome at all, so
  // without a watchdog nothing is ever reported and no probe is ever started —
  // the status stays green forever against exactly the failures this feature
  // names. Reproduced manually against the demo: a server that accepts TCP and
  // never writes, a message sent, and System Health still reading healthy after
  // 35 seconds with the request still pending.
  //
  // The probe's own bound does not help: it bounds a probe, and no probe is
  // started.

  it("confirms an outage when the run request itself hangs and never answers", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // Nothing refuses and nothing answers — the container is mid-restart, the
    // deploy is half switched, the tunnel dropped.
    takeRuntimeDown({ hang: true });
    void runOnce(core).catch(() => undefined);

    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    // One probe, reached through the watchdog rather than through an outcome.
    expect(infoCalls).toBe(2);
  });

  it("waits the bounded interval before treating silence as a suspected outage", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    takeRuntimeDown({ hang: true });
    void runOnce(core).catch(() => undefined);

    // Just short of the bound nothing has been asked: a runtime that is merely
    // taking its time is not an outage.
    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS - 100);
    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    await vi.advanceTimersByTimeAsync(200);
    expect(infoCalls).toBe(2);
  });

  it("leaves a slow but healthy runtime alone and lets its run finish normally", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // Headers promptly, body streaming for far longer than the bound — an
    // agent that thinks for a minute. The watchdog watches for RESPONSE
    // HEADERS, which is what `fetch` resolves on, so the stream that follows
    // is none of its business.
    const stream = controllableSseStream();
    runHandler = async () => stream.response;
    const agent = core.getAgent("default") as AbstractAgent;
    agent.threadId = "thread-slow";
    const run = core.runAgent({ agent });

    stream.push({
      type: "RUN_STARTED",
      threadId: "thread-slow",
      runId: "slow-run",
    });
    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS * 3);

    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // And the run still completes, unaffected: the watchdog observes, it never
    // interferes with the user's run.
    stream.push({
      type: "RUN_FINISHED",
      threadId: "thread-slow",
      runId: "slow-run",
      result: { newMessages: [] },
    });
    stream.close();
    await run;
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(infoCalls).toBe(1);
    expect(runCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  it("leaves no timer behind when a request settles normally and fast", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The package has no disposal path, so a watchdog that is not cleared on
    // settle is a leak with no owner to collect it — and a probe that fires
    // ten seconds after a perfectly good run.
    const timersBefore = vi.getTimerCount();
    await runOnce(core);
    expect(vi.getTimerCount()).toBe(timersBefore);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);
    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  it("watches a hung request exactly once, however long it hangs", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The run route hangs for good while `/info` keeps answering, so the
    // watchdog reports once, the probe finds the runtime healthy, and the
    // request is STILL open afterwards. That is the state in which a repeating
    // timer would show itself: a fresh probe every interval for as long as one
    // request hangs, i.e. exactly the recurring background traffic this design
    // rejects by name — and against a forgotten tab, forever.
    const timersBefore = vi.getTimerCount();
    runHandler = hangs;
    void runOnce(core).catch(() => undefined);

    await waitForConditionVirtual(() => infoCalls === 2);
    await vi.advanceTimersByTimeAsync(100);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    // Period-independent: the watchdog is spent and the probe has settled, so
    // nothing is scheduled at all. This holds whatever interval a repeating
    // timer might have used.
    expect(vi.getTimerCount()).toBe(timersBefore);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);
    expect(infoCalls).toBe(2);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  it("does not ask a second time when a watched request finally fails", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The run route hangs while `/info` answers: the watchdog reports, and the
    // probe finds the runtime healthy, so the status stays green and the latch
    // is released.
    let failTheRun: () => void = () => {};
    runHandler = () =>
      new Promise<Response>((_resolve, reject) => {
        failTheRun = () => reject(new TypeError("Failed to fetch"));
      });
    void runOnce(core).catch(() => undefined);

    await waitForConditionVirtual(() => infoCalls === 2);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The hung request now gives up. That is the same fact the watchdog
    // already reported about the same request, not a second incident, so it
    // must not buy another probe.
    failTheRun();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(infoCalls).toBe(2);
  });

  it("still checks the runtime when a watched request's silence report bought no check", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The run hangs, so its watchdog will fire at the bound.
    let failTheRun: () => void = () => {};
    runHandler = () =>
      new Promise<Response>((_resolve, reject) => {
        failTheRun = () => reject(new TypeError("Failed to fetch"));
      });
    void runOnce(core).catch(() => undefined);

    // Late in the run's window another runtime request fails and starts a
    // probe whose `/info` this test holds open. The probe is therefore still in
    // flight when the run's watchdog fires, so the watchdog's report finds the
    // latch held and buys no check of its own.
    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS - 3_000);
    let answerInfo: (response: Response) => void = () => {};
    infoHandler = () =>
      new Promise<Response>((resolve) => {
        answerInfo = resolve;
      });
    threadListHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    void core
      .ɵruntimeFetch(`${RUNTIME_URL}/threads?agentId=default`)
      .catch(() => undefined);
    await waitForConditionVirtual(() => infoCalls === 2);

    // The watchdog fires while that probe is still open — and its report goes
    // nowhere.
    await vi.advanceTimersByTimeAsync(3_100);
    expect(infoCalls).toBe(2);

    // The probe comes back healthy, so nothing turns red and the latch is
    // released. Then the runtime dies for real.
    answerInfo(jsonResponse(DEFAULT_INFO));
    await vi.advanceTimersByTimeAsync(100);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    takeRuntimeDown();

    // The run's own failure is the first report that can buy a check. A flag
    // claiming the watchdog already reported swallows it and leaves the status
    // green against a dead runtime: suppression belongs to a report that
    // actually CAUSED a check, not to a timer having fired.
    failTheRun();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(infoCalls).toBe(3);
  });

  it("still reports the answer of a watched request that eventually arrives", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The run hangs and `/info` is gone, so the watchdog's probe paints the
    // status red while the request is still open.
    let answerTheRun: (response: Response) => void = () => {};
    runHandler = () =>
      new Promise<Response>((resolve) => {
        answerTheRun = resolve;
      });
    infoHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    void runOnce(core).catch(() => undefined);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    expect(infoCalls).toBe(2);

    // The runtime was only very, very slow. Because the watchdog never
    // cancelled anything, the answer still arrives — and it is still evidence
    // of contact, so it still recovers the status. Suppressing the duplicate
    // FAILURE must not suppress this.
    bringRuntimeUp();
    answerTheRun(sseResponse());

    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(3);
  });

  it("does not arm the watchdog for a request the caller declared non-critical", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    takeRuntimeDown({ hang: true });
    const controller = new AbortController();
    const init: RuntimeRequestInit = {
      method: "POST",
      signal: controller.signal,
      ɵruntimeRequest: { nonCritical: true },
    };
    const timersBefore = vi.getTimerCount();
    const pending = core.ɵruntimeFetch(RUN_URL, init).catch(() => undefined);

    // Nothing was scheduled at all: a request the code itself treats as
    // harmless must not be able to trigger anything.
    expect(vi.getTimerCount()).toBe(timersBefore);
    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS * 3);
    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    controller.abort();
    await pending;
  });

  it("does not arm the watchdog for a request the caller already bounds itself", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The thread store gives up on its own clock, so its request cannot fail
    // to produce an outcome — which is the only gap the watchdog fills. Its
    // own budget decides when, not ours.
    threadListHandler = hangs;
    takeRuntimeDown();
    const store = ɵcreateThreadStore({ fetch: core.ɵruntimeFetch });
    store.start();
    store.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: "default",
    });

    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS + 1_000);
    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    store.stop();
  });

  it("arms no watchdog during server rendering", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    const runtimeFetch = core.ɵruntimeFetch;

    takeRuntimeDown({ hang: true });
    delete (globalThis as { window?: unknown }).window;

    const controller = new AbortController();
    const timersBefore = vi.getTimerCount();
    const pending = runtimeFetch(RUN_URL, {
      method: "POST",
      signal: controller.signal,
    }).catch(() => undefined);

    expect(vi.getTimerCount()).toBe(timersBefore);
    await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS * 3);
    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    controller.abort();
    await pending;
  });

  // --- consecutive incidents are each their own -----------------------------

  it("does not suppress a new failure after the probe came back healthy", async () => {
    const core = await bootConnectedCore();

    // A blip: the request fails, the probe finds the runtime healthy.
    runHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    await runOnce(core);
    await waitForCondition(() => infoCalls === 2);
    await settle();
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // Immediately afterwards the runtime genuinely goes away. That is new
    // information, not part of the burst the healthy probe answered, and
    // absorbing it would open a window in which a real outage leaves no trace.
    takeRuntimeDown();
    await runOnce(core);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(3);
  });

  it("issues no further probe and no duplicate error when a retry fails while already red", async () => {
    const core = await bootConnectedCore();
    const wiringErrors: CopilotKitCoreErrorCode[] = [];
    core.subscribe({
      onError: (event) => {
        if (
          (event as { code: CopilotKitCoreErrorCode }).code ===
          CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED
        ) {
          wiringErrors.push(CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED);
        }
      },
    });

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    const infoAtRed = infoCalls;
    const wiringAtRed = wiringErrors.length;

    // A developer presses Send three times at a red indicator — which is what
    // people do. While `Error` there is nothing left to confirm, so each
    // further failure must buy nothing: probing again would be a retry loop the
    // user is driving, one extra probe and one duplicate wiring error per
    // press.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runOnce(core).catch(() => undefined);
    }
    await settle(200);

    expect(infoCalls).toBe(infoAtRed);
    expect(wiringErrors.length).toBe(wiringAtRed);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
  });

  it("checks again when a runtime flaps back and dies immediately", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);

    // A crash-looping runtime: back for one request, then gone again. Each
    // outage is its own incident and gets its own check. The alternative — a
    // window after a confirmed outage in which failures are absorbed — buys
    // nothing the in-flight latch does not already buy, and costs a blind
    // window in exactly the case it is meant to cover.
    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(infoCalls).toBe(3);

    takeRuntimeDown();
    await runOnce(core);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(4);
  });

  // --- recovery collapsing and ordering ------------------------------------

  it("does not drop a success that lands while a failed recovery re-sync is still settling", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // From here the run route answers but `/info` does not, so the recovery
    // re-sync fails and lands back on error.
    runHandler = async () => sseResponse();

    // The user's next attempt succeeds while that failed re-sync is still
    // notifying subscribers and emitting its error. The in-flight collapse
    // must not hand this success the already-dying attempt: the chat visibly
    // works and the indicator would stay red for the rest of the page's life.
    let injected = false;
    const runtimeFetch = core.ɵruntimeFetch;
    core.subscribe({
      onRuntimeConnectionStatusChanged: async ({ status }) => {
        if (
          status !== CopilotKitCoreRuntimeConnectionStatus.Error ||
          injected
        ) {
          return;
        }
        injected = true;
        bringRuntimeUp();
        await runtimeFetch(RUN_URL, { method: "POST" }).catch(() => undefined);
      },
    });

    await runOnce(core);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(injected).toBe(true);
  });

  it("does not paint the status red from a re-sync a later success has overtaken", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The runtime is answering runs again, but `/info` is slow — and the first
    // answer it gives is a failure.
    runHandler = async () => sseResponse();
    let releaseInfo: () => void = () => {};
    const infoGate = new Promise<void>((resolve) => {
      releaseInfo = resolve;
    });
    let gatedInfoAnswered = false;
    infoHandler = async () => {
      if (!gatedInfoAnswered) {
        gatedInfoAnswered = true;
        await infoGate;
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(DEFAULT_INFO);
    };

    // Watch from here, so the transition INTO the outage is not counted.
    const statuses: CopilotKitCoreRuntimeConnectionStatus[] = [];
    const wiringErrors: unknown[] = [];
    core.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        statuses.push(status);
      },
      onError: (event) => {
        if (
          (event as { code?: CopilotKitCoreErrorCode }).code ===
          CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED
        ) {
          wiringErrors.push(event);
        }
      },
    });

    // Success 1 starts the re-sync.
    await runOnce(core);
    await waitForCondition(() => infoCalls === 3);

    // Success 2 lands while that re-sync is still waiting on `/info`.
    await runOnce(core);
    await settle();

    // Only now does the slow `/info` fail. It describes a moment that has
    // passed: two later runs have since been answered by the runtime.
    releaseInfo();
    await settle();

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    // The overtaken verdict left no trace at all. Without the ordering guard it
    // still paints red on its way past — a red System Health, a red launcher
    // signal and a wiring error in the customer's own handler, all describing a
    // runtime that has demonstrably been answering.
    expect(statuses).not.toContain(CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(wiringErrors).toHaveLength(0);
  });

  // --- a configuration change while the status is red ----------------------

  it("keeps the conversation and a way out when the transport changes while the status is error", async () => {
    const core = await bootConnectedCore();
    const agent = core.getAgent("default")!;
    agent.setMessages([
      { id: "assistant-1", role: "assistant", content: "Hello from run-1" },
    ]);

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // A developer fiddles with the configuration precisely when the indicator
    // is red. The runtime is still down, so this attempt fails too.
    core.setRuntimeTransport("single");
    await settle();

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );
    // The conversation is what the user is looking at, and the agents are what
    // keeps the submission gate open — the only way back out of the red state.
    expect(core.getAgent("default")).toBe(agent);
    expect(agent.messages).toHaveLength(1);
    expect(Object.keys(core.agents)).toEqual(["default"]);

    // And it really is leavable.
    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(core.getAgent("default")).toBe(agent);
  });

  it("keeps the conversation and a way out when a configuration change lands in the window recovery creates", async () => {
    const core = await bootConnectedCore();
    const agent = core.getAgent("default")!;
    agent.setMessages([
      { id: "assistant-1", role: "assistant", content: "Hello from run-1" },
    ]);

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // Recovery deliberately passes through `connecting`, and it sits there for
    // as long as its `/info` is outstanding. What is at stake in that window is
    // identical to the red state either side of it — the agents hold the
    // conversation and keep the submission gate open — so a guard keyed on the
    // status VALUE rather than on the knowledge misses it entirely.
    const refuseInfo: Array<(error: Error) => void> = [];
    infoHandler = () =>
      new Promise<Response>((_resolve, reject) => {
        refuseInfo.push(reject);
      });
    runHandler = async () => sseResponse();
    void runOnce(core).catch(() => undefined);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connecting);

    core.setRuntimeTransport("single");
    await waitForCondition(() => refuseInfo.length === 2);
    refuseInfo.forEach((reject) => reject(new TypeError("Failed to fetch")));
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    expect(core.getAgent("default")).toBe(agent);
    expect(agent.messages).toHaveLength(1);
    expect(Object.keys(core.agents)).toEqual(["default"]);

    // And it really is leavable.
    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(core.getAgent("default")).toBe(agent);
  });

  it("still discards runtime knowledge when a configuration change fails from a healthy connection", async () => {
    const core = await bootConnectedCore();
    expect(Object.keys(core.agents)).toEqual(["default"]);

    // Nothing to escape here: contact is established, so a failed deliberate
    // change is the ordinary destructive case and must stay destructive — the
    // developer can simply point the configuration somewhere that works.
    altInfoHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    core.setRuntimeUrl(ALT_RUNTIME_URL);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    expect(Object.keys(core.agents)).toEqual([]);
    expect(core.runtimeVersion).toBeUndefined();
  });

  it("still discards runtime knowledge when a configuration change fails with no live conversation to protect", async () => {
    // A runtime advertising no agents: knowledge was obtained (the version),
    // but nothing a live session is using depends on it.
    infoHandler = async () => jsonResponse({ version: "1.0.0", agents: {} });
    const core = await bootConnectedCore();
    expect(core.runtimeVersion).toBe("1.0.0");
    expect(Object.keys(core.agents)).toEqual([]);

    // Park a re-connect in `connecting`, so the next change is made from the
    // same status value the recovery window has — and must NOT be protected,
    // because the protection is about live runtime knowledge, not about the
    // status reading `connecting`.
    const refuseInfo: Array<(error: Error) => void> = [];
    infoHandler = () =>
      new Promise<Response>((_resolve, reject) => {
        refuseInfo.push(reject);
      });
    core.setRuntimeTransport("single");
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connecting);

    altInfoHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    core.setRuntimeUrl(ALT_RUNTIME_URL);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    refuseInfo.forEach((reject) => reject(new TypeError("Failed to fetch")));
    await settle();

    // A stale version left behind is the invisible wrong state this design is
    // most afraid of.
    expect(core.runtimeVersion).toBeUndefined();
  });

  it("does not strand the status at connecting when a configuration change made while red is overtaken by a success", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // Runs are answered again, but `/info` is slow and then fails.
    runHandler = async () => sseResponse();
    let releaseInfo: () => void = () => {};
    const infoGate = new Promise<void>((resolve) => {
      releaseInfo = resolve;
    });
    infoHandler = async () => {
      await infoGate;
      throw new TypeError("Failed to fetch");
    };

    // A configuration change from the red state. Unlike recovery, nothing has
    // a follow-up attempt queued for it, so the ordering guard must not simply
    // decline to paint — that would leave the status at `connecting` with no
    // path back to any settled value.
    core.setRuntimeTransport("single");
    await waitForCondition(() => infoCalls === 3);
    await runOnce(core);
    await settle();

    releaseInfo();
    await settle();

    expect(core.runtimeConnectionStatus).not.toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    // And whichever settled value it took, it is still leavable.
    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
  });

  // --- destinations --------------------------------------------------------

  it("counts the `/info` request a proxied agent issues to resolve its own runtime mode", async () => {
    const core = createCore();
    // Registered before the handshake lands, so the proxy's runtime mode is
    // still "pending" and its first run re-resolves it through `/info`.
    const { agent } = core.registerProxiedAgent({
      agentId: "proxy",
      runtimeAgentId: "default",
    });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    takeRuntimeDown();
    await core.runAgent({ agent }).catch(() => undefined);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
  });

  it("counts runtime requests from an agent registered through registerProxiedAgent", async () => {
    const core = await bootConnectedCore();
    const { agent } = core.registerProxiedAgent({
      agentId: "proxy",
      runtimeAgentId: "default",
    });

    takeRuntimeDown();
    await core.runAgent({ agent }).catch(() => undefined);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);
  });

  it("leaves the status alone when a customer-owned agent fails", async () => {
    const core = await bootConnectedCore();
    const failing = new HttpAgent({ url: "https://customers-own.example/run" });
    failing.agentId = "mine";
    core.addAgent__unsafe_dev_only({ id: "mine", agent: failing });

    await core.runAgent({ agent: failing }).catch(() => undefined);
    await settle();

    // One broken agent against the customer's own server must not make the
    // shared runtime look broken.
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(1);
    expect(otherCalls).toEqual(["https://customers-own.example/run"]);
  });

  it("leaves the status alone when the agent reports RUN_ERROR inside a 200 stream", async () => {
    const core = await bootConnectedCore();
    runHandler = async () =>
      sseEvents([
        { type: "RUN_STARTED", threadId: "t", runId: "r" },
        { type: "RUN_ERROR", message: "the agent threw", code: "boom" },
      ]);

    await core
      .runAgent({ agent: core.getAgent("default") as AbstractAgent })
      .catch(() => undefined);
    await settle();

    // The runtime demonstrably answered; the agent is what failed.
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(1);
  });

  // --- recovery prunes, under two conditions -------------------------------

  it("removes nothing when a recovering runtime reports an empty agent list", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          helper: { description: "helper", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    const helper = core.getAgent("helper")!;

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // An empty list is the signature of a runtime that has not finished
    // registering: it answers truthfully that it is alive while listing
    // nothing. Believing it destroys the conversation and closes the
    // submission gate through the SUCCESS branch. `helper` carries no
    // conversation state, so ONLY condition 1 is holding it here.
    bringRuntimePartWayBack({}, "2.0.0");
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    await settle();

    expect(Object.keys(core.agents).sort()).toEqual(["default", "helper"]);
    expect(core.getAgent("helper")).toBe(helper);
    // What the runtime DID report is still taken.
    expect(core.runtimeVersion).toBe("2.0.0");
  });

  it("prunes an agent a recovering runtime stops reporting when it backs nothing", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          retired: { description: "going away", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    expect(Object.keys(core.agents).sort()).toEqual(["default", "retired"]);

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    const announced: string[][] = [];
    core.subscribe({
      onAgentsChanged: ({ agents }) => {
        announced.push(Object.keys(agents).sort());
      },
    });

    // The developer deleted `retired` and restarted. The runtime is back and
    // reports a NON-EMPTY list that omits it — credible evidence it is gone —
    // and `retired` holds no messages and has no thread bound to it, so
    // nothing the user can see is standing on it.
    bringRuntimePartWayBack(
      { default: { description: "assistant", capabilities: {} } },
      "2.0.0",
    );
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    await settle();

    expect(Object.keys(core.agents)).toEqual(["default"]);
    expect(core.getAgent("retired")).toBeUndefined();
    // Subscribers are told, rather than left holding the pre-outage set.
    expect(announced).toContainEqual(["default"]);
  });

  it("keeps an agent carrying messages that a recovering runtime no longer reports", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          helper: { description: "helper", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    const helper = core.getAgent("helper")!;
    helper.setMessages([
      { id: "assistant-1", role: "assistant", content: "still on screen" },
    ]);

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The list is non-empty, so condition 1 is satisfied and only condition 2
    // is holding `helper`: it is backing a conversation the user can see.
    bringRuntimePartWayBack(
      { default: { description: "assistant", capabilities: {} } },
      "2.0.0",
    );
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    await settle();

    expect(Object.keys(core.agents).sort()).toEqual(["default", "helper"]);
    expect(core.getAgent("helper")).toBe(helper);
    expect(helper.messages).toHaveLength(1);
  });

  it("keeps an agent carrying a bound thread and no messages", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          helper: { description: "helper", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    const helper = core.getAgent("helper")!;
    // What a binding does when it resolves a thread onto an agent
    // (`use-agent`, `CopilotChat`): an empty conversation the user is looking
    // at, and can submit into.
    helper.threadId = "thread-the-user-is-looking-at";

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    bringRuntimePartWayBack(
      { default: { description: "assistant", capabilities: {} } },
      "2.0.0",
    );
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    await settle();

    expect(Object.keys(core.agents).sort()).toEqual(["default", "helper"]);
    expect(core.getAgent("helper")).toBe(helper);
    expect(helper.threadId).toBe("thread-the-user-is-looking-at");
    expect(helper.messages).toHaveLength(0);
  });

  it("adds an agent a recovering runtime reports for the first time", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    bringRuntimePartWayBack(
      {
        default: { description: "assistant", capabilities: {} },
        added: { description: "brand new", capabilities: {} },
      },
      "2.0.0",
    );
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    expect(Object.keys(core.agents).sort()).toEqual(["added", "default"]);
  });

  it("still replaces the set outright on a deliberate configuration change, conversation state and all", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          retired: { description: "going away", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    expect(Object.keys(core.agents).sort()).toEqual(["default", "retired"]);

    // Conversation state is what holds an agent through RECOVERY. It must not
    // hold one through a configuration change: the developer pointed the
    // application at a different runtime, so the previous runtime's agents are
    // gone whatever they were carrying. This is the boundary the recovery
    // prune must not blur.
    const retired = core.getAgent("retired")!;
    retired.setMessages([
      { id: "assistant-1", role: "assistant", content: "on the old runtime" },
    ]);
    retired.threadId = "thread-on-the-old-runtime";

    // A configuration change re-asks the question deliberately, and the answer
    // can be trusted: this is where removal stays correct.
    altInfoHandler = async () => jsonResponse(DEFAULT_INFO);
    core.setRuntimeUrl(ALT_RUNTIME_URL);
    await waitForCondition(() => altInfoCalls === 1);
    await settle();

    expect(Object.keys(core.agents)).toEqual(["default"]);
    expect(core.getAgent("retired")).toBeUndefined();
  });

  it("does not revoke an in-flight run's state subscription when recovery changes nothing", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The runtime is back. The run's response arrives — which is what triggers
    // the recovery re-sync — and its stream is still open while that re-sync
    // runs. Re-notifying `onAgentsChanged` for an unchanged agent set makes
    // core re-subscribe the state manager per agent, and that re-subscription
    // REVOKES the subscription the in-flight run is reporting through.
    bringRuntimeUp();
    const stream = controllableSseStream();
    runHandler = async () => stream.response;

    const agent = core.getAgent("default") as AbstractAgent;
    agent.threadId = "thread-mid-run";
    const run = core.runAgent({ agent }).catch(() => undefined);

    stream.push({
      type: "RUN_STARTED",
      threadId: "thread-mid-run",
      runId: "r1",
    });
    stream.push({
      type: "STATE_SNAPSHOT",
      snapshot: { step: "before" },
    });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    stream.push({
      type: "STATE_SNAPSHOT",
      snapshot: { step: "after-recovery" },
    });
    stream.push({
      type: "RUN_FINISHED",
      threadId: "thread-mid-run",
      runId: "r1",
      result: { newMessages: [] },
    });
    stream.close();
    await run;
    await settle();

    expect(core.getStateByRun("default", "thread-mid-run", "r1")).toEqual({
      step: "after-recovery",
    });
  });

  it("does not revoke an in-flight run's state subscription when recovery adds an agent", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    const announced: string[][] = [];
    core.subscribe({
      onAgentsChanged: ({ agents }) => {
        announced.push(Object.keys(agents).sort());
      },
    });

    // Manual scenario 3: the developer restarted the runtime BECAUSE they added
    // an agent, so recovery has to announce the change — and announcing it is
    // what makes core re-subscribe the state manager for every agent. The run
    // whose response triggered the recovery is still streaming at that moment,
    // so re-subscribing must not revoke the subscription it reports through.
    bringRuntimeUp({
      version: "1.0.0",
      agents: {
        default: { description: "assistant", capabilities: {} },
        added: {
          description: "the one added while it was down",
          capabilities: {},
        },
      },
    });
    const stream = controllableSseStream();
    runHandler = async () => stream.response;

    const agent = core.getAgent("default") as AbstractAgent;
    agent.threadId = "thread-mid-run";
    const run = core.runAgent({ agent }).catch(() => undefined);

    stream.push({
      type: "RUN_STARTED",
      threadId: "thread-mid-run",
      runId: "r1",
    });
    stream.push({ type: "STATE_SNAPSHOT", snapshot: { step: "before" } });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    stream.push({
      type: "STATE_SNAPSHOT",
      snapshot: { step: "after-recovery" },
    });
    stream.push({
      type: "RUN_FINISHED",
      threadId: "thread-mid-run",
      runId: "r1",
      result: { newMessages: [] },
    });
    stream.close();
    await run;
    await settle();

    // The agent added while the runtime was down is here, and subscribers were
    // told about it rather than silently left with the pre-outage set.
    expect(Object.keys(core.agents).sort()).toEqual(["added", "default"]);
    expect(announced).toContainEqual(["added", "default"]);
    // And the run that proved the runtime was back kept reporting its state.
    expect(core.getStateByRun("default", "thread-mid-run", "r1")).toEqual({
      step: "after-recovery",
    });
  });

  it("does not revoke an in-flight run's state subscription when recovery prunes an agent", async () => {
    infoHandler = async () =>
      jsonResponse({
        version: "1.0.0",
        agents: {
          default: { description: "assistant", capabilities: {} },
          retired: { description: "going away", capabilities: {} },
        },
      });
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The sharpest version of the hazard the subscription fix closed. Pruning
    // CHANGES the agent set, so recovery announces it, so core re-subscribes
    // the state manager for every agent — and the run whose response triggered
    // the recovery is still streaming at that moment. If re-subscribing
    // revoked the live subscription, the run that proved the runtime was back
    // would lose its state for the rest of the stream.
    bringRuntimeUp({
      version: "1.0.0",
      agents: { default: { description: "assistant", capabilities: {} } },
    });
    const stream = controllableSseStream();
    runHandler = async () => stream.response;

    const agent = core.getAgent("default") as AbstractAgent;
    agent.threadId = "thread-mid-run";
    const run = core.runAgent({ agent }).catch(() => undefined);

    stream.push({
      type: "RUN_STARTED",
      threadId: "thread-mid-run",
      runId: "r1",
    });
    stream.push({ type: "STATE_SNAPSHOT", snapshot: { step: "before" } });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    stream.push({
      type: "STATE_SNAPSHOT",
      snapshot: { step: "after-recovery" },
    });
    stream.push({
      type: "RUN_FINISHED",
      threadId: "thread-mid-run",
      runId: "r1",
      result: { newMessages: [] },
    });
    stream.close();
    await run;
    await settle();

    // The prune really happened — this is the prune path, not the
    // unchanged-set path wearing its clothes.
    expect(Object.keys(core.agents)).toEqual(["default"]);
    // And the run kept reporting its state across it.
    expect(core.getStateByRun("default", "thread-mid-run", "r1")).toEqual({
      step: "after-recovery",
    });
  });

  // --- "did not answer" vs "answered, but refused" -------------------------

  it("reports a runtime that answered with a status differently from one that did not answer", async () => {
    const core = await bootConnectedCore();
    const errors: Array<{
      error: Error;
      code: CopilotKitCoreErrorCode;
      context?: Record<string, unknown>;
    }> = [];
    core.subscribe({
      onError: (event) => {
        errors.push(event as never);
      },
    });

    // An expired token: the runtime answered, and it refused.
    runHandler = async () => jsonResponse({ message: "nope" }, 401);
    infoHandler = async () => jsonResponse({ message: "token expired" }, 401);
    await runOnce(core).catch(() => undefined);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    const wiring = errors.find(
      (e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    );
    expect(wiring).toBeDefined();
    // The status stays the error state — the application cannot work either
    // way, and this matches the startup path — but calling a runtime that
    // ANSWERED "unreachable" sends the reader to check addresses, ports and
    // containers while the cause is a credential.
    expect(wiring?.context?.reason).toBe("answered");
    expect(wiring?.context?.runtimeStatus).toBe(401);
    expect(wiring?.error.message).toMatch(/401/);
    // Pinned on wording ONLY this branch can produce. The status code is no
    // use for that: it is interpolated from the underlying error message and
    // appears in both branches, so a test keyed on it passes against either.
    const warned = warn.mock.calls.flat().join(" ");
    expect(warned).toMatch(/is reachable but refused the request/i);
    expect(warned).not.toMatch(/did not answer the identification request/i);
    expect(warned).not.toMatch(/appears to be unreachable/i);
  });

  it("reports a runtime that did not answer as unreachable", async () => {
    const core = await bootConnectedCore();
    const errors: Array<{
      error: Error;
      code: CopilotKitCoreErrorCode;
      context?: Record<string, unknown>;
    }> = [];
    core.subscribe({
      onError: (event) => {
        errors.push(event as never);
      },
    });

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    const wiring = errors.find(
      (e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    );
    // Same status, same code — only the diagnosis differs.
    expect(wiring?.code).toBe(
      CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    );
    expect(wiring?.context?.reason).toBe("no-answer");
    expect(wiring?.context?.runtimeStatus).toBeUndefined();
    const warned = warn.mock.calls.flat().join(" ");
    expect(warned).toMatch(/did not answer the identification request/i);
    expect(warned).toMatch(/appears to be unreachable/i);
    expect(warned).not.toMatch(/is reachable but refused the request/i);
  });

  // --- both transports -----------------------------------------------------

  it("detects an outage and recovers the same way on the single-endpoint transport", async () => {
    const core = await bootConnectedCore({ runtimeTransport: "single" });
    expect(infoCalls).toBe(1);
    const agent = core.getAgent("default")!;

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);
    expect(core.getAgent("default")).toBe(agent);

    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(core.getAgent("default")).toBe(agent);
  });

  // --- thread routes: timeouts are not cancellations -----------------------

  it("treats a thread request its own timeout aborted as a failure, not a cancellation", async () => {
    vi.useFakeTimers();
    const core = createCore();
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    // The runtime hangs on the thread route and is gone for `/info` — the
    // Threads view against a container that is mid-rollout.
    threadListHandler = hangs;
    takeRuntimeDown();

    const store = ɵcreateThreadStore({ fetch: core.ɵruntimeFetch });
    store.start();
    store.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: "default",
    });

    // The store gives up on its own after its request timeout, and gives up by
    // aborting ITS OWN controller. That is a caller-initiated timeout, not a
    // user cancellation, and it must still be able to trigger a check.
    await vi.advanceTimersByTimeAsync(ɵTHREAD_REQUEST_TIMEOUT_MS + 1_000);
    await waitForStatusVirtual(
      core,
      CopilotKitCoreRuntimeConnectionStatus.Error,
    );

    store.stop();
  });

  it("still ignores a thread request cancelled by the caller going away", async () => {
    const core = await bootConnectedCore();
    expect(infoCalls).toBe(1);

    // The runtime is hanging and gone, exactly as in the timeout case above.
    threadListHandler = hangs;
    takeRuntimeDown();

    const store = ɵcreateThreadStore({ fetch: core.ɵruntimeFetch });
    store.start();
    store.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: "default",
    });
    await settle();

    // The difference is WHO gave up: here the caller tore the request down
    // (the view unmounted / the context changed), which is a cancellation and
    // must stay excluded. Telling caller-timeout apart from cancellation must
    // not weaken this.
    store.stop();
    await settle(200);

    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  it("does not check the runtime when a request the caller treats as non-fatal fails", async () => {
    const core = await bootConnectedCore();
    expect(infoCalls).toBe(1);

    // The realtime-metadata credentials route is explicitly non-fatal by
    // design, and older runtimes refuse it outright because they do not offer
    // the feature. Neither is news about the runtime's health.
    threadListHandler = async () =>
      jsonResponse({ threads: [], joinCode: "join-code" });
    threadSubscribeHandler = async () =>
      jsonResponse({ message: "not found" }, 404);

    const store = ɵcreateThreadStore({ fetch: core.ɵruntimeFetch });
    store.start();
    store.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: "default",
      wsUrl: "wss://realtime.example/socket",
    });

    await settle(200);

    expect(infoCalls).toBe(1);
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );

    store.stop();
  });

  it("lets a success on a request the caller declared non-critical restore the status", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    // The runtime is back. A non-critical request cannot trigger a check when
    // it FAILS — that is what the marker is for — but a success on it is the
    // same evidence of contact any other successful runtime request carries,
    // and the destination rule says it counts. Asymmetric on purpose, and
    // asserted because the asymmetry is easy to "tidy up" into a symmetry.
    bringRuntimeUp();
    const init: RuntimeRequestInit = {
      ɵruntimeRequest: { nonCritical: true },
    };
    const response = await core.ɵruntimeFetch(
      `${RUNTIME_URL}/threads?agentId=default`,
      init,
    );
    expect(response.ok).toBe(true);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
  });

  it("leaves the status alone when Stop is pressed against a runtime that has gone away", async () => {
    const core = await bootConnectedCore();
    const stream = controllableSseStream();
    runHandler = async () => stream.response;

    const agent = core.getAgent("default") as AbstractAgent;
    agent.threadId = "thread-stop";
    const run = core.runAgent({ agent }).catch(() => undefined);
    stream.push({
      type: "RUN_STARTED",
      threadId: "thread-stop",
      runId: "r1",
    });
    await settle();

    // The runtime goes away, and only then does the user press Stop. The stop
    // request fails — against a runtime that is gone it always will — and it is
    // deliberately off the seam so that cancelling can never turn the status
    // red. Bringing it on would make pressing Stop the one thing cancellation
    // is promised never to be: a reported outage.
    takeRuntimeDown();
    agent.abortRun();
    stream.close();
    await run;
    await settle(200);

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    expect(infoCalls).toBe(1);
  });

  it("counts the auto-detect `/info` a proxied agent issues to resolve its own mode", async () => {
    const core = createCore({ runtimeTransport: "auto" });
    // Registered before the handshake lands, so the proxy's runtime mode is
    // still "pending" AND its transport is still the unresolved "auto". That
    // pair is the only way into the agent's auto-detect branch, which the
    // registry's own resolved-transport path never reaches — and it is the
    // product default, so leaving it off the seam leaves the default broken.
    const { agent } = core.registerProxiedAgent({
      agentId: "proxy",
      runtimeAgentId: "default",
    });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);

    takeRuntimeDown();
    await core.runAgent({ agent }).catch(() => undefined);

    // The agent never gets as far as issuing its run: resolving its own mode is
    // what fails, so that request is the only evidence there is.
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
  });

  it("detects an outage and recovers the same way on the auto transport", async () => {
    const core = await bootConnectedCore({ runtimeTransport: "auto" });
    const agent = core.getAgent("default")!;
    const infoCallsAfterBoot = infoCalls;

    takeRuntimeDown();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(core.getAgent("default")).toBe(agent);

    bringRuntimeUp();
    await runOnce(core);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    expect(core.getAgent("default")).toBe(agent);
    expect(infoCalls).toBeGreaterThan(infoCallsAfterBoot);
  });
});
