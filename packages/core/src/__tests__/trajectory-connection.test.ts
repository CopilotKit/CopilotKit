import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import type { CopilotKitCoreConfig } from "../core";
import type { TrajectoryEvent } from "@copilotkit/learning";

// Exercise real Core and capture. Only the remote services are controlled here.
const transport = vi.hoisted(() => {
  class Push {
    callbacks = new Map<string, (payload: unknown) => void>();
    receive(status: string, callback: (payload: unknown) => void) {
      this.callbacks.set(status, callback);
      return this;
    }
    reply(status: string, payload: unknown = {}) {
      this.callbacks.get(status)?.(payload);
    }
  }
  class Channel {
    state = "joining";
    joined = new Push();
    left = false;
    callbacks = new Map<string, () => void>();
    pushes: Array<{ event: string; payload: TrajectoryEvent; push: Push }> = [];
    constructor(
      public topic: string,
      public params: unknown,
    ) {}
    join() {
      return this.joined;
    }
    leave() {
      this.left = true;
      this.state = "closed";
      return new Push();
    }
    onError(callback: () => void) {
      this.callbacks.set("phx_error", callback);
      return 1;
    }
    onClose(callback: () => void) {
      this.callbacks.set("phx_close", callback);
      return 2;
    }
    off(event: string) {
      this.callbacks.delete(event);
    }
    push(event: string, payload: TrajectoryEvent) {
      const push = new Push();
      this.pushes.push({ event, payload, push });
      return push;
    }
  }
  const sockets: Socket[] = [];
  class Socket {
    connected = false;
    disconnected = false;
    channels: Channel[] = [];
    callbacks = new Map<string, () => void>();
    constructor(
      public url: string,
      public options: unknown,
    ) {
      sockets.push(this);
    }
    connect() {
      this.connected = true;
    }
    disconnect() {
      this.disconnected = true;
      this.connected = false;
    }
    isConnected() {
      return this.connected;
    }
    onError(callback: () => void) {
      this.callbacks.set("error", callback);
      return "error";
    }
    onClose(callback: () => void) {
      this.callbacks.set("close", callback);
      return "close";
    }
    off(refs: string[]) {
      for (const ref of refs) this.callbacks.delete(ref);
    }
    channel(topic: string, params: unknown) {
      const channel = new Channel(topic, params);
      this.channels.push(channel);
      return channel;
    }
  }
  return { Socket, sockets };
});
vi.mock("phoenix", () => ({ Socket: transport.Socket }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const requests: Array<{
  url: RequestInfo | URL;
  init?: RequestInit;
  response: ReturnType<typeof deferred<Response>>;
}> = [];
const cores: CopilotKitCore[] = [];
const onError = vi.fn();
const grant = (token = "single-use-1") => ({
  joinToken: token,
  realtime: {
    clientUrl: "wss://gateway.invalid/socket",
    topic: "opaque:project:scope:capture",
  },
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
async function flush() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
function makeCore(overrides: Partial<CopilotKitCoreConfig> = {}) {
  const core = new CopilotKitCore({
    runtimeUrl: "/api/copilotkit/",
    runtimeTransport: "single",
    deferInitialConnection: true,
    headers: { Authorization: "Bearer app-session", "X-App": "test" },
    credentials: "include",
    learning: {
      routes: ["/products/:id"],
      capture: { clicks: false, navigation: false },
      onError,
    },
    ...overrides,
  });
  cores.push(core);
  return core;
}
async function authorize(index = 0, token = "single-use-1") {
  requests[index]!.response.resolve(response(grant(token)));
  await flush();
  return transport.sockets.at(-1)!.channels[0]!;
}
function join(index = 0) {
  const channel = transport.sockets[index]!.channels[0]!;
  channel.state = "joined";
  channel.joined.reply("ok");
  return channel;
}
function persist(channel: ReturnType<typeof join>) {
  for (const { push } of channel.pushes)
    push.reply("ok", { status: "persisted", eventId: "stored-id" });
}
async function start(core = makeCore()) {
  const result = core.startTrajectory({ trajectoryId: "trajectory-1" });
  await authorize();
  const channel = join();
  expect(await result).toEqual({
    status: "started",
    trajectoryId: "trajectory-1",
  });
  persist(channel);
  return { core, channel };
}

beforeEach(() => {
  vi.useFakeTimers();
  requests.length = 0;
  transport.sockets.length = 0;
  onError.mockReset();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "location",
    new URL("https://app.invalid/products/alice?private=secret"),
  );
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const pending = deferred<Response>();
      requests.push({ url, init, response: pending });
      return pending.promise;
    }),
  );
});
afterEach(() => {
  for (const core of cores.splice(0)) core.stopTrajectory();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Core trajectory connection", () => {
  it("gates capture on auth and join, preserves the exact endpoint and sends plain threadless AG-UI", async () => {
    const core = makeCore();
    core.registerOpenThread({ agentId: "default", threadId: "unrelated-chat" });
    const active = vi.fn();
    core.subscribe({ onTrajectoryChanged: active });
    const pending = core.startTrajectory({ trajectoryId: "trajectory-1" });
    expect(core.trajectoryId).toBeNull();
    core.emitTrajectoryEvent("app.beforeAuth", {});
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("/api/copilotkit/");
    expect(requests[0]!.init).toMatchObject({
      method: "POST",
      credentials: "include",
      redirect: "error",
      headers: {
        Authorization: "Bearer app-session",
        "X-App": "test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        method: "trajectory/connect",
        params: { trajectoryId: "trajectory-1" },
        body: {},
      }),
    });
    const channel = await authorize();
    core.emitTrajectoryEvent("app.beforeJoin", {});
    expect(channel.pushes).toEqual([]);
    expect(transport.sockets[0]!.url).toBe(grant().realtime.clientUrl);
    expect(transport.sockets[0]!.options).toMatchObject({
      params: { join_token: "single-use-1" },
    });
    expect(channel.topic).toBe(grant().realtime.topic);
    expect(channel.params).toEqual({});
    join();
    expect(await pending).toEqual({
      status: "started",
      trajectoryId: "trajectory-1",
    });
    core.emitTrajectoryEvent("app.json", [
      null,
      true,
      7,
      "value",
      { nested: [] },
    ]);
    expect(
      channel.pushes.map(({ event, payload }) => ({ event, payload })),
    ).toEqual([
      {
        event: "trajectory.event",
        payload: {
          type: "CUSTOM",
          name: "page",
          timestamp: expect.any(Number),
          value: { route: "/products/:id" },
        },
      },
      {
        event: "trajectory.event",
        payload: {
          type: "CUSTOM",
          name: "app.json",
          timestamp: expect.any(Number),
          value: [null, true, 7, "value", { nested: [] }],
        },
      },
    ]);
    persist(channel);
    expect(active).toHaveBeenCalledTimes(1);
    core.stopTrajectory();
    expect(active).toHaveBeenCalledTimes(2);
    expect(core.trajectoryId).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("uses the scoped REST path when REST was selected", async () => {
    const core = makeCore({ runtimeTransport: "rest" });
    const pending = core.startTrajectory({ trajectoryId: "id/needs escaping" });
    expect(requests[0]!.url).toBe(
      "/api/copilotkit/trajectory/id%2Fneeds%20escaping/connect",
    );
    expect(requests[0]!.init?.body).toBe("{}");
    await authorize();
    join();
    expect((await pending).status).toBe("started");
  });

  it("creates one UUID and shares concurrent starts without making duplicate grants", async () => {
    const core = makeCore();
    const pending = core.startTrajectory();
    expect(core.startTrajectory()).toBe(pending);
    const id = JSON.parse(requests[0]!.init!.body as string).params
      .trajectoryId;
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await authorize();
    join();
    expect(await pending).toEqual({ status: "started", trajectoryId: id });
    expect(core.startTrajectory({ trajectoryId: id })).toBe(pending);
    expect(requests).toHaveLength(1);
  });

  it("cancels pending auth promptly and ignores a late grant even when fetch ignores abort", async () => {
    const core = makeCore();
    const pending = core.startTrajectory();
    core.stopTrajectory();
    expect(await pending).toEqual({ status: "error", code: "CANCELLED" });
    expect(requests[0]!.init?.signal?.aborted).toBe(true);
    requests[0]!.response.resolve(response(grant()));
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.sockets).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("cancels a pending join and ignores its late success", async () => {
    const core = makeCore();
    const pending = core.startTrajectory();
    const channel = await authorize();
    core.stopTrajectory();
    expect(await pending).toEqual({ status: "error", code: "CANCELLED" });
    expect(channel.left).toBe(true);
    expect(transport.sockets[0]!.disconnected).toBe(true);
    join();
    core.emitTrajectoryEvent("app.late", {});
    expect(channel.pushes).toEqual([]);
    expect(core.trajectoryId).toBeNull();
  });

  it("supersedes an old pending start without allowing old auth to stop the new session", async () => {
    const core = makeCore();
    const first = core.startTrajectory({ trajectoryId: "old" });
    const second = core.startTrajectory({ trajectoryId: "new" });
    expect(await first).toEqual({ status: "error", code: "CANCELLED" });
    requests[0]!.response.resolve(response(grant("old-token")));
    await flush();
    expect(transport.sockets).toEqual([]);
    await authorize(1, "new-token");
    join();
    expect(await second).toEqual({ status: "started", trajectoryId: "new" });
    expect(core.trajectoryId).toBe("new");
  });

  it.each([
    [
      401,
      { code: "IDENTITY_REQUIRED", message: "private detail" },
      "IDENTITY_REQUIRED",
    ],
    [502, { code: "bad private detail" }, "CONNECTION_FAILED"],
    [200, { joinToken: "", realtime: {} }, "INVALID_GRANT"],
  ])(
    "fails closed for auth response %s without capturing or leaking server details",
    async (status, body, code) => {
      const core = makeCore();
      const pending = core.startTrajectory();
      requests[0]!.response.resolve(response(body, status));
      expect(await pending).toEqual({ status: "error", code });
      expect(core.trajectoryId).toBeNull();
      expect(transport.sockets).toEqual([]);
      expect(onError).toHaveBeenCalledWith({
        code,
        message: `Trajectory capture: ${code}.`,
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(requests).toHaveLength(1);
    },
  );

  it("bounds uncooperative auth and network failure without any browser capture", async () => {
    const core = makeCore();
    const pending = core.startTrajectory();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({
      status: "error",
      code: "CONNECTION_TIMEOUT",
    });
    expect(requests[0]!.init?.signal?.aborted).toBe(true);
    const next = core.startTrajectory();
    requests[1]!.response.reject(new Error("private network details"));
    expect(await next).toEqual({ status: "error", code: "CONNECTION_FAILED" });
    expect(transport.sockets).toEqual([]);
  });

  it.each(["error", "timeout"])(
    "cleans up a refused or timed-out join (%s)",
    async (status) => {
      const core = makeCore();
      const pending = core.startTrajectory();
      const channel = await authorize();
      channel.joined.reply(status);
      expect(await pending).toEqual({
        status: "error",
        code: status === "error" ? "JOIN_FAILED" : "CONNECTION_TIMEOUT",
      });
      expect(channel.left).toBe(true);
      expect(transport.sockets[0]!.disconnected).toBe(true);
      expect(channel.pushes).toEqual([]);
    },
  );

  it("pauses on channel loss, obtains a fresh token, and awaits the new join without replaying events", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.uncertain", { id: 1 });
    const lost = channel.callbacks.get("phx_error")!;
    lost();
    expect(core.trajectoryId).toBeNull();
    expect(channel.left).toBe(true);
    expect(transport.sockets[0]!.disconnected).toBe(true);
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "PERSISTENCE_UNKNOWN",
      "CONNECTION_LOST",
    ]);
    core.emitTrajectoryEvent("app.offline", {});
    const reconnectStart = core.startTrajectory({
      trajectoryId: "trajectory-1",
    });
    const settled = vi.fn();
    void reconnectStart.then(settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toHaveLength(2);
    await authorize(1, "single-use-2");
    expect(transport.sockets[1]!.options).toMatchObject({
      params: { join_token: "single-use-2" },
    });
    expect(settled).not.toHaveBeenCalled();
    const next = join(1);
    expect(await reconnectStart).toEqual({
      status: "started",
      trajectoryId: "trajectory-1",
    });
    lost(); // A delayed callback from the discarded socket cannot kill its successor.
    expect(core.trajectoryId).toBe("trajectory-1");
    expect(next.pushes.map(({ payload }) => payload.name)).toEqual(["page"]);
    expect(channel.pushes.map(({ payload }) => payload.name)).toEqual([
      "page",
      "app.uncertain",
    ]);
    persist(next);
  });

  it("stops recovery on an HTML authorization failure instead of retrying terminal HTTP status", async () => {
    const { core, channel } = await start();
    channel.callbacks.get("phx_close")!();
    const recovered = core.startTrajectory();
    await vi.advanceTimersByTimeAsync(1_000);
    requests[1]!.response.resolve(
      new Response("<html>Forbidden</html>", { status: 403 }),
    );
    expect(await recovered).toEqual({
      status: "error",
      code: "CONNECTION_FAILED",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toHaveLength(2);
    expect(transport.sockets).toHaveLength(1);
    expect(core.trajectoryId).toBeNull();
  });

  it("waits for browser online before minting a fresh grant and stop prevents resurrection", async () => {
    const { core } = await start();
    window.dispatchEvent(new Event("offline"));
    core.emitTrajectoryEvent("app.offline", {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toHaveLength(1);
    window.dispatchEvent(new Event("online"));
    expect(requests).toHaveLength(2);
    const pending = core.startTrajectory();
    core.stopTrajectory();
    expect(await pending).toEqual({ status: "error", code: "CANCELLED" });
    requests[1]!.response.resolve(response(grant("too-late")));
    await flush();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.sockets).toHaveLength(1);
    expect(requests).toHaveLength(2);
  });

  it("stops a scheduled reconnect before it can request credentials", async () => {
    const { core, channel } = await start();
    channel.callbacks.get("phx_close")!();
    core.stopTrajectory();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requests).toHaveLength(1);
  });

  it("drops a send if the socket is disconnected before its loss callback arrives", async () => {
    const { core, channel } = await start();
    transport.sockets[0]!.connected = false;
    core.emitTrajectoryEvent("app.wouldBuffer", {});
    expect(channel.pushes).toHaveLength(1);
    expect(core.trajectoryId).toBeNull();
  });

  it.each([
    ["error", { code: "PERSISTENCE_FAILED" }, "PERSISTENCE_FAILED"],
    ["error", { code: "INVALID_EVENT" }, "INVALID_EVENT"],
    ["error", { code: "EVENT_TOO_LARGE" }, "EVENT_TOO_LARGE"],
    ["error", { code: "PERSISTENCE_UNKNOWN" }, "PERSISTENCE_UNKNOWN"],
    ["error", {}, "PERSISTENCE_UNKNOWN"],
    ["error", { code: "UNRELATED_ERROR" }, "PERSISTENCE_UNKNOWN"],
    [
      "ok",
      { status: "accepted", eventId: "not-confirmed" },
      "PERSISTENCE_UNKNOWN",
    ],
    ["ok", { status: "persisted", eventId: "" }, "PERSISTENCE_UNKNOWN"],
    ["timeout", {}, "PERSISTENCE_UNKNOWN"],
  ])(
    "reports %s acknowledgements truthfully and never retries the event",
    async (status, acknowledgement, code) => {
      const { core, channel } = await start();
      core.emitTrajectoryEvent("app.once", 42);
      channel.pushes[1]!.push.reply(status, acknowledgement);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onError.mock.calls.map(([error]) => error.code)).toEqual([code]);
      expect(channel.pushes.map(({ payload }) => payload.name)).toEqual([
        "page",
        "app.once",
      ]);
      expect(requests).toHaveLength(1);
    },
  );

  it("bounds missing acks and reports uncertain in-flight sends on explicit stop", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.noAck", true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalledTimes(1);
    core.emitTrajectoryEvent("app.stopping", null);
    core.stopTrajectory();
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "PERSISTENCE_UNKNOWN",
      "PERSISTENCE_UNKNOWN",
    ]);
    core.emitTrajectoryEvent("app.stopped", {});
    channel.pushes[2]!.push.reply("ok", {
      status: "persisted",
      eventId: "late",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.pushes).toHaveLength(3);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("contains host error callback exceptions and applies next-start configuration", async () => {
    const { core, channel } = await start();
    core.setLearningConfig({
      capture: { clicks: false, navigation: false },
      beforeSend: () => null,
      onError: () => {
        throw new Error("host callback");
      },
    });
    core.emitTrajectoryEvent("app.current", "still captured");
    expect(channel.pushes.at(-1)!.payload.value).toBe("still captured");
    persist(channel);
    core.stopTrajectory();
    const pending = core.startTrajectory({ trajectoryId: "next" });
    await authorize(1, "next-token");
    const next = join(1);
    expect((await pending).status).toBe("started");
    core.emitTrajectoryEvent("app.filtered", {});
    expect(next.pushes).toEqual([]);
    next.callbacks.get("phx_error")!();
    expect(core.trajectoryId).toBeNull();
  });

  it("fails a browser capture setup error instead of reporting capture as started", async () => {
    const core = makeCore({ learning: { onError } });
    const pending = core.startTrajectory();
    await authorize();
    // Node fixture deliberately has no document/history for installing DOM hooks.
    join();
    expect(await pending).toEqual({ status: "error", code: "CAPTURE_FAILED" });
    expect(core.trajectoryId).toBeNull();
  });
});
