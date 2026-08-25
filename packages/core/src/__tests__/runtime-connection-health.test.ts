/**
 * Runtime connection health (OSS-904).
 *
 * Before this, `runtimeConnectionStatus` was written once by the startup
 * `/info` handshake and never again: stop the dev server after the page loaded
 * and the status reported "connected" for the rest of the page's life, so
 * System Health, the launcher error signal and customer `onError` handlers all
 * reported healthy while nothing worked.
 *
 * The status now reports the outcome of the most recent ACTUAL contact with the
 * runtime. A failed runtime request asks the runtime once, directly, whether it
 * is there; a successful one puts the status back and re-syncs. Nothing else
 * moves it — no polling, no heartbeat, no retry loop.
 *
 * Request counting is a first-class assertion here rather than an incidental
 * one: several of the decisions are ABSENCES (no background traffic, one probe
 * per burst rather than one per failure, nothing at all while red), and an
 * absence is only testable by counting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import {
  CopilotKitCore,
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} from "../core";
import {
  RUNTIME_PROBE_COOLDOWN_MS,
  RUNTIME_PROBE_TIMEOUT_MS,
} from "../core/agent-registry";
import { waitForCondition } from "./test-utils";

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
 */
const TEN_MINUTES_MS = 10 * 60_000;

const encoder = new TextEncoder();

/** A minimal, well-formed SSE run response — a run that genuinely succeeds. */
function sseResponse(): Response {
  const events = [
    { type: "RUN_STARTED", threadId: "test-thread", runId: "test-run" },
    {
      type: "RUN_FINISHED",
      threadId: "test-thread",
      runId: "test-run",
      result: { newMessages: [] },
    },
  ];
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

type Handler = () => Promise<Response>;

/**
 * A runtime that ACCEPTS the connection and never answers — the second way a
 * server fails, and the one a stopped dev server does not model. A container
 * mid-rollout, a half-switched deploy and a dropped tunnel all look like this.
 */
const hangs: Handler = () => new Promise<Response>(() => {});

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
  let infoCalls: number;
  let runCalls: number;
  let altInfoCalls: number;
  let otherCalls: string[];

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    infoCalls = 0;
    runCalls = 0;
    altInfoCalls = 0;
    otherCalls = [];
    infoHandler = async () => jsonResponse(DEFAULT_INFO);
    runHandler = async () => sseResponse();
    altInfoHandler = async () => jsonResponse(DEFAULT_INFO);
    altRunHandler = async () => sseResponse();
    fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      const method = (init?.method ?? "GET").toUpperCase();

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
          return infoHandler();
        }
        runCalls += 1;
        return runHandler();
      }

      if (target === INFO_URL) {
        infoCalls += 1;
        return infoHandler();
      }
      if (target.startsWith(`${RUNTIME_URL}/agent/`)) {
        runCalls += 1;
        return runHandler();
      }
      if (target === `${ALT_RUNTIME_URL}/info`) {
        altInfoCalls += 1;
        return altInfoHandler();
      }
      if (target.startsWith(`${ALT_RUNTIME_URL}/agent/`)) {
        return altRunHandler();
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

  it("re-syncs on recovery: an agent added appears, one removed disappears, the version refreshes", async () => {
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

  // --- 10: the cooldown ---------------------------------------------------

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
    // Past the cooldown window, so a per-failure probe would have shown up.
    await settle(RUNTIME_PROBE_COOLDOWN_MS + 500);

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
});
