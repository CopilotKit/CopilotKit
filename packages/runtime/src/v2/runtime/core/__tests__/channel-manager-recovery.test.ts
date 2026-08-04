import { expect, test, vi } from "vitest";
import { createChannel } from "@copilotkit/channels";
import {
  RealtimeGatewayJoinError,
  RealtimeGatewayUnreachableError,
} from "@copilotkit/channels-intelligence";
import { CopilotKitIntelligence } from "../../intelligence-platform";
import { ChannelManager } from "../channel-manager";
import type { ActivateChannelEngine, ChannelsHandle } from "../channel-manager";

interface RecoverySetup {
  manager: ChannelManager;
  activateChannel: ReturnType<typeof vi.fn<ActivateChannelEngine>>;
  cleanup(): Promise<void>;
}

type ConnectionState = "online" | "reconnecting" | "gave_up";

interface ReconnectLoggingSetup {
  manager: ChannelManager;
  logs: string[];
  fireState(state: ConnectionState): void;
  cleanup(): Promise<void>;
}

/** Create a gateway error with the cross-package retry contract. */
function gatewayError(retryable: boolean): Error {
  return new RealtimeGatewayUnreachableError(
    "wss://runtime.example/channels",
    "the gateway host answered HTTP 502",
    30_000,
    { retryable },
  );
}

/** Create a structured gateway drain rejection from a connected socket. */
function gatewayDrainError(): Error {
  return new RealtimeGatewayJoinError({
    reason: "gateway_draining",
    retryable: true,
  });
}

/** Build one isolated manager whose first gateway activation is unavailable. */
function setupRecovery(firstError = gatewayError(true)): RecoverySetup {
  vi.useFakeTimers();
  const handle: ChannelsHandle = {
    metadata: {},
    stop: vi.fn(async () => {}),
  };
  const activateChannel = vi
    .fn<ActivateChannelEngine>()
    .mockRejectedValueOnce(firstError)
    .mockResolvedValue(handle);
  const manager = new ChannelManager({
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    }),
    channels: [createChannel({ identifyUser: "platform", name: "support" })],
    activateChannel,
  });

  return {
    manager,
    activateChannel,
    async cleanup() {
      await manager.stop();
      vi.useRealTimers();
    },
  };
}

/** Build one isolated online manager whose connection state is test-driven. */
function setupReconnectLogging(): ReconnectLoggingSetup {
  vi.useFakeTimers();
  let stateListener: ((state: ConnectionState) => void) | undefined;
  const handle: ChannelsHandle = {
    metadata: {},
    stop: vi.fn(async () => {}),
    onStateChange(listener: (state: ConnectionState) => void) {
      stateListener = listener;
    },
  };
  const logs: string[] = [];
  const manager = new ChannelManager({
    intelligence: new CopilotKitIntelligence({
      apiUrl: "https://runtime.example",
      wsUrl: "wss://runtime.example",
      apiKey: "cpk-42_short_long",
    }),
    channels: [createChannel({ identifyUser: "platform", name: "support" })],
    activateChannel: vi.fn(async () => handle),
    log: (message: string) => logs.push(message),
  });

  return {
    manager,
    logs,
    fireState(state: ConnectionState) {
      stateListener?.(state);
    },
    async cleanup() {
      await manager.stop();
      vi.useRealTimers();
    },
  };
}

test("a transient initial gateway outage retries until the channel is online", async () => {
  const { manager, activateChannel, cleanup } = setupRecovery();

  try {
    manager.activate();
    await vi.advanceTimersByTimeAsync(0);

    expect(activateChannel).toHaveBeenCalledTimes(1);
    expect(manager.status().channels.support).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(999);
    expect(activateChannel).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(manager.ready()).resolves.toBeUndefined();
    expect(activateChannel).toHaveBeenCalledTimes(2);
    expect(manager.status().channels.support).toBe("online");
  } finally {
    await cleanup();
  }
});

test("a retryable initial gateway drain join retries until online", async () => {
  const { manager, activateChannel, cleanup } =
    setupRecovery(gatewayDrainError());

  try {
    manager.activate();
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.status().channels.support).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(manager.ready()).resolves.toBeUndefined();
    expect(activateChannel).toHaveBeenCalledTimes(2);
    expect(manager.status().channels.support).toBe("online");
  } finally {
    await cleanup();
  }
});

test("a permanent initial gateway error remains terminal", async () => {
  const { manager, activateChannel, cleanup } = setupRecovery(
    gatewayError(false),
  );

  try {
    manager.activate();
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.status().channels.support).toBe("error");
    await expect(manager.ready()).rejects.toThrow(AggregateError);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(activateChannel).toHaveBeenCalledTimes(1);
  } finally {
    await cleanup();
  }
});

test("stopping the manager cancels a pending activation retry", async () => {
  const { manager, activateChannel, cleanup } = setupRecovery();

  try {
    manager.activate();
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.status().channels.support).toBe("reconnecting");

    await manager.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(activateChannel).toHaveBeenCalledTimes(1);
    expect(manager.status().channels.support).toBe("stopped");
  } finally {
    await cleanup();
  }
});

test("a prolonged established-session outage backs off reminder logs", async () => {
  const { manager, logs, fireState, cleanup } = setupReconnectLogging();

  try {
    manager.activate();
    await manager.ready();
    fireState("reconnecting");
    const stillDownLogs = () =>
      logs.filter((line) => line.includes("still down"));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(stillDownLogs()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(stillDownLogs()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(stillDownLogs()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(stillDownLogs()).toHaveLength(3);

    fireState("online");
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(stillDownLogs()).toHaveLength(3);
  } finally {
    await cleanup();
  }
});
