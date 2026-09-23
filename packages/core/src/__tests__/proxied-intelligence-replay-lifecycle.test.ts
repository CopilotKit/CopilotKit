import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
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

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        threadId: "saved-thread",
        runId: null,
        joinToken: "test-join-token",
        realtime: {
          clientUrl: "ws://localhost/client",
          topic: "thread:saved-thread",
        },
      }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("Intelligence replay lifecycle", () => {
  it("stays busy after a historical run error until the remaining history is restored", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost/runtime",
      runtimeMode: "intelligence",
      intelligence: { wsUrl: "ws://localhost/client" },
      transport: "rest",
      agentId: "chat",
    });
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
          { id: "later", role: "assistant", content: "Saved after the error" },
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
  it("finalizes a live connection error after replay without waiting for stream_idle", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost/runtime",
      runtimeMode: "intelligence",
      intelligence: { wsUrl: "ws://localhost/client" },
      transport: "rest",
      agentId: "chat",
    });
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
      await connecting;
      expect(onRunErrorEvent).toHaveBeenCalledOnce();
    } finally {
      await agent.detachActiveRun();
      await connecting;
    }
  });

  it.each(["socket", "channel"])(
    "resets replay phase on %s reconnect",
    async (kind) => {
      const agent = new ProxiedCopilotRuntimeAgent({
        runtimeUrl: "http://localhost/runtime",
        runtimeMode: "intelligence",
        intelligence: { wsUrl: "ws://localhost/client" },
        transport: "rest",
        agentId: "chat",
      });
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
        await connecting;
        expect(errors).toHaveBeenCalledTimes(2);
      } finally {
        await agent.detachActiveRun();
        await connecting;
      }
    },
  );

  it("does not reuse the previous replay completion when idle arrives early after rejoin", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost/runtime",
      runtimeMode: "intelligence",
      intelligence: { wsUrl: "ws://localhost/client" },
      transport: "rest",
      agentId: "chat",
    });
    const connecting = agent.connectAgent();
    try {
      await vi.waitFor(() =>
        expect(sockets[0]?.channels[0]?.joinCount).toBe(1),
      );
      const channel = sockets[0]!.channels[0]!;
      channel.triggerJoin("ok");
      channel.serverPush("replay_complete", {});
      channel.serverPush("phx_error", {});
      channel.serverPush("stream_idle", { latestEventId: "not-yet-delivered" });
      channel.serverPush("ag_ui_event", {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [
          { id: "after-rejoin", role: "assistant", content: "Still restoring" },
        ],
      });
      await vi.waitFor(() =>
        expect(agent.messages[0]?.id).toBe("after-rejoin"),
      );
      expect(agent.isRunning).toBe(true);
      channel.serverPush("replay_complete", {});
      await connecting;
      expect(agent.isRunning).toBe(false);
    } finally {
      await agent.detachActiveRun();
      await connecting;
    }
  });
});
