import {
  PROTOCOL_VERSION,
  client as createClientApp,
  methods,
} from "@agentclientprotocol/sdk";
import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { startExternalAcpRelay } from "../../../integrations/acp-agent/src/external/acp-relay";
import { createShowcaseFixtureAgent } from "../../../integrations/acp-agent/src/external/fixture-agent";

class MockPush {
  private readonly handlers = new Map<
    string,
    Array<(payload?: unknown) => void>
  >();

  receive(status: string, callback: (payload?: unknown) => void): MockPush {
    const current = this.handlers.get(status) ?? [];
    current.push(callback);
    this.handlers.set(status, current);
    return this;
  }

  trigger(status: string, payload?: unknown): void {
    for (const handler of this.handlers.get(status) ?? []) handler(payload);
  }
}

class MockChannel {
  readonly events = new Map<string, Array<(payload: unknown) => void>>();
  readonly joins: MockPush[] = [];
  readonly pushes: Array<{ event: string; payload: object; push: MockPush }> =
    [];
  readonly errorHandlers: Array<(payload?: unknown) => void> = [];
  readonly closeHandlers: Array<() => void> = [];
  leaveCount = 0;
  autoAcknowledge = true;

  constructor(
    readonly topic: string,
    readonly params: object | (() => object),
  ) {}

  join(): MockPush {
    const push = new MockPush();
    this.joins.push(push);
    queueMicrotask(() => push.trigger("ok"));
    return push;
  }

  leave(): void {
    this.leaveCount += 1;
  }

  on(event: string, callback: (payload: unknown) => void): void {
    const current = this.events.get(event) ?? [];
    current.push(callback);
    this.events.set(event, current);
  }

  onError(callback: (payload?: unknown) => void): void {
    this.errorHandlers.push(callback);
  }

  onClose(callback: () => void): void {
    this.closeHandlers.push(callback);
  }

  push(event: string, payload: object): MockPush {
    const push = new MockPush();
    this.pushes.push({ event, payload, push });
    if (this.autoAcknowledge) queueMicrotask(() => push.trigger("ok"));
    return push;
  }

  emit(event: string, payload: unknown): void {
    for (const handler of this.events.get(event) ?? []) handler(payload);
  }

  emitError(payload?: unknown): void {
    for (const handler of this.errorHandlers) handler(payload);
  }
}

class MockSocket {
  readonly channels: MockChannel[] = [];
  readonly errorHandlers: Array<(payload?: unknown) => void> = [];
  readonly closeHandlers: Array<() => void> = [];
  connectCount = 0;
  disconnectCount = 0;

  channel(topic: string, params: object | (() => object)): MockChannel {
    const channel = new MockChannel(topic, params);
    this.channels.push(channel);
    return channel;
  }

  connect(): void {
    this.connectCount += 1;
  }

  disconnect(): void {
    this.disconnectCount += 1;
  }

  onError(callback: (payload?: unknown) => void): void {
    this.errorHandlers.push(callback);
  }

  onClose(callback: () => void): void {
    this.closeHandlers.push(callback);
  }

  emitError(payload?: unknown): void {
    for (const handler of this.errorHandlers) handler(payload);
  }

  emitClose(): void {
    for (const handler of this.closeHandlers) handler();
  }
}

const frame = (id: number): AnyMessage => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: {},
});

const streamPair = (): { readonly agent: Stream; readonly client: Stream } => {
  const clientToAgent = new TransformStream<AnyMessage, AnyMessage>();
  const agentToClient = new TransformStream<AnyMessage, AnyMessage>();
  return {
    agent: {
      readable: clientToAgent.readable,
      writable: agentToClient.writable,
    },
    client: {
      readable: agentToClient.readable,
      writable: clientToAgent.writable,
    },
  };
};

describe("ACP Showcase external relay conformance", () => {
  it("latches cancellation that arrives before the fixture starts waiting", async () => {
    const streams = streamPair();
    const fixture = createShowcaseFixtureAgent().connect(streams.agent);
    const client = createClientApp({
      name: "fixture cancellation test",
    }).connect(streams.client);
    await client.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "fixture cancellation test", version: "1" },
    });
    const session = await client.agent.request(methods.agent.session.new, {
      cwd: "/workspace",
      mcpServers: [],
    });

    await client.agent.notify(methods.agent.session.cancel, {
      sessionId: session.sessionId,
    });
    await expect(
      client.agent.request(methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "wait for cancellation" }],
      }),
    ).resolves.toEqual({ stopReason: "cancelled" });

    client.close();
    fixture.close();
  });

  it("stops an ordinary streaming prompt after cancellation", async () => {
    const streams = streamPair();
    const fixture = createShowcaseFixtureAgent().connect(streams.agent);
    let textChunks = 0;
    const client = createClientApp({ name: "fixture streaming cancel test" })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (params.update.sessionUpdate === "agent_message_chunk") {
          textChunks += 1;
        }
      })
      .connect(streams.client);
    await client.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "fixture streaming cancel test", version: "1" },
    });
    const session = await client.agent.request(methods.agent.session.new, {
      cwd: "/workspace",
      mcpServers: [],
    });

    const prompting = client.agent.request(methods.agent.session.prompt, {
      sessionId: session.sessionId,
      prompt: [
        {
          type: "text",
          text: "Explain this request in enough detail to produce many fixture chunks.",
        },
      ],
    });
    await vi.waitFor(() => expect(textChunks).toBeGreaterThan(0));
    await client.agent.notify(methods.agent.session.cancel, {
      sessionId: session.sessionId,
    });
    const chunksAtCancel = textChunks;

    await expect(prompting).resolves.toEqual({ stopReason: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(textChunks).toBe(chunksAtCancel);

    client.close();
    fixture.close();
  });

  it("authenticates one target and carries unchanged frames after replay", async () => {
    const socket = new MockSocket();
    let socketOptions: unknown;
    const handled = vi.fn();
    const relay = startExternalAcpRelay({
      agentId: "showcase-agent",
      apiKey: "project-key",
      runtimeInstanceId: "rti_showcase_acp",
      wsUrl: "wss://realtime.example.test/acp",
      onSession: (session) => {
        handled(session);
      },
      socketFactory: (_url, options) => {
        socketOptions = options;
        return socket;
      },
    });

    await relay.ready;
    expect(socket.connectCount).toBe(1);
    expect(socketOptions).toMatchObject({
      authToken: "project-key",
      params: {
        agentId: "showcase-agent",
        role: "agent",
        runtimeInstanceId: "rti_showcase_acp",
      },
    });
    const control = socket.channels[0]!;
    expect(control.topic).toBe("control");

    control.emit("session_available", {
      lastSequence: 0,
      protocol: "acp_relay_v1",
      remoteSessionId: null,
      sessionId: "session-1",
      threadId: "thread-1",
    });
    const sessionChannel = socket.channels[1]!;
    expect(sessionChannel.params).toEqual({
      afterSequence: 0,
      protocol: "acp_relay_v1",
    });
    expect(handled).not.toHaveBeenCalled();

    sessionChannel.emit("message", {
      frame: frame(1),
      protocol: "acp_relay_v1",
      senderMessageId: "client-message-1",
      sequence: 1,
    });
    sessionChannel.emit("replay_complete", { highWatermark: 1 });
    await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
    const session = handled.mock.calls[0]![0];
    const reader = session.stream.readable.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: frame(1),
    });
    sessionChannel.emit("message", {
      frame: frame(99),
      protocol: "acp_relay_v1",
      senderMessageId: "client-message-1-retry",
      sequence: 1,
    });
    sessionChannel.emit("message", {
      frame: frame(3),
      protocol: "acp_relay_v1",
      senderMessageId: "client-message-3",
      sequence: 3,
    });
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: frame(3),
    });
    const writer = session.stream.writable.getWriter();
    await writer.write(frame(2));
    expect(sessionChannel.pushes[0]).toMatchObject({
      event: "message",
      payload: {
        frame: frame(2),
        protocol: "acp_relay_v1",
        senderMessageId: expect.any(String),
      },
    });

    control.emit("session_available", {
      lastSequence: 1,
      protocol: "acp_relay_v1",
      remoteSessionId: null,
      sessionId: "session-1",
      threadId: "thread-1",
    });
    expect(socket.channels).toHaveLength(2);

    const pendingRead = reader.read();
    sessionChannel.emitError("gateway restart");
    await expect(pendingRead).rejects.toThrow("channel failed");
    expect(sessionChannel.leaveCount).toBe(1);

    relay.close();
    await relay.closed;
    expect(sessionChannel.leaveCount).toBe(1);
    expect(control.leaveCount).toBe(1);
    expect(socket.disconnectCount).toBe(1);
  });

  it("retries an uncertain fixture write with one stable sender id", async () => {
    const socket = new MockSocket();
    let session:
      | Parameters<
          NonNullable<Parameters<typeof startExternalAcpRelay>[0]["onSession"]>
        >[0]
      | undefined;
    const relay = startExternalAcpRelay({
      agentId: "showcase-agent",
      apiKey: "project-key",
      runtimeInstanceId: "rti_showcase_acp",
      wsUrl: "wss://realtime.example.test/acp",
      onSession: (nextSession) => {
        session = nextSession;
      },
      socketFactory: () => socket,
    });
    await relay.ready;
    socket.channels[0]!.emit("session_available", {
      lastSequence: 0,
      protocol: "acp_relay_v1",
      remoteSessionId: null,
      sessionId: "session-retry",
      threadId: "thread-retry",
    });
    const channel = socket.channels[1]!;
    channel.autoAcknowledge = false;
    channel.emit("replay_complete", { highWatermark: 0 });
    await vi.waitFor(() => expect(session).toBeDefined());

    const writing = session!.stream.writable.getWriter().write(frame(4));
    await vi.waitFor(() => expect(channel.pushes).toHaveLength(1));
    channel.pushes[0]!.push.trigger("timeout");
    await vi.waitFor(() => expect(channel.pushes).toHaveLength(2));
    expect(channel.pushes[1]!.payload).toMatchObject({
      senderMessageId: (
        channel.pushes[0]!.payload as { senderMessageId: string }
      ).senderMessageId,
    });
    channel.pushes[1]!.push.trigger("ok", { duplicate: true, sequence: 4 });
    await expect(writing).resolves.toBeUndefined();

    relay.close();
    await relay.closed;
  });

  it("rejects pending writes and the sidecar lifecycle on socket loss", async () => {
    const socket = new MockSocket();
    let session:
      | Parameters<
          NonNullable<Parameters<typeof startExternalAcpRelay>[0]["onSession"]>
        >[0]
      | undefined;
    const relay = startExternalAcpRelay({
      agentId: "showcase-agent",
      apiKey: "project-key",
      runtimeInstanceId: "rti_showcase_acp",
      wsUrl: "wss://realtime.example.test/acp",
      onSession: (nextSession) => {
        session = nextSession;
      },
      socketFactory: () => socket,
    });
    await relay.ready;
    socket.channels[0]!.emit("session_available", {
      lastSequence: 0,
      protocol: "acp_relay_v1",
      remoteSessionId: null,
      sessionId: "session-terminal-write",
      threadId: "thread-terminal-write",
    });
    const channel = socket.channels[1]!;
    channel.autoAcknowledge = false;
    channel.emit("replay_complete", { highWatermark: 0 });
    await vi.waitFor(() => expect(session).toBeDefined());

    const writing = session!.stream.writable.getWriter().write(frame(8));
    await vi.waitFor(() => expect(channel.pushes).toHaveLength(1));
    const writeFailure = expect(writing).rejects.toThrow("socket failed");
    const lifecycleFailure = expect(relay.closed).rejects.toThrow(
      "socket failed",
    );

    socket.emitError("gateway unavailable");

    await writeFailure;
    await lifecycleFailure;
  });

  it("rejects malformed invitations and closes only the failed session", async () => {
    const socket = new MockSocket();
    const errors: Error[] = [];
    const relay = startExternalAcpRelay({
      agentId: "showcase-agent",
      apiKey: "project-key",
      runtimeInstanceId: "rti_showcase_acp",
      wsUrl: "wss://realtime.example.test/acp",
      onSession: vi.fn(),
      onError: (error) => errors.push(error),
      socketFactory: () => socket,
    });
    await relay.ready;
    const control = socket.channels[0]!;

    control.emit("session_available", {
      lastSequence: -1,
      protocol: "acp_relay_v1",
      sessionId: "bad",
    });
    expect(socket.channels).toHaveLength(1);
    expect(errors[0]?.message).toContain("invalid relay invitation");

    control.emit("session_available", {
      lastSequence: 4,
      protocol: "acp_relay_v1",
      remoteSessionId: "remote-1",
      sessionId: "session-2",
      threadId: "thread-2",
    });
    const sessionChannel = socket.channels[1]!;
    sessionChannel.emit("message", {
      frame: frame(3),
      protocol: "acp_relay_v1",
      sequence: 3,
    });
    expect(errors.at(-1)?.message).toContain("invalid frame envelope");
    expect(sessionChannel.leaveCount).toBe(1);
    expect(control.leaveCount).toBe(0);

    relay.close();
    await relay.closed;
  });
});
