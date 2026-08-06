import type { AnyMessage } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { MockSocket } from "../../../../../../core/src/__tests__/test-utils";
import type { MockChannel } from "../../../../../../core/src/__tests__/test-utils";
import { openAcpRelayStream } from "../acp-relay";

const openRelay = async (options?: {
  readonly replayTimeoutMs?: number;
  readonly signal?: AbortSignal;
}) => {
  const socket = new MockSocket();
  const opening = openAcpRelayStream({
    afterSequence: 17,
    joinToken: "acpj_client_token_0123456789",
    ...options,
    sessionId: "019fcf74-08bf-75cd-af71-2021d7e7d05f",
    socketFactory: (url, socketOptions) => {
      socket.url = url;
      socket.opts = socketOptions;
      return socket;
    },
    wsUrl: "wss://realtime.example.com/acp",
  });
  await vi.waitFor(() => expect(socket.channels).toHaveLength(1));
  const channel = socket.channels[0] as MockChannel;
  return { channel, opening, socket };
};

describe("ACP relay stream", () => {
  it("uses one scoped client token and waits for durable replay", async () => {
    const { channel, opening, socket } = await openRelay();
    let opened = false;
    opening.then(() => {
      opened = true;
    });

    expect(socket.url).toBe("wss://realtime.example.com/acp");
    expect(socket.opts.params).toEqual({
      joinToken: "acpj_client_token_0123456789",
      role: "client",
    });
    expect(channel.topic).toBe("session:019fcf74-08bf-75cd-af71-2021d7e7d05f");
    expect(channel.params).toEqual({
      afterSequence: 17,
      protocol: "acp_relay_v1",
    });
    channel.triggerJoin("ok", {});
    await Promise.resolve();
    expect(opened).toBe(false);

    channel.serverPush("replay_complete", { highWatermark: 17 });

    await expect(opening).resolves.toBeDefined();
  });

  it("carries unchanged JSON-RPC frames in both directions", async () => {
    const { channel, opening } = await openRelay();
    channel.triggerJoin("ok", {});
    channel.serverPush("replay_complete", { highWatermark: 17 });
    const stream = await opening;
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const inbound: AnyMessage = {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "remote-1",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [],
        },
      },
    };

    channel.serverPush("message", {
      frame: inbound,
      protocol: "acp_relay_v1",
      senderMessageId: "agent-1",
      sequence: 18,
    });

    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: inbound,
    });

    const outbound: AnyMessage = {
      id: 0,
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: 1 },
    };
    const writing = writer.write(outbound);
    await vi.waitFor(() => expect(channel.pushLog).toHaveLength(1));
    expect(channel.pushLog[0]).toMatchObject({
      event: "message",
      payload: {
        frame: outbound,
        protocol: "acp_relay_v1",
        senderMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    channel.pushLog[0]?.push.trigger("ok", {
      duplicate: false,
      sequence: 19,
    });
    await expect(writing).resolves.toBeUndefined();
  });

  it("ends the transport when its one-use-token socket closes", async () => {
    const { channel, opening, socket } = await openRelay();
    channel.triggerJoin("ok", {});
    channel.serverPush("replay_complete", { highWatermark: 17 });
    const stream = await opening;
    const pendingRead = stream.readable.getReader().read();

    socket.triggerClose({ code: 1006 });

    await expect(pendingRead).rejects.toThrow("socket closed");
    expect(socket.disconnected).toBe(true);
  });

  it("retries an uncertain write with the same sender id", async () => {
    const { channel, opening } = await openRelay();
    channel.triggerJoin("ok", {});
    channel.serverPush("replay_complete", { highWatermark: 17 });
    const writer = (await opening).writable.getWriter();

    const writing = writer.write({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: 1 },
    });
    await vi.waitFor(() => expect(channel.pushLog).toHaveLength(1));
    channel.pushLog[0]?.push.trigger("timeout");
    await vi.waitFor(() => expect(channel.pushLog).toHaveLength(2));

    expect(channel.pushLog[1]?.payload.senderMessageId).toBe(
      channel.pushLog[0]?.payload.senderMessageId,
    );
    channel.pushLog[1]?.push.trigger("ok", {
      duplicate: true,
      sequence: 18,
    });
    await expect(writing).resolves.toBeUndefined();
  });

  it("rejects an unacknowledged write when the socket closes", async () => {
    const { channel, opening, socket } = await openRelay();
    channel.triggerJoin("ok", {});
    channel.serverPush("replay_complete", { highWatermark: 17 });
    const writer = (await opening).writable.getWriter();

    const writing = writer.write({
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: { protocolVersion: 1 },
    });
    await vi.waitFor(() => expect(channel.pushLog).toHaveLength(1));
    const writeFailure = expect(writing).rejects.toThrow("socket closed");

    socket.triggerClose({ code: 1006 });

    await writeFailure;
  });

  it("times out when replay never reaches its barrier", async () => {
    const { channel, opening } = await openRelay({ replayTimeoutMs: 10 });
    channel.triggerJoin("ok", {});

    await expect(opening).rejects.toThrow("replay timed out");
  });

  it("aborts an opening relay", async () => {
    const controller = new AbortController();
    const { opening } = await openRelay({ signal: controller.signal });

    controller.abort();

    await expect(opening).rejects.toThrow("aborted");
  });

  it("fails the stream when the server normally closes the session channel", async () => {
    const { channel, opening, socket } = await openRelay();
    channel.triggerJoin("ok", {});
    channel.serverPush("replay_complete", { highWatermark: 17 });
    const stream = await opening;
    const pendingRead = stream.readable.getReader().read();

    channel.triggerClose();

    await expect(pendingRead).rejects.toThrow("ACP relay channel closed");
    expect(socket.disconnected).toBe(true);
  });

  it("surfaces peer and replay failures pushed before channel closure", async () => {
    const peer = await openRelay();
    peer.channel.triggerJoin("ok", {});
    peer.channel.serverPush("replay_complete", { highWatermark: 17 });
    const peerStream = await peer.opening;
    const peerRead = peerStream.readable.getReader().read();

    peer.channel.serverPush("peer_disconnected", { role: "agent" });

    await expect(peerRead).rejects.toThrow("ACP relay peer disconnected");

    const replay = await openRelay();
    replay.channel.triggerJoin("ok", {});
    replay.channel.serverPush("relay_error", { reason: "replay_unavailable" });

    await expect(replay.opening).rejects.toThrow("replay_unavailable");
  });

  it("rejects a failed channel join", async () => {
    const { channel, opening, socket } = await openRelay();

    channel.triggerJoin("error", { reason: "session_not_found" });

    await expect(opening).rejects.toThrow("session_not_found");
    expect(socket.disconnected).toBe(true);
  });
});
