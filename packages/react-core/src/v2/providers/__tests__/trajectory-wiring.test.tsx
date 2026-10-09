import React, { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { AssistantMessage } from "@ag-ui/core";
import { z } from "zod";
import { randomUUID } from "@copilotkit/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { useCopilotKit } from "../../context";
import { CopilotKitCoreReact } from "../../lib/react-core";
import { defineToolCallRenderer } from "../../types";
import { CopilotChatToolCallsView } from "../../components/chat/CopilotChatToolCallsView";

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
// Fake time is pinned so the Core's time-based first seq is predictable.
const NOW = Date.UTC(2026, 0, 1);
const SEQ_BASE = NOW * 1000;
let core: CopilotKitCoreReact;

function CoreProbe() {
  core = useCopilotKit().copilotkit;
  return null;
}

// Runtime discovery is mocked out below, so pin the transport: with "auto",
// capture waits for discovery before it sends the connect request.
function App({ learning }: { learning?: Learning }) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint
      learning={learning}
    >
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
  vi.setSystemTime(NOW);
  pendingAuth.length = 0;
  transport.sockets.length = 0;
  history.replaceState(null, "", "/deals");
  // Keep runtime discovery out of these tests; App pins the transport instead.
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
  const CONTAINER_WARNING =
    "learningContainerIds is supported only with a custom sink";
  function containerWarnings(warn: ReturnType<typeof vi.spyOn>): number {
    return warn.mock.calls.filter(([message]) =>
      String(message).includes(CONTAINER_WARNING),
    ).length;
  }

  // Exactly one warning per mount: Core warns when the provider starts with
  // the options, and the provider warns only when it does not start.
  it.each<{
    name: string;
    learning: Learning;
    manualStartId?: string;
    connectedId: string;
  }>([
    {
      name: "auto start with a supplied ID, warned by Core",
      learning: {
        trajectoryId: FIRST_ID,
        autoStart: true,
        learningContainerIds: ["private-container"],
      },
      connectedId: FIRST_ID,
    },
    {
      name: "default auto start with a generated ID, warned by Core",
      learning: { learningContainerIds: ["private-container"] },
      connectedId: "mock-thread-id",
    },
    {
      name: "manual start, warned by the provider",
      learning: {
        autoStart: false,
        learningContainerIds: ["private-container"],
      },
      manualStartId: FIRST_ID,
      connectedId: FIRST_ID,
    },
    {
      name: "manual start with an ignored trajectoryId, warned by the provider",
      learning: {
        autoStart: false,
        trajectoryId: SECOND_ID,
        learningContainerIds: ["private-container"],
      },
      manualStartId: FIRST_ID,
      connectedId: FIRST_ID,
    },
  ])(
    "warns once about provider container options without sending them ($name)",
    async ({ learning, manualStartId, connectedId }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      render(<App learning={learning} />);

      expect(containerWarnings(warn)).toBe(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        "private-container",
      );
      const manualStart =
        manualStartId === undefined
          ? undefined
          : core.startTrajectory({ trajectoryId: manualStartId });
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
      expect(
        JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)),
      ).toEqual({
        method: "trajectory/connect",
        params: { trajectoryId: connectedId },
        body: {},
      });

      await authorize(0, connectedId);
      await join();
      await manualStart;
      await flushCapture();
      const sent = JSON.stringify(
        transport.sockets[0].channels[0].pushes[0].payload,
      );
      expect(sent).not.toContain("learningContainerIds");
      expect(sent).not.toContain("private-container");
      expect(core.trajectoryId).toBe(connectedId);
      expect(containerWarnings(warn)).toBe(1);
    },
  );

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
              value: {
                route: "/deals",
                url: location.href,
                title: document.title,
                referrer: document.referrer,
                seq: SEQ_BASE,
              },
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

  it("cancels a manual start on unmount when autoStart is false", async () => {
    const view = render(<App learning={{ autoStart: false }} />);
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
      highestSeq: SEQ_BASE,
      accepted: 1,
      rejected: 0,
    });

    history.pushState(null, "", "/next");
    await flushCapture();
    expect(transport.sockets[0].channels[0].pushes).toHaveLength(2);
    expect(transport.sockets[0].channels[0].pushes[1].payload).toMatchObject({
      events: [{ name: "navigation", value: { seq: SEQ_BASE + 1 } }],
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

  describe("generated Trajectory IDs", () => {
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    // Network capture wraps `fetch` once it starts, so keep the stub itself.
    let fetchStub: ReturnType<typeof vi.mocked<typeof fetch>>;
    function connectedIds(): string[] {
      return fetchStub.mock.calls.map(
        ([, init]) => JSON.parse(String(init?.body)).params.trajectoryId,
      );
    }

    // The shared test setup pins randomUUID; these tests need distinct IDs.
    beforeEach(() => {
      fetchStub = vi.mocked(fetch);
      vi.mocked(randomUUID).mockImplementation(() => crypto.randomUUID());
    });
    afterEach(() => {
      vi.mocked(randomUUID).mockImplementation(() => "mock-thread-id");
    });

    it("generates a Trajectory ID and starts capture after mount", async () => {
      render(<App learning />);

      const [id] = connectedIds();
      expect(id).toMatch(UUID);
      await authorize(0, id);
      await join();
      expect(core.trajectoryId).toBe(id);
      expect(core.ɵlearningConfigured).toBe(true);
    });

    it.each([false, undefined])(
      "keeps capture off for learning=%s",
      (learning) => {
        render(<App learning={learning} />);

        expect(fetch).not.toHaveBeenCalled();
        expect(core.ɵlearningConfigured).toBe(false);
      },
    );

    it("keeps the generated ID across rerenders", async () => {
      const view = render(<App learning />);
      view.rerender(<App learning />);
      view.rerender(<App learning={true} />);
      const [id] = connectedIds();
      await authorize(0, id);
      await join();
      view.rerender(<App learning />);

      expect(connectedIds()).toEqual([id]);
      expect(core.trajectoryId).toBe(id);
      expect(transport.sockets).toHaveLength(1);
    });

    it("reuses the generated ID when root StrictMode replays the effects", async () => {
      render(<App learning />, { wrapper: StrictMode });

      const [id] = connectedIds();
      expect(connectedIds()).toEqual([id, id]);
      await authorize(0, id);
      await authorize(1, id);
      await join();
      expect(transport.sockets).toHaveLength(1);
      expect(core.trajectoryId).toBe(id);
    });

    it("keeps the generated ID through connection loss and reconnect", async () => {
      render(<App learning />);
      const [id] = connectedIds();
      await authorize(0, id);
      await join(0);

      transport.sockets[0].disconnected = true;
      act(() => core.emitTrajectoryEvent("app.lost", {}));
      expect(core.trajectoryId).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      await authorize(1, id);
      await join(1);

      expect(connectedIds()).toEqual([id, id]);
      expect(core.trajectoryId).toBe(id);
    });

    it("stops on disable and starts a new Trajectory with a new ID when enabled again", async () => {
      const view = render(<App learning />);
      const [first] = connectedIds();
      await authorize(0, first);
      await join(0);

      view.rerender(<App learning={false} />);
      expect(transport.sockets[0].channels[0].left).toBe(true);
      expect(transport.sockets[0].disconnected).toBe(true);
      expect(core.trajectoryId).toBeNull();
      expect(core.ɵlearningConfigured).toBe(false);

      view.rerender(<App learning />);
      const [, second] = connectedIds();
      expect(second).toMatch(UUID);
      expect(second).not.toBe(first);
      await authorize(1, second);
      await join(1);
      expect(core.trajectoryId).toBe(second);
    });

    it("stops capture on unmount", async () => {
      const view = render(<App learning />);
      await authorize(0, connectedIds()[0]);
      await join();

      view.unmount();
      expect(transport.sockets[0].channels[0].left).toBe(true);
      expect(transport.sockets[0].disconnected).toBe(true);
      expect(History.prototype.pushState).toBe(nativePushState);
    });

    it("lets a manual start join the generated Trajectory instead of starting another", async () => {
      render(<App learning />);
      const manual = core.startTrajectory();
      const [id] = connectedIds();
      await authorize(0, id);
      await join();

      await expect(manual).resolves.toEqual({
        status: "started",
        trajectoryId: id,
      });
      expect(connectedIds()).toEqual([id]);
    });

    it("warns when the runtime cannot accept capture", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      render(<App learning />);
      await act(async () => {
        pendingAuth[0].resolve(
          new Response(
            JSON.stringify({
              code: "IDENTITY_REQUIRED",
              message: "Trajectory capture requires an identified user",
            }),
            { status: 401 },
          ),
        );
      });

      expect(core.trajectoryId).toBeNull();
      expect(transport.sockets).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        "[CopilotKit] Trajectory capture did not start (IDENTITY_REQUIRED).",
      );
    });

    it("switches between the shorthand and a supplied ID", async () => {
      const view = render(<App learning />);
      view.rerender(<App learning={{ trajectoryId: SECOND_ID }} />);
      await authorize(1, SECOND_ID);
      await join();
      expect(core.trajectoryId).toBe(SECOND_ID);

      view.rerender(<App learning={{}} />);
      const [first, , third] = connectedIds();
      expect(third).toMatch(UUID);
      expect(third).not.toBe(first);

      view.rerender(<App learning={{ autoStart: false }} />);
      expect(core.trajectoryId).toBeNull();
      expect(connectedIds()).toEqual([first, SECOND_ID, third]);
    });

    it("starts the object form without a trajectoryId with a generated ID", async () => {
      render(<App learning={{}} />);

      const [id] = connectedIds();
      expect(id).toMatch(UUID);
      await authorize(0, id);
      await join();
      expect(core.trajectoryId).toBe(id);
    });

    it("keeps one Trajectory when an inline object rerenders", async () => {
      const onError = vi.fn();
      const view = render(<App learning={{ onError }} />);
      view.rerender(<App learning={{ onError }} />);
      view.rerender(<App learning={{ onError }} />);
      const [id] = connectedIds();
      await authorize(0, id);
      await join();
      view.rerender(<App learning={{ onError }} />);

      expect(connectedIds()).toEqual([id]);
      expect(core.trajectoryId).toBe(id);
      expect(transport.sockets).toHaveLength(1);
      expect(transport.sockets[0].channels[0].left).toBe(false);
    });

    it("keeps the generated ID when switching between generating forms", async () => {
      const onError = vi.fn();
      const view = render(<App learning />);
      const [id] = connectedIds();
      await authorize(0, id);
      await join();

      view.rerender(<App learning={{ onError }} />);
      view.rerender(
        <App learning={{ onError, ignoreUrls: ["https://private.invalid"] }} />,
      );

      expect(connectedIds()).toEqual([id]);
      expect(core.trajectoryId).toBe(id);
      expect(transport.sockets).toHaveLength(1);
      expect(transport.sockets[0].channels[0].left).toBe(false);
    });

    it("stops when autoStart turns off and generates a new ID when it turns on again", async () => {
      const onError = vi.fn();
      const view = render(<App learning={{ onError }} />);
      const [first] = connectedIds();
      await authorize(0, first);
      await join(0);

      view.rerender(<App learning={{ onError, autoStart: false }} />);
      expect(transport.sockets[0].channels[0].left).toBe(true);
      expect(transport.sockets[0].disconnected).toBe(true);
      expect(core.trajectoryId).toBeNull();
      expect(core.ɵlearningConfigured).toBe(true);

      view.rerender(<App learning={{ onError }} />);
      const [, second] = connectedIds();
      expect(second).toMatch(UUID);
      expect(second).not.toBe(first);
      await authorize(1, second);
      await join(1);
      expect(core.trajectoryId).toBe(second);
    });

    it("reuses the generated ID for the object form under root StrictMode", async () => {
      const onError = vi.fn();
      render(<App learning={{ onError }} />, { wrapper: StrictMode });

      const [id] = connectedIds();
      expect(id).toMatch(UUID);
      expect(connectedIds()).toEqual([id, id]);
      await authorize(0, id);
      await authorize(1, id);
      await join();
      expect(transport.sockets).toHaveLength(1);
      expect(core.trajectoryId).toBe(id);
    });
  });

  describe("autoStart: false", () => {
    it("waits for a manual start", async () => {
      render(<App learning={{ autoStart: false }} />);
      expect(fetch).not.toHaveBeenCalled();
      expect(core.ɵlearningConfigured).toBe(true);

      const start = core.startTrajectory({ trajectoryId: FIRST_ID });
      await authorize(0, FIRST_ID);
      await join();

      await expect(start).resolves.toEqual({
        status: "started",
        trajectoryId: FIRST_ID,
      });
      expect(core.trajectoryId).toBe(FIRST_ID);
    });

    it("ignores a supplied trajectoryId and warns once without the ID", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // A new inline object on every render must not repeat the warning.
      const view = render(
        <App learning={{ autoStart: false, trajectoryId: FIRST_ID }} />,
      );
      view.rerender(
        <App learning={{ autoStart: false, trajectoryId: FIRST_ID }} />,
      );
      view.rerender(
        <App learning={{ autoStart: false, trajectoryId: FIRST_ID }} />,
      );
      await act(async () => {});

      expect(fetch).not.toHaveBeenCalled();
      expect(core.trajectoryId).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(
        "[CopilotKit] learning.trajectoryId is ignored when autoStart is false",
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(FIRST_ID);
    });

    it("does not pass autoStart to Core", () => {
      const setLearningConfig = vi.spyOn(
        CopilotKitCoreReact.prototype,
        "setLearningConfig",
      );
      const view = render(
        <App learning={{ autoStart: false, routes: ["/deals"] }} />,
      );
      view.rerender(<App learning={{ autoStart: true, routes: ["/deals"] }} />);

      expect(setLearningConfig).toHaveBeenCalled();
      for (const [config] of setLearningConfig.mock.calls) {
        expect(config).toEqual({ routes: ["/deals"] });
      }
    });
  });

  it("keeps tool UI mounted through connection loss and reconnect", async () => {
    let mounts = 0;
    function Approval() {
      const [count, setCount] = React.useState(0);
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <button onClick={() => setCount((value) => value + 1)}>
          Clicked {count}
        </button>
      );
    }
    const message: AssistantMessage = {
      id: "message-1",
      role: "assistant",
      toolCalls: [
        {
          id: "tool-1",
          type: "function",
          function: { name: "approve", arguments: "{}" },
        },
      ],
    };
    render(
      <CopilotKitProvider
        runtimeUrl="/api/copilotkit"
        useSingleEndpoint
        learning={{ trajectoryId: FIRST_ID }}
        renderToolCalls={[
          defineToolCallRenderer({
            name: "approve",
            args: z.object({}),
            render: () => <Approval />,
          }),
        ]}
      >
        <CoreProbe />
        <CopilotChatToolCallsView message={message} />
      </CopilotKitProvider>,
    );
    const button = screen.getByRole("button", { name: "Clicked 0" });
    fireEvent.click(button);

    await authorize(0, FIRST_ID);
    await join(0);
    expect(core.trajectoryId).toBe(FIRST_ID);
    transport.sockets[0].disconnected = true;
    act(() => core.emitTrajectoryEvent("app.lost", {}));
    expect(core.trajectoryId).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await authorize(1, FIRST_ID);
    await join(1);
    expect(core.trajectoryId).toBe(FIRST_ID);

    expect(screen.getByRole("button", { name: "Clicked 1" })).toBe(button);
    expect(button.parentElement?.getAttribute("data-tool-call-id")).toBe(
      "tool-1",
    );
    expect(mounts).toBe(1);
  });
});
