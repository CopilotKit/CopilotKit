import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import type { CopilotKitCoreConfig } from "../core";
import type { JsonValue, TrajectoryEvent } from "@copilotkit/learning";

type Batch = {
  events: TrajectoryEvent<Record<string, JsonValue>>[];
  dropped: number;
};

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
    pushes: Array<{ event: string; payload: Batch; push: Push }> = [];
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
    push(event: string, payload: Batch) {
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
      capture: {
        clicks: false,
        navigation: false,
        inputs: false,
        network: false,
      },
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
function names(channel: ReturnType<typeof join>) {
  return channel.pushes.flatMap(({ payload }) =>
    payload.events.map((event) => event.name),
  );
}
function persist(channel: ReturnType<typeof join>) {
  for (const { push, payload } of channel.pushes.slice())
    push.reply("ok", {
      highestSeq: payload.events.at(-1)?.value.seq ?? null,
      accepted: payload.events.length,
      rejected: 0,
    });
}
async function start(core = makeCore()) {
  const result = core.startTrajectory({ trajectoryId: "trajectory-1" });
  await authorize();
  const channel = join();
  expect(await result).toEqual({
    status: "started",
    trajectoryId: "trajectory-1",
  });
  await vi.advanceTimersByTimeAsync(2_000);
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
  vi.stubGlobal("document", { title: "Synthetic app", referrer: "" });
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
    expect(channel.pushes).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(
      channel.pushes.map(({ event, payload }) => ({ event, payload })),
    ).toEqual([
      {
        event: "events",
        payload: {
          dropped: 0,
          events: [
            {
              type: "CUSTOM",
              name: "page",
              timestamp: expect.any(Number),
              value: {
                route: "/products/alice",
                url: "https://app.invalid/products/alice?private=secret",
                title: "Synthetic app",
                referrer: "",
                seq: 0,
              },
            },
            {
              type: "CUSTOM",
              name: "app.json",
              timestamp: expect.any(Number),
              value: { data: [null, true, 7, "value", { nested: [] }], seq: 1 },
            },
          ],
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

  it("starts network capture after join and excludes SDK transport and explicit app URLs", async () => {
    const originalFetch = fetch;
    const core = makeCore({
      learning: {
        capture: { clicks: false, navigation: false, inputs: false },
        ignoreUrls: ["https://private.invalid/"],
        onError,
      },
    });
    const pending = core.startTrajectory({ trajectoryId: "trajectory-1" });
    expect(fetch).toBe(originalFetch);
    await authorize();
    expect(fetch).toBe(originalFetch);
    const channel = join();
    expect((await pending).status).toBe("started");
    expect(fetch).not.toBe(originalFetch);
    await vi.advanceTimersByTimeAsync(2_000);
    persist(channel);

    const sendRequest = async (url: string) => {
      const promise = fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          Authorization: "visible-value",
        },
        body: "request-body",
      });
      const reply = new Response("response-body", {
        headers: {
          "Content-Type": "text/plain",
          "X-App-Header": "visible-response",
        },
      });
      const clone = vi.spyOn(reply, "clone");
      requests.at(-1)!.response.resolve(reply);
      expect(await promise).toBe(reply);
      await flush();
      return clone;
    };
    for (const url of [
      "/api/copilotkit",
      "/api/copilotkit/",
      "https://telemetry.copilotkit.ai/events",
      "https://cdn.copilotkit.ai/announcements",
      "https://private.invalid/checkout",
    ]) {
      const clone = await sendRequest(url);
      expect(clone).not.toHaveBeenCalled();
    }

    const url = "https://app.invalid/api/orders?customer=alice#confirmation";
    const clone = await sendRequest(url);
    expect(clone).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    const events = channel.pushes.flatMap(({ payload }) => payload.events);
    expect(events.map((event) => event.name)).toEqual(["page", "network"]);
    expect(events[1]!.value).toMatchObject({
      url,
      route: "/api/orders",
      method: "POST",
      request: {
        headers: { authorization: "[redacted]" },
        body: { status: "complete", text: "request-body" },
      },
      response: {
        headers: { "x-app-header": "visible-response" },
        body: { status: "complete", text: "response-body" },
      },
    });
    expect(onError).not.toHaveBeenCalled();
    persist(channel);
    core.stopTrajectory();
    expect(fetch).toBe(originalFetch);
  });

  it.each([{}, { addEventListener: null, removeEventListener: false }])(
    "supports an RN-like window without browser connectivity listeners",
    async (nativeWindow) => {
      vi.stubGlobal("window", nativeWindow);
      const { core, channel } = await start();
      expect(core.trajectoryId).toBe("trajectory-1");
      expect(names(channel)).toEqual([]);
      core.emitTrajectoryEvent("app.native", { captured: true });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(names(channel)).toEqual(["app.native"]);
      persist(channel);
      expect(() => core.stopTrajectory()).not.toThrow();
      expect(core.trajectoryId).toBeNull();
      expect(channel.left).toBe(true);
      expect(transport.sockets[0]!.disconnected).toBe(true);
      const pending = core.startTrajectory();
      expect(() => core.stopTrajectory()).not.toThrow();
      expect(await pending).toEqual({ status: "error", code: "CANCELLED" });
    },
  );

  it.each(["offline", "channel loss"])(
    "counts only developer events discarded during an established session's %s recovery",
    async (loss) => {
      const core = makeCore({
        learning: {
          capture: { clicks: false, navigation: false },
          beforeSend: (event: TrajectoryEvent) =>
            event.name === "page" ? null : event,
          onError,
        },
      });
      core.emitTrajectoryEvent("app.beforeStart", {});
      const pending = core.startTrajectory({ trajectoryId: "trajectory-1" });
      core.emitTrajectoryEvent("app.beforeAuth", {});
      await authorize();
      core.emitTrajectoryEvent("app.beforeFirstJoin", {});
      const first = join();
      expect((await pending).status).toBe("started");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.pushes).toEqual([]);
      if (loss === "offline") window.dispatchEvent(new Event("offline"));
      else first.callbacks.get("phx_error")!();
      core.emitTrajectoryEvent("app.lost1", { private: "never queued" });
      core.emitTrajectoryEvent("app.lost2", [1, 2]);
      if (loss === "offline") window.dispatchEvent(new Event("online"));
      else await vi.advanceTimersByTimeAsync(1_000);
      core.emitTrajectoryEvent("app.duringReauth", {});
      await authorize(1);
      core.emitTrajectoryEvent("app.beforeRejoin", {});
      const next = join(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(first.pushes).toEqual([]);
      expect(next.pushes[0]!.payload).toEqual({ events: [], dropped: 4 });
      persist(next);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(next.pushes).toHaveLength(1);
      core.stopTrajectory();
      core.emitTrajectoryEvent("app.afterStop", {});
      const later = core.startTrajectory({ trajectoryId: "later" });
      await authorize(2);
      const last = join(2);
      expect((await later).status).toBe("started");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(last.pushes).toEqual([]);
    },
  );

  it.each(["unauthorized", "trajectory_mismatch"])(
    "closes a terminal %s channel without flushing its queued tail or retrying",
    async (reason) => {
      const { core, channel } = await start();
      core.emitTrajectoryEvent("app.sent", {});
      await vi.advanceTimersByTimeAsync(2_000);
      core.emitTrajectoryEvent("app.queued", {});
      channel.pushes[1]!.push.reply("error", { reason });
      expect(core.trajectoryId).toBeNull();
      expect(channel.left).toBe(true);
      expect(transport.sockets[0]!.disconnected).toBe(true);
      expect(names(channel)).toEqual(["page", "app.sent"]);
      expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
        reason.toUpperCase(),
      ]);
      core.emitTrajectoryEvent("app.afterRefusal", {});
      await vi.advanceTimersByTimeAsync(30_000);
      expect(channel.pushes).toHaveLength(2);
      expect(requests).toHaveLength(1);
    },
  );

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

  it("waits for auto-detection before choosing the connect request", async () => {
    const core = makeCore({ runtimeTransport: "auto" });
    const pending = core.startTrajectory({ trajectoryId: "trajectory-1" });
    await flush();
    expect(requests).toHaveLength(0);

    // Auto-detection settles on REST once the runtime answers.
    core.setRuntimeTransport("rest");
    await flush();
    const index = requests.findIndex((request) =>
      String(request.url).endsWith("/trajectory/trajectory-1/connect"),
    );

    expect(index).toBeGreaterThanOrEqual(0);
    expect(requests[index]!.init?.body).toBe("{}");
    await authorize(index);
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
    await vi.advanceTimersByTimeAsync(2_000);
    core.emitTrajectoryEvent("app.queued", {});
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
    await vi.advanceTimersByTimeAsync(2_000);
    expect(names(next)).toEqual(["page"]);
    expect(next.pushes[0]!.payload).toMatchObject({
      dropped: 2,
      events: [{ value: { seq: 3 } }],
    });
    expect(names(channel)).toEqual(["page", "app.uncertain"]);
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
    ["error", { reason: "invalid_batch" }, "INVALID_BATCH", 1],
    ["error", { reason: "batch_too_large" }, "BATCH_TOO_LARGE", 1],
    ["error", { reason: "batch_too_many_events" }, "BATCH_TOO_MANY_EVENTS", 1],
    [
      "error",
      { reason: "trajectory_over_share", retryable: true },
      "TRAJECTORY_OVER_SHARE",
      1,
    ],
    [
      "error",
      { reason: "trajectory_outbox_full", retryable: true },
      "TRAJECTORY_OUTBOX_FULL",
      1,
    ],
    [
      "error",
      { reason: "storage_unavailable", retryable: true },
      "PERSISTENCE_UNKNOWN",
      0,
    ],
    ["error", {}, "PERSISTENCE_UNKNOWN", 0],
    ["error", { reason: "unrecognized" }, "PERSISTENCE_UNKNOWN", 0],
    [
      "ok",
      { highestSeq: 1, accepted: 1, rejected: 1 },
      "PERSISTENCE_UNKNOWN",
      0,
    ],
    [
      "ok",
      { highestSeq: null, accepted: 1, rejected: 0 },
      "PERSISTENCE_UNKNOWN",
      0,
    ],
    [
      "ok",
      { highestSeq: 1.5, accepted: 1, rejected: 0 },
      "PERSISTENCE_UNKNOWN",
      0,
    ],
    ["timeout", {}, "PERSISTENCE_UNKNOWN", 0],
  ])(
    "reports %s acknowledgements and carries only known client loss",
    async (status, acknowledgement, code, dropped) => {
      const { core, channel } = await start();
      core.emitTrajectoryEvent("app.once", 42);
      await vi.advanceTimersByTimeAsync(2_000);
      channel.pushes[1]!.push.reply(status, acknowledgement);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onError.mock.calls.map(([error]) => error.code)).toEqual([code]);
      expect(names(channel)).toEqual(["page", "app.once"]);
      core.emitTrajectoryEvent("app.next", {});
      await vi.advanceTimersByTimeAsync(2_000);
      expect(channel.pushes[2]!.payload.dropped).toBe(dropped);
      persist(channel);
      expect(requests).toHaveLength(1);
    },
  );

  it("bounds missing acks and reports uncertain in-flight sends on explicit stop", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.noAck", true);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onError).toHaveBeenCalledTimes(1);
    core.emitTrajectoryEvent("app.stopping", null);
    core.stopTrajectory();
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "PERSISTENCE_UNKNOWN",
      "PERSISTENCE_UNKNOWN",
    ]);
    core.emitTrajectoryEvent("app.stopped", {});
    channel.pushes[2]!.push.reply("ok", {
      highestSeq: 2,
      accepted: 1,
      rejected: 0,
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
    await vi.advanceTimersByTimeAsync(2_000);
    expect(channel.pushes.at(-1)!.payload.events[0]!.value).toEqual({
      data: "still captured",
      seq: 1,
    });
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

  it("flushes at 50 events and bounds memory to one pending batch plus one queue", async () => {
    const { core, channel } = await start();
    for (let i = 0; i < 101; i++) core.emitTrajectoryEvent("app.burst", { i });
    expect(channel.pushes).toHaveLength(2);
    expect(channel.pushes[1]!.payload.events).toHaveLength(50);
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "EVENTS_DROPPED",
    ]);
    persist(channel);
    expect(channel.pushes).toHaveLength(3);
    expect(channel.pushes[2]!.payload.events).toHaveLength(50);
    expect(channel.pushes[2]!.payload.dropped).toBe(1);
    expect(
      channel.pushes.flatMap(({ payload }) =>
        payload.events.map((event) => event.value.seq),
      ),
    ).toEqual(Array.from({ length: 101 }, (_, i) => i));
    persist(channel);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.pushes).toHaveLength(3);
  });

  it("flushes before the UTF-8 batch limit and checks final events after adding seq", async () => {
    const { core, channel } = await start();
    for (let i = 0; i < 5; i++)
      core.emitTrajectoryEvent("app.large", { text: "é".repeat(7900) });
    expect(channel.pushes[1]!.payload.events).toHaveLength(4);
    persist(channel);
    expect(channel.pushes[2]!.payload.events).toHaveLength(1);
    for (const { payload } of channel.pushes) {
      expect(
        new TextEncoder().encode(JSON.stringify(payload)).byteLength,
      ).toBeLessThanOrEqual(65536);
      for (const event of payload.events)
        expect(
          new TextEncoder().encode(JSON.stringify(event)).byteLength,
        ).toBeLessThanOrEqual(16384);
    }
    persist(channel);
    const base = {
      type: "CUSTOM",
      name: "app.edge",
      timestamp: Date.now(),
      value: { text: "" },
    };
    const size = new TextEncoder().encode(JSON.stringify(base)).byteLength;
    core.emitTrajectoryEvent("app.edge", { text: "x".repeat(16384 - size) });
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "EVENT_TOO_LARGE",
    ]);
    core.emitTrajectoryEvent("app.afterSizeDrop", {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(channel.pushes.at(-1)!.payload.dropped).toBe(1);
    expect(names(channel)).not.toContain("app.edge");
    persist(channel);
  });

  it("reports local drops without requiring another valid event and never retries a dropped-only batch", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.tooLarge", { text: "x".repeat(17000) });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(channel.pushes[1]!.payload).toEqual({ events: [], dropped: 1 });
    channel.pushes[1]!.push.reply("ok", {
      highestSeq: 0,
      accepted: 0,
      rejected: 0,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.pushes).toHaveLength(2);
    core.emitTrajectoryEvent("app.tooLargeAgain", { text: "x".repeat(17000) });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(channel.pushes[2]!.payload).toEqual({ events: [], dropped: 1 });
    channel.pushes[2]!.push.reply("error", {
      reason: "storage_unavailable",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.pushes).toHaveLength(3);
    core.emitTrajectoryEvent("app.next", {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(channel.pushes[3]!.payload.dropped).toBe(0);
    persist(channel);
  });

  it("preserves developer seq fields and keeps outcome fields at the expected wire level", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.ownSeq", { seq: 72, nested: [null, true] });
    core.emitTrajectoryEvent("outcome", {
      workflow: "checkout",
      phase: "succeeded",
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(
      channel.pushes[1]!.payload.events.map((event) => event.value),
    ).toEqual([
      { data: { seq: 72, nested: [null, true] }, seq: 1 },
      { workflow: "checkout", phase: "succeeded", seq: 2 },
    ]);
    persist(channel);
  });

  it("reports aggregate partial rejection without counting it again as a client drop", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("outcome", {
      workflow: "checkout",
      phase: "invalid",
    });
    core.emitTrajectoryEvent("app.valid", {});
    await vi.advanceTimersByTimeAsync(2_000);
    channel.pushes[1]!.push.reply("ok", {
      highestSeq: 2,
      accepted: 1,
      rejected: 1,
    });
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "EVENTS_REJECTED",
    ]);
    core.emitTrajectoryEvent("app.afterRejection", {});
    await vi.advanceTimersByTimeAsync(2_000);
    expect(channel.pushes[2]!.payload.dropped).toBe(0);
    expect(names(channel)).toEqual([
      "page",
      "outcome",
      "app.valid",
      "app.afterRejection",
    ]);
    persist(channel);
  });

  it.each(["trajectory_over_share", "trajectory_outbox_full"])(
    "restores known dropped counters after a confirmed %s rejection",
    async (reason) => {
      const { core, channel } = await start();
      core.emitTrajectoryEvent("app.tooLarge", { text: "x".repeat(17000) });
      core.emitTrajectoryEvent("app.valid", {});
      await vi.advanceTimersByTimeAsync(2_000);
      expect(channel.pushes[1]!.payload.dropped).toBe(1);
      channel.pushes[1]!.push.reply("error", { reason, retryable: true });
      core.emitTrajectoryEvent("app.next", {});
      await vi.advanceTimersByTimeAsync(2_000);
      expect(channel.pushes[2]!.payload.dropped).toBe(2);
      channel.pushes[2]!.push.reply("error", {
        reason: "storage_unavailable",
        retryable: true,
      });
      core.emitTrajectoryEvent("app.afterUnknown", {});
      await vi.advanceTimersByTimeAsync(2_000);
      expect(channel.pushes[3]!.payload.dropped).toBe(0);
      persist(channel);
    },
  );

  it("continues sequence numbers after stop/start while resetting losses for a new trajectory", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.first", {});
    core.stopTrajectory();
    expect(channel.pushes[1]!.payload.events[0]!.value.seq).toBe(1);
    const pending = core.startTrajectory({
      trajectoryId: "another-trajectory",
    });
    await authorize(1);
    const next = join(1);
    expect((await pending).status).toBe("started");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(next.pushes[0]!.payload).toMatchObject({
      dropped: 0,
      events: [{ value: { seq: 2 } }],
    });
    persist(next);
  });

  it("drops a queued final batch when an earlier batch is still awaiting its ACK", async () => {
    const { core, channel } = await start();
    core.emitTrajectoryEvent("app.pending", {});
    await vi.advanceTimersByTimeAsync(2_000);
    core.emitTrajectoryEvent("app.queued", {});
    core.stopTrajectory();
    expect(names(channel)).toEqual(["page", "app.pending"]);
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "EVENTS_DROPPED",
      "PERSISTENCE_UNKNOWN",
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.pushes).toHaveLength(2);
  });

  it("fails a browser capture setup error instead of reporting capture as started", async () => {
    const core = makeCore({ learning: { onError } });
    const pending = core.startTrajectory();
    await authorize();
    // Node fixture deliberately has no history for installing navigation hooks.
    join();
    expect(await pending).toEqual({ status: "error", code: "CAPTURE_FAILED" });
    expect(core.trajectoryId).toBeNull();
  });
});
