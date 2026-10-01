// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";

type Frame = [string | null, string | null, string, string, unknown];

// Browser WebSocket boundary only. Phoenix Socket, Channel, Push, serializers,
// reconnect timers, Core, and browser capture all use their real implementations.
class BrowserSocket {
  static instances: BrowserSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  frames: Frame[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(public url: string) {
    BrowserSocket.instances.push(this);
  }

  send(data: string) {
    if (this.readyState !== 1) throw new Error("WebSocket is not open");
    this.frames.push(JSON.parse(data) as Frame);
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }

  reply(frame: Frame, response: unknown = {}) {
    this.onmessage?.({
      data: JSON.stringify([
        frame[0],
        frame[1],
        frame[2],
        "phx_reply",
        { status: "ok", response },
      ]),
    });
  }

  frame(event: string) {
    const frame = this.frames.find((frame) => frame[3] === event);
    if (!frame) throw new Error(`Expected Phoenix frame: ${event}`);
    return frame;
  }
}

const grants = [
  {
    joinToken: "single-use-one",
    realtime: {
      clientUrl: "wss://intelligence.invalid/socket",
      topic: "opaque:scope-7",
    },
  },
  {
    joinToken: "single-use-two",
    realtime: {
      clientUrl: "wss://intelligence.invalid/socket",
      topic: "opaque:scope-8",
    },
  },
];
const nativePushState = History.prototype.pushState;
let core: CopilotKitCore;
let fetchMock: ReturnType<typeof vi.fn>;
let onError: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  BrowserSocket.instances = [];
  vi.stubGlobal("WebSocket", BrowserSocket);
  history.replaceState(null, "", "/deals");
  let grantIndex = 0;
  fetchMock = vi.fn(async () => {
    const grant = grants[grantIndex++];
    if (!grant) throw new Error("Unexpected third runtime grant request");
    return Response.json(grant);
  });
  vi.stubGlobal("fetch", fetchMock);
  onError = vi.fn();
  core = new CopilotKitCore({
    runtimeUrl: "https://runtime.invalid/copilotkit",
    runtimeTransport: "single",
    deferInitialConnection: true,
    learning: { routes: ["/deals"], onError },
  });
});

afterEach(() => {
  core.stopTrajectory();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start() {
  const result = core.startTrajectory({ trajectoryId: "requested-id" });
  await vi.advanceTimersByTimeAsync(0);
  const socket = getSocket(0);
  socket.open();
  socket.reply(socket.frame("phx_join"));
  await expect(result).resolves.toEqual({
    status: "started",
    trajectoryId: "requested-id",
  });
  return socket;
}

function getSocket(index: number) {
  const socket = BrowserSocket.instances[index];
  if (!socket) throw new Error(`Expected WebSocket connection ${index}`);
  return socket;
}

function acknowledgePage(socket: BrowserSocket, eventId: string) {
  socket.reply(socket.frame("trajectory.event"), {
    status: "persisted",
    eventId,
  });
}

describe("Trajectory capture with the real Phoenix client", () => {
  it("uses socket join_token authentication, the granted topic, and plain AG-UI frames", async () => {
    const socket = await start();
    const url = new URL(socket.url);
    expect(url.origin).toBe("wss://intelligence.invalid");
    expect(url.pathname).toBe("/socket/websocket");
    expect(url.searchParams.get("join_token")).toBe("single-use-one");
    expect(url.searchParams.get("vsn")).toBe("2.0.0");
    expect(socket.frame("phx_join").slice(2)).toEqual([
      "opaque:scope-7",
      "phx_join",
      {},
    ]);

    const event = socket.frame("trajectory.event");
    expect(event.slice(2)).toEqual([
      "opaque:scope-7",
      "trajectory.event",
      {
        type: "CUSTOM",
        name: "page",
        timestamp: expect.any(Number),
        value: { route: "/deals" },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    if (!request) throw new Error("Expected a runtime request");
    expect(JSON.parse(request[1].body)).toMatchObject({
      method: "trajectory/connect",
      params: { trajectoryId: "requested-id" },
    });

    acknowledgePage(socket, "persisted-1");
    await vi.advanceTimersByTimeAsync(10_001);
    core.stopTrajectory();
    expect(onError).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
  });

  it("obtains a fresh grant after loss and prevents old sockets from rejoining after stop", async () => {
    const first = await start();
    acknowledgePage(first, "persisted-1");
    first.close(1006);
    expect(core.trajectoryId).toBeNull();
    expect(History.prototype.pushState).toBe(nativePushState);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(BrowserSocket.instances).toHaveLength(2);
    const second = getSocket(1);
    expect(new URL(second.url).searchParams.get("join_token")).toBe(
      "single-use-two",
    );
    second.open();
    expect(second.frame("phx_join")[2]).toBe("opaque:scope-8");
    second.reply(second.frame("phx_join"));
    expect(core.trajectoryId).toBe("requested-id");
    acknowledgePage(second, "persisted-2");

    second.close(1006);
    core.stopTrajectory();
    const frameCounts = BrowserSocket.instances.map(
      (socket) => socket.frames.length,
    );
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(BrowserSocket.instances).toHaveLength(2);
    expect(
      BrowserSocket.instances.map((socket) => socket.frames.length),
    ).toEqual(frameCounts);
    expect(core.trajectoryId).toBeNull();
    expect(History.prototype.pushState).toBe(nativePushState);
    expect(onError.mock.calls.map(([error]) => error.code)).toEqual([
      "CONNECTION_LOST",
      "CONNECTION_LOST",
    ]);
  });
});
