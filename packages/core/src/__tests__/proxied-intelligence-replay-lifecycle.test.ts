import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebugLogger, EventType } from "@ag-ui/client";
import { MockSocket } from "./test-utils";

const { sockets } = vi.hoisted(() => {
  const mockSockets: MockSocket[] = [];
  return { sockets: mockSockets };
});

vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(...args: ConstructorParameters<typeof MockSocket>) {
      super(...args);
      sockets.push(this);
    }
  },
}));

const { ProxiedCopilotRuntimeAgent } = await import("../agent");

function createReplayAgent(runtimeMode: "intelligence" | "pending") {
  return new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "http://localhost/runtime",
    runtimeMode,
    intelligence: { wsUrl: "ws://localhost/client" },
    transport: "rest",
    agentId: "chat",
  });
}

function observeDiagnostics(agent: ReturnType<typeof createReplayAgent>) {
  const logger = new DebugLogger({
    enabled: true,
    events: false,
    lifecycle: true,
    verbose: false,
  });
  const diagnostic = vi.fn();
  vi.spyOn(logger, "lifecycle").mockImplementation((prefix, label, data) => {
    if (prefix === "INTELLIGENCE") diagnostic(label, data);
  });
  agent.debugLogger = logger;
  return diagnostic;
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      Response.json(
        String(url).endsWith("/info")
          ? {
              mode: "intelligence",
              intelligence: { wsUrl: "ws://localhost/client" },
            }
          : {
              threadId: "saved-thread",
              runId: null,
              joinToken: "test-join-token",
              realtime: {
                clientUrl: "ws://localhost/client",
                topic: "thread:saved-thread",
              },
            },
      ),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe.each(["intelligence", "pending"] as const)(
  "%s Intelligence replay lifecycle",
  (runtimeMode) => {
    it.each([true, false])(
      "only logs idle diagnostics when debugging is enabled (%s)",
      async (debug) => {
        const agent = createReplayAgent(runtimeMode);
        const warning = debug ? observeDiagnostics(agent) : undefined;
        const consoleLog = vi
          .spyOn(console, "log")
          .mockImplementation(() => {});
        const consoleWarning = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});
        const connecting = agent.connectAgent();
        try {
          await vi.waitFor(() =>
            expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
          );
          const channel = sockets[0]!.channels[0]!;
          channel.triggerJoin("ok");
          vi.useFakeTimers();
          channel.serverPush("ag_ui_event", {
            type: EventType.RUN_ERROR,
            message: "Saved failure",
          });
          channel.serverPush("replay_complete", {});
          await vi.advanceTimersByTimeAsync(29_999);
          if (warning) expect(warning).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
          if (debug) {
            expect(warning).toHaveBeenCalledWith(
              expect.stringContaining("stream_idle"),
              expect.objectContaining({ threadId: "saved-thread" }),
            );
          }
          expect(agent.isRunning).toBe(true);
          await vi.advanceTimersByTimeAsync(60_000);
          if (warning) {
            expect(warning).toHaveBeenCalledOnce();
          } else {
            expect(agent.debugLogger).toBeUndefined();
            expect(consoleLog).not.toHaveBeenCalled();
          }
          expect(consoleWarning).not.toHaveBeenCalled();
          channel.serverPush("stream_idle", {});
          await connecting;
          expect(agent.isRunning).toBe(false);
        } finally {
          await agent.detachActiveRun();
          await connecting;
          vi.useRealTimers();
          consoleWarning.mockRestore();
          consoleLog.mockRestore();
        }
      },
    );

    it("resets the idle diagnostic on progress and cancels it on detach", async () => {
      const agent = createReplayAgent(runtimeMode);
      const warning = observeDiagnostics(agent);
      const connecting = agent.connectAgent();
      try {
        await vi.waitFor(() =>
          expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
        );
        const channel = sockets[0]!.channels[0]!;
        channel.triggerJoin("ok");
        vi.useFakeTimers();
        channel.serverPush("replay_complete", {});
        await vi.advanceTimersByTimeAsync(20_000);
        channel.serverPush("ag_ui_event", {
          type: EventType.STATE_SNAPSHOT,
          snapshot: { progress: 1 },
        });
        await vi.advanceTimersByTimeAsync(20_000);
        expect(warning).not.toHaveBeenCalled();
        await agent.detachActiveRun();
        await connecting;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(warning).not.toHaveBeenCalled();
      } finally {
        await agent.detachActiveRun();
        await connecting;
        vi.useRealTimers();
      }
    });

    it("does not carry the idle diagnostic deadline across reconnect", async () => {
      const agent = createReplayAgent(runtimeMode);
      const warning = observeDiagnostics(agent);
      const connecting = agent.connectAgent();
      try {
        await vi.waitFor(() =>
          expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
        );
        const channel = sockets[0]!.channels[0]!;
        channel.triggerJoin("ok");
        vi.useFakeTimers();
        channel.serverPush("replay_complete", {});
        await vi.advanceTimersByTimeAsync(20_000);
        channel.serverPush("phx_error", {});
        await vi.advanceTimersByTimeAsync(60_000);
        expect(warning).not.toHaveBeenCalled();
        channel.serverPush("replay_complete", {});
        await vi.advanceTimersByTimeAsync(30_000);
        expect(warning).toHaveBeenCalledOnce();
        channel.serverPush("stream_idle", {});
        await connecting;
      } finally {
        await agent.detachActiveRun();
        await connecting;
        vi.useRealTimers();
      }
    });

    it("stays busy after a historical run error until the remaining history is restored", async () => {
      const agent = createReplayAgent(runtimeMode);
      agent.threadId = "saved-thread";
      const onRunErrorEvent = vi.fn();
      agent.subscribe({ onRunErrorEvent });
      const connecting = agent.connectAgent();
      try {
        await vi.waitFor(() =>
          expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
        );
        const channel = sockets[0]!.channels[0]!;
        channel.triggerJoin("ok");
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_ERROR,
          message: "Runner connection dropped",
        });
        await vi.waitFor(() => expect(onRunErrorEvent).toHaveBeenCalledOnce());

        // MCP resource loading waits on isRunning. A historical error must not
        // release that queue while the replay still owns the agent.
        expect(agent.isRunning).toBe(true);

        channel.serverPush("ag_ui_event", {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            {
              id: "later",
              role: "assistant",
              content: "Saved after the error",
            },
          ],
        });
        channel.serverPush("replay_complete", {});
        channel.serverPush("stream_idle", {});
        await connecting;
        expect(agent.messages).toEqual([
          { id: "later", role: "assistant", content: "Saved after the error" },
        ]);
        expect(agent.isRunning).toBe(false);
      } finally {
        await agent.detachActiveRun();
        await connecting;
      }
    });
    it("clears busy on a live error and keeps following a successor run until idle", async () => {
      const agent = createReplayAgent(runtimeMode);
      const onRunErrorEvent = vi.fn();
      agent.subscribe({ onRunErrorEvent });
      const connecting = agent.connectAgent();
      try {
        await vi.waitFor(() =>
          expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
        );
        const channel = sockets[0]!.channels[0]!;
        channel.triggerJoin("ok");
        channel.serverPush("replay_complete", {});
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_ERROR,
          message: "Live failure",
        });
        await vi.waitFor(() => expect(agent.isRunning).toBe(false));
        expect(onRunErrorEvent).toHaveBeenCalledOnce();
        expect(channel.left).toBe(false);
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_STARTED,
          threadId: "saved-thread",
          runId: "successor",
        });
        await vi.waitFor(() => expect(agent.isRunning).toBe(true));
        channel.serverPush("ag_ui_event", {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            {
              id: "successor-message",
              role: "assistant",
              content: "From another tab",
            },
          ],
        });
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_FINISHED,
          threadId: "saved-thread",
          runId: "successor",
        });
        await vi.waitFor(() =>
          expect(agent.messages[0]?.id).toBe("successor-message"),
        );
        expect(agent.isRunning).toBe(true);
        channel.serverPush("stream_idle", {});
        await connecting;
        expect(agent.isRunning).toBe(false);
        expect(channel.left).toBe(true);
      } finally {
        await agent.detachActiveRun();
        await connecting;
      }
    });

    it("keeps the arrival-time replay phase when subscriber work is queued", async () => {
      const agent = createReplayAgent(runtimeMode);
      const busyAtError: boolean[] = [];
      agent.subscribe({
        onRunErrorEvent: () => {
          busyAtError.push(agent.isRunning);
        },
      });
      const connecting = agent.connectAgent();
      try {
        await vi.waitFor(() =>
          expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
        );
        const channel = sockets[0]!.channels[0]!;
        channel.triggerJoin("ok");
        // Do not yield between these: replay completion can arrive while the
        // asynchronous apply pipeline is still processing the historical error.
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_ERROR,
          message: "Historical",
        });
        channel.serverPush("replay_complete", {});
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_ERROR,
          message: "Live",
        });
        await vi.waitFor(() => expect(busyAtError).toEqual([true, false]));
        expect(channel.left).toBe(false);
        // A locally started operation can detach this idle listener even though
        // the live error already cleared isRunning.
        await agent.detachActiveRun();
        await connecting;
        expect(channel.left).toBe(true);
      } finally {
        await agent.detachActiveRun();
        await connecting;
      }
    });

    it.each(["socket", "channel"])(
      "resets replay phase on %s reconnect",
      async (kind) => {
        const agent = createReplayAgent(runtimeMode);
        const errors = vi.fn();
        agent.subscribe({ onRunErrorEvent: errors });
        const connecting = agent.connectAgent();
        try {
          await vi.waitFor(() =>
            expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
          );
          const socket = sockets[0]!;
          const channel = socket.channels[0]!;
          channel.triggerJoin("ok");
          channel.serverPush("replay_complete", {});
          channel.serverPush("ag_ui_event", {
            type: EventType.RUN_ERROR,
            message: "Live error before reconnect",
          });
          await vi.waitFor(() => expect(agent.isRunning).toBe(false));
          errors.mockClear();
          if (kind === "socket") socket.triggerError(new Error("disconnected"));
          else channel.serverPush("phx_error", {});
          channel.serverPush("ag_ui_event", {
            type: EventType.RUN_ERROR,
            message: "Old error after rejoin",
          });
          await vi.waitFor(() => expect(errors).toHaveBeenCalledOnce());
          expect(agent.isRunning).toBe(true);
          channel.serverPush("replay_complete", {});
          channel.serverPush("ag_ui_event", {
            type: EventType.RUN_ERROR,
            message: "Live error after rejoin",
          });
          await vi.waitFor(() => expect(agent.isRunning).toBe(false));
          expect(channel.left).toBe(false);
          channel.serverPush("stream_idle", {});
          await connecting;
          expect(errors).toHaveBeenCalledTimes(2);
        } finally {
          await agent.detachActiveRun();
          await connecting;
        }
      },
    );

    it("does not reuse the previous replay completion when idle arrives early after rejoin", async () => {
      const agent = createReplayAgent(runtimeMode);
      const diagnostic = observeDiagnostics(agent);
      const connecting = agent.connectAgent();
      try {
        await vi.waitFor(() =>
          expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
        );
        const channel = sockets[0]!.channels[0]!;
        channel.triggerJoin("ok");
        channel.serverPush("replay_complete", {});
        channel.serverPush("phx_error", {});
        channel.serverPush("stream_idle", {
          latestEventId: "not-yet-delivered",
        });
        channel.serverPush("ag_ui_event", {
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            {
              id: "after-rejoin",
              role: "assistant",
              content: "Still restoring",
            },
          ],
        });
        await vi.waitFor(() =>
          expect(agent.messages[0]?.id).toBe("after-rejoin"),
        );
        expect(agent.isRunning).toBe(true);
        channel.serverPush("replay_complete", {});
        await connecting;
        expect(agent.isRunning).toBe(false);
        expect(diagnostic).not.toHaveBeenCalled();
      } finally {
        await agent.detachActiveRun();
        await connecting;
      }
    });
    it.each(["before", "after"] as const)(
      "waits for the 100ms fallback when an error arrives %s idle without replay_complete",
      async (order) => {
        const agent = createReplayAgent(runtimeMode);
        const diagnostic = observeDiagnostics(agent);
        const errors = vi.fn();
        agent.subscribe({ onRunErrorEvent: errors });
        const connecting = agent.connectAgent();
        try {
          await vi.waitFor(() =>
            expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
          );
          const channel = sockets[0]!.channels[0]!;
          channel.triggerJoin("ok");
          vi.useFakeTimers();
          if (order === "after") channel.serverPush("stream_idle", {});
          channel.serverPush("ag_ui_event", {
            type: EventType.RUN_ERROR,
            message: "No replay boundary yet",
          });
          await vi.advanceTimersByTimeAsync(0);
          expect(errors).toHaveBeenCalledOnce();
          expect(agent.isRunning).toBe(true);
          if (order === "before") channel.serverPush("stream_idle", {});
          channel.serverPush("ag_ui_event", {
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [
              {
                id: "late-history",
                role: "assistant",
                content: "History after idle/error",
              },
            ],
          });
          await vi.advanceTimersByTimeAsync(99);
          expect(agent.isRunning).toBe(true);
          expect(diagnostic).not.toHaveBeenCalled();
          expect(agent.messages[0]?.id).toBe("late-history");
          await vi.advanceTimersByTimeAsync(1);
          await connecting;
          expect(agent.isRunning).toBe(false);
          expect(channel.left).toBe(true);
          expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining("without replay_complete"),
            expect.objectContaining({
              threadId: "saved-thread",
              fallbackMs: 100,
            }),
          );
        } finally {
          vi.useRealTimers();
          await agent.detachActiveRun();
          await connecting;
        }
      },
    );

    it.each(["socket", "channel"] as const)(
      "cancels stale idle and its fallback timer on %s reconnect",
      async (kind) => {
        const agent = createReplayAgent(runtimeMode);
        const connecting = agent.connectAgent();
        try {
          await vi.waitFor(() =>
            expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
          );
          const socket = sockets[0]!;
          const channel = socket.channels[0]!;
          channel.triggerJoin("ok");
          vi.useFakeTimers();
          channel.serverPush("stream_idle", {});
          await vi.advanceTimersByTimeAsync(50);
          if (kind === "socket") socket.triggerError(new Error("disconnected"));
          else channel.serverPush("phx_error", {});
          await vi.advanceTimersByTimeAsync(100);
          expect(agent.isRunning).toBe(true);
          // A fresh replay_complete cannot combine with the previous idle signal.
          channel.serverPush("replay_complete", {});
          await vi.advanceTimersByTimeAsync(100);
          expect(agent.isRunning).toBe(true);
          expect(channel.left).toBe(false);
          channel.serverPush("stream_idle", {});
          await vi.advanceTimersByTimeAsync(0);
          await connecting;
          expect(agent.isRunning).toBe(false);
        } finally {
          vi.useRealTimers();
          await agent.detachActiveRun();
          await connecting;
        }
      },
    );
  },
);
