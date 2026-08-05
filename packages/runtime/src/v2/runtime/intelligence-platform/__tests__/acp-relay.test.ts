import type { AnyMessage } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { MockSocket } from "../../../../../../core/src/__tests__/test-utils";
import type { MockChannel } from "../../../../../../core/src/__tests__/test-utils";
import { openAcpRelayStream } from "../acp-relay";

const openRelay = async () => {
  const socket = new MockSocket();
  const opening = openAcpRelayStream({
    afterSequence: 17,
    joinToken: "acpj_client_token_0123456789",
    sessionId: "019fcf74-08bf-75cd-af71-2021d7e7d05f",
    socketFactory: (url, options) => {
      socket.url = url;
      socket.opts = options;
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

  it("fails the stream instead of reconnecting or replaying an uncertain write", async () => {
    const { channel, opening, socket } = await openRelay();
    channel.triggerJoin("ok", {});
    channel.serverPush("replay_complete", { highWatermark: 17 });
    const stream = await opening;
    const pendingRead = stream.readable.getReader().read();

    socket.triggerClose({ code: 1006 });

    await expect(pendingRead).rejects.toThrow("ACP relay disconnected");
    expect(socket.disconnected).toBe(true);
    expect(socket.channels).toHaveLength(1);
  });

  it("rejects a failed channel join", async () => {
    const { channel, opening, socket } = await openRelay();

    channel.triggerJoin("error", { reason: "session_not_found" });

    await expect(opening).rejects.toThrow("session_not_found");
    expect(socket.disconnected).toBe(true);
  });
});
