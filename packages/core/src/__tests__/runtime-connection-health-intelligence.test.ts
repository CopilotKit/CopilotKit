/**
 * Runtime connection health in Intelligence mode (OSS-904).
 *
 * The destination rule is "a request counts if it goes to the runtime, whatever
 * issued it". Intelligence mode is the case that rule was chosen for: its chat
 * traffic never touches the HTTP run route — it asks the RUNTIME over HTTP for
 * realtime join credentials and then talks to the realtime gateway over a
 * websocket. A rule keyed on the caller rather than on the destination would
 * have left every Intelligence-mode application unable to notice a runtime that
 * went away.
 *
 * The other half is an exclusion, and it matters just as much: the realtime
 * endpoint is a SEPARATE service with its own address and its own reconnection
 * behaviour, and it can fail while the runtime is perfectly healthy. Reporting
 * "runtime unreachable" about a working runtime is a false diagnosis, and a
 * false diagnosis costs more debugging time than no signal at all.
 *
 * Lives in its own file because it has to mock `phoenix` module-wide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { RUNTIME_MODE_INTELLIGENCE } from "@copilotkit/shared";
import type { MockChannel, MockSocket as MockSocketType } from "./test-utils";
import { MockSocket, waitForCondition } from "./test-utils";

vi.mock("phoenix", () => ({
  Socket: MockSocket,
}));

// Must come after vi.mock so phoenix is mocked when the modules load.
const {
  CopilotKitCore,
  CopilotKitCoreErrorCode,
  CopilotKitCoreRuntimeConnectionStatus,
} = await import("../core");
type CopilotKitCoreInstance = InstanceType<typeof CopilotKitCore>;

const RUNTIME_URL = "https://runtime.example/api";
const INFO_URL = `${RUNTIME_URL}/info`;
/** The Intelligence join request — a RUNTIME address, so it counts. */
const JOIN_RUN_URL = `${RUNTIME_URL}/agent/default/run`;
/** The realtime gateway — a DIFFERENT service, so it must never count. */
const REALTIME_URL = "wss://realtime.example/client";

const INTELLIGENCE_INFO = {
  version: "1.0.0",
  agents: { default: { description: "assistant", capabilities: {} } },
  mode: RUNTIME_MODE_INTELLIGENCE,
  intelligence: { wsUrl: REALTIME_URL },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function joinCredentials(threadId: string) {
  return {
    threadId,
    runId: "gateway-run-1",
    joinToken: "join-token-1",
    realtime: { clientUrl: REALTIME_URL, topic: `thread:${threadId}` },
  };
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

type Handler = () => Promise<Response>;

/** Reach into the proxy for its lazily-created Intelligence delegate. */
function getDelegate(agent: AbstractAgent): AbstractAgent | undefined {
  return (agent as unknown as { delegate?: AbstractAgent }).delegate;
}

function getSocket(delegate: AbstractAgent | undefined): MockSocketType | null {
  return (
    (delegate as unknown as { socket?: MockSocketType | null } | undefined)
      ?.socket ?? null
  );
}

function getChannel(delegate: AbstractAgent | undefined): MockChannel | null {
  return (
    (delegate as unknown as { activeChannel?: MockChannel | null } | undefined)
      ?.activeChannel ?? null
  );
}

describe("runtime connection health — Intelligence mode (OSS-904)", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  let fetchMock: ReturnType<typeof vi.fn>;
  /** Answers `/info` — the startup handshake AND the confirmation probe. */
  let infoHandler: Handler;
  /** Answers the Intelligence join request on the runtime. */
  let joinHandler: (body: unknown) => Promise<Response>;
  let infoCalls: number;
  let joinCalls: number;
  /** Every address the instrumented fetch was pointed at. */
  let requestedUrls: string[];

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    infoCalls = 0;
    joinCalls = 0;
    requestedUrls = [];
    infoHandler = async () => jsonResponse(INTELLIGENCE_INFO);
    joinHandler = async (body) =>
      jsonResponse(
        joinCredentials(
          (body as { threadId?: string } | undefined)?.threadId ?? "thread-1",
        ),
      );
    fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      requestedUrls.push(target);
      // Single-endpoint transport asks for `/info` as a POST envelope against
      // the runtime root instead of a GET on `/info`.
      if (target === RUNTIME_URL) {
        infoCalls += 1;
        return infoHandler();
      }
      if (target === INFO_URL) {
        infoCalls += 1;
        return infoHandler();
      }
      if (target === JOIN_RUN_URL) {
        joinCalls += 1;
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        return joinHandler(body);
      }
      throw new Error(`Unexpected fetch: ${target}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  /** A core connected to a healthy Intelligence runtime — page load. */
  async function bootConnectedCore(
    runtimeTransport: "rest" | "single" = "rest",
  ): Promise<CopilotKitCoreInstance> {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport,
    });
    await waitForCondition(
      () =>
        core.runtimeConnectionStatus ===
        CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    return core;
  }

  /** The runtime is gone: neither `/info` nor the join request answers. */
  function takeRuntimeDown(): void {
    infoHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
    joinHandler = async () => {
      throw new TypeError("Failed to fetch");
    };
  }

  const waitForStatus = (
    core: CopilotKitCoreInstance,
    status: (typeof CopilotKitCoreRuntimeConnectionStatus)[keyof typeof CopilotKitCoreRuntimeConnectionStatus],
  ) => waitForCondition(() => core.runtimeConnectionStatus === status);

  /**
   * Start a run and wait until the delegate has a live socket and channel —
   * i.e. the join request succeeded and the realtime connection is up.
   */
  async function startRun(
    core: CopilotKitCoreInstance,
    agent: AbstractAgent,
  ): Promise<{ promise: Promise<unknown>; delegate: AbstractAgent }> {
    const promise = core.runAgent({ agent });
    await flushAsyncWork();
    let delegate = getDelegate(agent);
    for (
      let i = 0;
      i < 8 && !(getSocket(delegate) && getChannel(delegate));
      i += 1
    ) {
      await flushAsyncWork();
      delegate = getDelegate(agent);
    }
    return { promise, delegate: delegate! };
  }

  /** Let the gateway finish the run so nothing is left pending. */
  async function finishRun(
    delegate: AbstractAgent,
    promise: Promise<unknown>,
  ): Promise<void> {
    const channel = getChannel(delegate)!;
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: "RUN_STARTED",
      threadId: delegate.threadId,
      runId: "gateway-run-1",
    } as unknown as BaseEvent);
    channel.serverPush("ag_ui_event", {
      type: "RUN_FINISHED",
      threadId: delegate.threadId,
      runId: "gateway-run-1",
    } as unknown as BaseEvent);
    await promise;
  }

  // --- the gap this file exists to close ----------------------------------

  it("flips the status when the Intelligence join request to the runtime fails", async () => {
    const core = await bootConnectedCore();
    const statuses: unknown[] = [];
    core.subscribe({
      onRuntimeConnectionStatusChanged: ({ status }) => {
        statuses.push(status);
      },
    });
    expect(infoCalls).toBe(1);

    takeRuntimeDown();
    await core.runAgent({ agent: core.getAgent("default") as AbstractAgent });

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    // The join request is what failed, and it is what asked: startup + one
    // confirmation probe, nothing more.
    expect(infoCalls).toBe(2);
    expect(joinCalls).toBe(1);
    expect(statuses).toEqual([CopilotKitCoreRuntimeConnectionStatus.Error]);
  });

  it("emits the wiring error code for an Intelligence join failure, alongside the run failure", async () => {
    const core = await bootConnectedCore();
    const errors: Array<{
      code: unknown;
      context?: Record<string, unknown>;
    }> = [];
    core.subscribe({
      onError: (event) => {
        errors.push(event as never);
      },
    });

    takeRuntimeDown();
    await core.runAgent({ agent: core.getAgent("default") as AbstractAgent });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    const wiring = errors.find(
      (e) => e.code === CopilotKitCoreErrorCode.RUNTIME_INFO_FETCH_FAILED,
    );
    expect(wiring).toBeDefined();
    expect(wiring?.context?.runtimeUrl).toBe(RUNTIME_URL);
    expect(
      errors.some((e) => e.code === CopilotKitCoreErrorCode.AGENT_RUN_FAILED),
    ).toBe(true);
  });

  it("returns to connected once the Intelligence join request succeeds again", async () => {
    const core = await bootConnectedCore();
    takeRuntimeDown();
    await core.runAgent({ agent: core.getAgent("default") as AbstractAgent });
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);

    infoHandler = async () => jsonResponse(INTELLIGENCE_INFO);
    joinHandler = async (body) =>
      jsonResponse(
        joinCredentials(
          (body as { threadId?: string } | undefined)?.threadId ?? "thread-1",
        ),
      );

    const agent = core.getAgent("default") as AbstractAgent;
    const { promise, delegate } = await startRun(core, agent);
    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Connected);
    await finishRun(delegate, promise);

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  // --- the exclusion the PRD is emphatic about ----------------------------

  it("leaves the status alone when the realtime endpoint fails and the runtime is healthy", async () => {
    const core = await bootConnectedCore();
    const agent = core.getAgent("default") as AbstractAgent;
    const { promise, delegate } = await startRun(core, agent);

    const socket = getSocket(delegate)!;
    const channel = getChannel(delegate)!;
    expect(socket.url).toBe(REALTIME_URL);
    channel.triggerJoin("ok");

    const callsBeforeOutage = fetchMock.mock.calls.length;

    // Break ONLY the realtime endpoint: the websocket transport errors and the
    // channel crashes server-side. The runtime itself keeps answering.
    socket.triggerError(new Error("network failure"));
    channel.triggerError("server crash");
    await settle();

    // A false "runtime unreachable" here would send the reader off to debug a
    // runtime that is working. The chat not working is a separate, filed gap.
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    // Not even a probe: the failure never reached the seam at all.
    expect(infoCalls).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeOutage);

    await finishRun(delegate, promise);
  });

  it("never routes the realtime endpoint through the instrumented fetch", async () => {
    const core = await bootConnectedCore();
    const agent = core.getAgent("default") as AbstractAgent;
    const { promise, delegate } = await startRun(core, agent);

    // The socket is opened by the phoenix client against the gateway address —
    // it is not, and must never become, a request the status observes.
    expect(getSocket(delegate)!.url).toBe(REALTIME_URL);
    expect(requestedUrls).toEqual([INFO_URL, JOIN_RUN_URL]);
    expect(requestedUrls.some((url) => url.startsWith("ws"))).toBe(false);

    await finishRun(delegate, promise);
  });

  // --- the delegate really gets the instrumented fetch, clones included ----

  it("a clone taken before the delegate exists still reports its join failure", async () => {
    const core = await bootConnectedCore();
    // Cloned straight off the registry instance, so the clone has to mint its
    // own delegate from the `fetch` the clone carried over.
    const cloned = (core.getAgent("default") as AbstractAgent).clone();
    expect(getDelegate(cloned)).toBeUndefined();

    takeRuntimeDown();
    await core.runAgent({ agent: cloned });

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);
    expect(joinCalls).toBe(1);
  });

  it("a clone taken after the delegate exists still reports its join failure", async () => {
    const core = await bootConnectedCore();
    const agent = core.getAgent("default") as AbstractAgent;

    // One healthy run first, so the proxy has a cached delegate for `clone()`
    // to copy — the per-thread clone path the chat uses.
    const { promise, delegate } = await startRun(core, agent);
    await finishRun(delegate, promise);
    expect(getDelegate(agent)).toBeDefined();

    const cloned = agent.clone();
    expect(getDelegate(cloned)).toBeDefined();
    expect(getDelegate(cloned)).not.toBe(getDelegate(agent));

    takeRuntimeDown();
    await core.runAgent({ agent: cloned });

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);
  });
  it("detects an unreachable runtime the same way when `/info` was negotiated over the single-endpoint transport", async () => {
    // Both suites otherwise pin "rest" while the product default is "auto", so
    // neither transport was covered other than by accident.
    const core = await bootConnectedCore("single");
    expect(infoCalls).toBe(1);
    const agent = core.getAgent("default") as AbstractAgent;

    takeRuntimeDown();
    await core.runAgent({ agent }).catch(() => undefined);

    await waitForStatus(core, CopilotKitCoreRuntimeConnectionStatus.Error);
    expect(infoCalls).toBe(2);
    // The conversation survives the transition here too.
    expect(core.getAgent("default")).toBe(agent);
  });
});
