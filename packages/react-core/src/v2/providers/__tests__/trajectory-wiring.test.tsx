import React, { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { useCopilotKit } from "../../context";
import { CopilotKitCoreReact } from "../../lib/react-core";

// Keep Core and browser capture real; control only the auth and Phoenix boundary.
const transport = vi.hoisted(() => {
  class Push {
    callbacks = new Map<string, (value: unknown) => void>();
    receive(status: string, callback: (value: unknown) => void) {
      this.callbacks.set(status, callback);
      return this;
    }
    reply(status: string, value: unknown = {}) {
      this.callbacks.get(status)?.(value);
    }
  }
  class Channel {
    joined = new Push();
    state = "joining";
    left = false;
    pushes: { event: string; payload: unknown; push: Push }[] = [];
    constructor(public topic: string) {}
    join() {
      return this.joined;
    }
    leave() {
      this.left = true;
      return new Push();
    }
    push(event: string, payload: unknown) {
      const push = new Push();
      this.pushes.push({ event, payload, push });
      return push;
    }
    on() {
      return 0;
    }
    off() {}
    onError() {
      return 0;
    }
    onClose() {
      return 0;
    }
  }
  const sockets: Socket[] = [];
  class Socket {
    channels: Channel[] = [];
    disconnected = false;
    constructor() {
      sockets.push(this);
    }
    connect() {}
    disconnect() {
      this.disconnected = true;
    }
    isConnected() {
      return !this.disconnected;
    }
    onOpen() {
      return 0;
    }
    onError() {
      return 0;
    }
    onClose() {
      return 0;
    }
    off() {}
    channel(topic: string) {
      const channel = new Channel(topic);
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

type Learning = NonNullable<
  React.ComponentProps<typeof CopilotKitProvider>["learning"]
>;
const pendingAuth: ReturnType<typeof deferred<Response>>[] = [];
const FIRST_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const nativePushState = History.prototype.pushState;
let core: CopilotKitCoreReact;

function CoreProbe() {
  core = useCopilotKit().copilotkit;
  return null;
}

function App({ learning }: { learning?: Learning }) {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" learning={learning}>
      <CoreProbe />
    </CopilotKitProvider>
  );
}

async function authorize(index: number, trajectoryId: string) {
  await act(async () => {
    pendingAuth[index].resolve(
      new Response(
        JSON.stringify({
          joinToken: "test-token",
          realtime: {
            clientUrl: "wss://intelligence.invalid/socket",
            topic: `trajectory:${trajectoryId}`,
          },
        }),
        { status: 200 },
      ),
    );
  });
}

async function join(index = 0) {
  await act(async () => {
    const channel = transport.sockets[index].channels[0];
    channel.state = "joined";
    channel.joined.reply("ok");
  });
}

async function flushCapture() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pendingAuth.length = 0;
  transport.sockets.length = 0;
  history.replaceState(null, "", "/deals");
  // Runtime discovery is unrelated to Trajectory authentication.
  vi.spyOn(CopilotKitCoreReact.prototype, "connect").mockImplementation(
    () => {},
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      const request = deferred<Response>();
      pendingAuth.push(request);
      return request.promise;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CopilotKitProvider authenticated Trajectories", () => {
  it("starts without a sink after authentication and channel join, with no chat", async () => {
    const view = render(
      <App learning={{ trajectoryId: FIRST_ID, routes: ["/deals"] }} />,
    );

    expect(pendingAuth).toHaveLength(1);
    expect(History.prototype.pushState).toBe(nativePushState);
    await authorize(0, FIRST_ID);
    expect(History.prototype.pushState).toBe(nativePushState);
    await join();

    expect(core.trajectoryId).toBe(FIRST_ID);
    expect(transport.sockets[0].channels[0].pushes).toEqual([]);
    await flushCapture();
    expect(transport.sockets[0].channels[0].pushes).toEqual([
      {
        event: "events",
        payload: {
          events: [
            {
              type: "CUSTOM",
              name: "page",
              timestamp: expect.any(Number),
              value: { route: "/deals", seq: 0 },
            },
          ],
          dropped: 0,
        },
        push: expect.anything(),
      },
    ]);
    view.unmount();
    expect(transport.sockets[0].disconnected).toBe(true);
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("cancels the previous authentication when the supplied ID changes", async () => {
    const view = render(<App learning={{ trajectoryId: FIRST_ID }} />);
    view.rerender(<App learning={{ trajectoryId: SECOND_ID }} />);

    await authorize(0, FIRST_ID);
    expect(transport.sockets).toHaveLength(0);
    await authorize(1, SECOND_ID);
    await join();

    expect(core.trajectoryId).toBe(SECOND_ID);
    expect(transport.sockets).toHaveLength(1);
    expect(transport.sockets[0].channels[0].topic).toBe(
      `trajectory:${SECOND_ID}`,
    );
  });

  it("cancels pending authentication when disabled and can enable the same ID again", async () => {
    const view = render(<App learning={{ trajectoryId: FIRST_ID }} />);
    view.rerender(<App />);
    await authorize(0, FIRST_ID);
    expect(transport.sockets).toHaveLength(0);

    view.rerender(<App learning={{ trajectoryId: FIRST_ID }} />);
    await authorize(1, FIRST_ID);
    await join();
    expect(core.trajectoryId).toBe(FIRST_ID);

    view.rerender(<App />);
    expect(transport.sockets[0].channels[0].left).toBe(true);
    expect(transport.sockets[0].disconnected).toBe(true);
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("cancels a manual start on unmount when no trajectoryId prop is supplied", async () => {
    const view = render(<App learning={{}} />);
    expect(pendingAuth).toHaveLength(0);

    const start = core.startTrajectory();
    view.unmount();
    await expect(start).resolves.toEqual({
      status: "error",
      code: "CANCELLED",
    });
    await authorize(0, FIRST_ID);
    expect(transport.sockets).toHaveLength(0);
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("ignores a late join after unmount", async () => {
    const view = render(<App learning={{ trajectoryId: FIRST_ID }} />);
    await authorize(0, FIRST_ID);
    view.unmount();
    await join();

    expect(transport.sockets[0].channels[0].left).toBe(true);
    expect(transport.sockets[0].channels[0].pushes).toEqual([]);
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("leaves one active capture after root StrictMode replays the effects", async () => {
    const view = render(<App learning={{ trajectoryId: FIRST_ID }} />, {
      wrapper: StrictMode,
    });
    expect(pendingAuth).toHaveLength(2);
    await authorize(0, FIRST_ID);
    await authorize(1, FIRST_ID);
    await join();
    expect(transport.sockets).toHaveLength(1);
    await flushCapture();
    expect(transport.sockets[0].channels[0].pushes).toHaveLength(1);
    transport.sockets[0].channels[0].pushes[0].push.reply("ok", {
      highestSeq: 0,
      accepted: 1,
      rejected: 0,
    });

    history.pushState(null, "", "/next");
    await flushCapture();
    expect(transport.sockets[0].channels[0].pushes).toHaveLength(2);
    expect(transport.sockets[0].channels[0].pushes[1].payload).toMatchObject({
      events: [{ name: "navigation", value: { seq: 1 } }],
    });
    view.unmount();
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("consumes unexpected startup rejections without exposing the underlying error", async () => {
    vi.spyOn(
      CopilotKitCoreReact.prototype,
      "startTrajectory",
    ).mockRejectedValue(new Error("private token"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<App learning={{ trajectoryId: FIRST_ID }} />);
    await act(async () => {});

    expect(warn).toHaveBeenCalledWith(
      "[CopilotKit] Failed to start interaction capture.",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private token");
  });

  it("silences a previous start rejection without stopping the replacement", async () => {
    const previous =
      deferred<Awaited<ReturnType<CopilotKitCoreReact["startTrajectory"]>>>();
    const start = vi
      .spyOn(CopilotKitCoreReact.prototype, "startTrajectory")
      .mockImplementationOnce(() => previous.promise)
      .mockResolvedValue({ status: "started", trajectoryId: SECOND_ID });
    const stop = vi.spyOn(CopilotKitCoreReact.prototype, "stopTrajectory");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = render(<App learning={{ trajectoryId: FIRST_ID }} />);
    view.rerender(<App learning={{ trajectoryId: SECOND_ID }} />);
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      previous.reject(new Error("late failure"));
    });
    expect(warn).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
