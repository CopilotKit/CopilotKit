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
    const frame = this.frames.find((candidate) => candidate[3] === event);
    if (!frame) throw new Error(`Expected Phoenix frame: ${event}`);
    return frame;
  }
}

const trajectoryId = "10000000-0000-4000-8000-000000000001";
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
  document.title = "";
  document.body.replaceChildren();
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
  vi.restoreAllMocks();
});

async function start() {
  const result = core.startTrajectory({ trajectoryId });
  await vi.advanceTimersByTimeAsync(0);
  const socket = getSocket(0);
  socket.open();
  socket.reply(socket.frame("phx_join"));
  await expect(result).resolves.toEqual({
    status: "started",
    trajectoryId,
  });
  return socket;
}

function getSocket(index: number) {
  const socket = BrowserSocket.instances[index];
  if (!socket) throw new Error(`Expected WebSocket connection ${index}`);
  return socket;
}

function acknowledgePage(socket: BrowserSocket, highestSeq: number) {
  socket.reply(socket.frame("events"), {
    highestSeq,
    accepted: 1,
    rejected: 0,
  });
}

// jsdom events are untrusted. Substitute only this browser-owned property at
// the listener boundary; real DOM dispatch, capture modules and cleanup remain
// in use. Production continues to require native trusted events.
function trustBrowserInput() {
  const add = window.addEventListener;
  const remove = window.removeEventListener;
  const wrapped = new Map<EventListenerOrEventListenerObject, EventListener>();
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type, listener, options) => {
      if (listener && ["click", "input", "change"].includes(type)) {
        let proxy = wrapped.get(listener);
        if (!proxy) {
          proxy = (event) => {
            const trusted = new Proxy(event, {
              get(target, property) {
                if (property === "isTrusted") return true;
                const value = Reflect.get(target, property, target);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
            if (typeof listener === "function") listener.call(window, trusted);
            else listener.handleEvent(trusted);
          };
          wrapped.set(listener, proxy);
        }
        add.call(window, type, proxy, options);
      } else add.call(window, type, listener, options);
    },
  );
  vi.spyOn(window, "removeEventListener").mockImplementation(
    (type, listener, options) => {
      remove.call(
        window,
        type,
        listener ? (wrapped.get(listener) ?? listener) : listener,
        options,
      );
    },
  );
}

describe("Trajectory capture with the real Phoenix client", () => {
  it("uses socket join_token authentication, the granted topic, and AG-UI event batches", async () => {
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

    expect(socket.frames.some((frame) => frame[3] === "events")).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const event = socket.frame("events");
    expect(event.slice(2)).toEqual([
      "opaque:scope-7",
      "events",
      {
        events: [
          {
            type: "CUSTOM",
            name: "page",
            timestamp: expect.any(Number),
            value: {
              route: "/deals",
              url: location.href,
              title: "",
              referrer: document.referrer,
              seq: 0,
            },
          },
        ],
        dropped: 0,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0];
    if (!request) throw new Error("Expected a runtime request");
    expect(JSON.parse(request[1].body)).toMatchObject({
      method: "trajectory/connect",
      params: { trajectoryId },
    });

    acknowledgePage(socket, 0);
    await vi.advanceTimersByTimeAsync(10_001);
    core.stopTrajectory();
    expect(onError).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
  });

  it("obtains a fresh grant after loss and prevents old sockets from rejoining after stop", async () => {
    const first = await start();
    await vi.advanceTimersByTimeAsync(2_000);
    acknowledgePage(first, 0);
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
    expect(core.trajectoryId).toBe(trajectoryId);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(second.frame("events")[4]).toMatchObject({
      events: [{ name: "page", value: { seq: 1 } }],
      dropped: 0,
    });
    acknowledgePage(second, 1);

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

  it("preserves full browser capture through REST authentication and Phoenix batches, then cleans up between sessions", async () => {
    trustBrowserInput();
    const beforeSend = vi.fn((event) => event);
    core = new CopilotKitCore({
      runtimeUrl: "https://runtime.invalid/copilotkit",
      runtimeTransport: "rest",
      deferInitialConnection: true,
      learning: { beforeSend, onError },
    });
    document.title = "Customer orders";
    history.replaceState(null, "", "/users/alice?account=personal#orders");
    const initialUrl = location.href;
    const response = new Response('{"saved":"alice@example.com"}', {
      status: 201,
      headers: {
        "content-type": "application/json",
        "x-result": "visible-value",
      },
    });
    let resolveLate!: (response: Response) => void;
    const lateResponse = new Promise<Response>((resolve) => {
      resolveLate = resolve;
    });
    let grantIndex = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).startsWith("https://runtime.invalid/")) {
        return Promise.resolve(
          Response.json(grants[grantIndex++] ?? grants[1]),
        );
      }
      if (String(input) === "/late?session=old") return lateResponse;
      return Promise.resolve(response);
    });

    const socket = await start();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://runtime.invalid/copilotkit/trajectory/${trajectoryId}/connect`,
    );
    history.pushState(null, "", "/users/alice/orders?search=private#invoice");
    const currentUrl = location.href;
    document.body.innerHTML =
      '<button data-order="order-42" aria-label="Save order">Save Alice\'s order</button><input name="email" type="email">';
    const button = document.querySelector("button")!;
    const input = document.querySelector("input")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    input.value = "alice@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const requestBody = '{"email":"alice@example.com"}';
    const appResponse = await fetch("/api/orders/42?token=visible#details", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer visible",
      },
      body: requestBody,
    });
    expect(appResponse).toBe(response);
    expect(await appResponse.text()).toBe('{"saved":"alice@example.com"}');
    await vi.waitFor(() =>
      expect(beforeSend).toHaveBeenCalledWith(
        expect.objectContaining({ name: "network" }),
      ),
    );
    // A runtime request made while capture is active must not capture itself.
    await fetch(
      `https://runtime.invalid/copilotkit/trajectory/${trajectoryId}/connect`,
    );
    await vi.advanceTimersByTimeAsync(2_000);

    const batch = socket.frame("events");
    expect(batch[4]).toEqual({
      dropped: 0,
      events: [
        expect.objectContaining({
          type: "CUSTOM",
          name: "page",
          value: {
            route: "/users/alice",
            url: initialUrl,
            title: "Customer orders",
            referrer: document.referrer,
            seq: 0,
          },
        }),
        expect.objectContaining({
          name: "navigation",
          value: {
            from: initialUrl,
            to: currentUrl,
            navigationType: "push",
            seq: 1,
          },
        }),
        expect.objectContaining({
          name: "click",
          value: {
            route: "/users/alice/orders",
            url: currentUrl,
            seq: 2,
            target: {
              tag: "button",
              role: null,
              action: null,
              text: "Save Alice's order",
              input: "pointer",
              attributes: {
                "data-order": "order-42",
                "aria-label": "Save order",
              },
            },
          },
        }),
        expect.objectContaining({
          name: "input",
          value: {
            eventType: "input",
            route: "/users/alice/orders",
            url: currentUrl,
            seq: 3,
            target: {
              tag: "input",
              role: null,
              action: null,
              text: "",
              attributes: { name: "email", type: "email" },
              value: "alice@example.com",
            },
          },
        }),
        expect.objectContaining({
          name: "network",
          value: expect.objectContaining({
            transport: "fetch",
            method: "POST",
            url: `${location.origin}/api/orders/42?token=[redacted]#details`,
            route: "/api/orders/42",
            status: 201,
            seq: 4,
            completedAt: expect.any(Number),
            durationMs: expect.any(Number),
            request: {
              headers: {
                "content-type": "application/json",
                authorization: "[redacted]",
              },
              body: {
                status: "complete",
                text: requestBody,
                encoding: "utf-8",
              },
            },
            response: {
              headers: {
                "content-type": "application/json",
                "x-result": "visible-value",
              },
              body: {
                status: "complete",
                text: '{"saved":"alice@example.com"}',
                encoding: "utf-8",
              },
            },
          }),
        }),
      ],
    });
    socket.reply(batch, { highestSeq: 4, accepted: 5, rejected: 0 });
    const pending = fetch("/late?session=old");
    core.stopTrajectory();
    expect(globalThis.fetch).toBe(fetchMock);
    expect(History.prototype.pushState).toBe(nativePushState);
    const capturesAfterStop = beforeSend.mock.calls.length;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    history.pushState(null, "", "/after-stop?untracked=1#fragment");
    expect(beforeSend).toHaveBeenCalledTimes(capturesAfterStop);

    const restarted = core.startTrajectory({ trajectoryId });
    await vi.advanceTimersByTimeAsync(0);
    const next = getSocket(1);
    next.open();
    next.reply(next.frame("phx_join"));
    await expect(restarted).resolves.toEqual({
      status: "started",
      trajectoryId,
    });
    resolveLate(new Response("old session response"));
    expect(await (await pending).text()).toBe("old session response");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(next.frame("events")[4]).toEqual({
      events: [
        expect.objectContaining({
          name: "page",
          value: expect.objectContaining({ url: location.href, seq: 5 }),
        }),
      ],
      dropped: 0,
    });
    expect(beforeSend).toHaveBeenCalledTimes(capturesAfterStop + 1);
    acknowledgePage(next, 5);
    core.stopTrajectory();
    expect(globalThis.fetch).toBe(fetchMock);
    expect(onError).not.toHaveBeenCalled();
  });
});
