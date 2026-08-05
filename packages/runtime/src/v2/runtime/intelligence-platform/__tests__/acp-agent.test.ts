import {
  PROTOCOL_VERSION,
  agent as createAgentApp,
  methods,
} from "@agentclientprotocol/sdk";
import type {
  AgentApp,
  AgentRequestHandler,
  AnyMessage,
  PromptRequest,
  PromptResponse,
  Stream,
} from "@agentclientprotocol/sdk";
import { EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { lastValueFrom, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { AcpAgent } from "../acp-agent";
import type { AcpAgentPlatform } from "../acp-agent";

const input: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  state: {},
  messages: [{ id: "user-1", role: "user", content: "Hello" }],
  tools: [],
  context: [],
  forwardedProps: {},
};

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

interface FixtureOptions {
  readonly app: AgentApp;
  readonly initialRemoteSessionId?: string;
}

const createPlatform = ({ app, initialRemoteSessionId }: FixtureOptions) => {
  let remoteSessionId = initialRemoteSessionId ?? null;
  const connections: ReturnType<AgentApp["connect"]>[] = [];
  const saveRemoteSessionId = vi.fn(async (nextRemoteSessionId: string) => {
    remoteSessionId = nextRemoteSessionId;
  });
  const platform: AcpAgentPlatform = {
    ɵopenAcpRelay: vi.fn(async () => {
      const streams = streamPair();
      const connection = app.connect(streams.agent);
      connections.push(connection);
      return {
        relaySessionId: "019fcf74-08bf-75cd-af71-2021d7e7d05f",
        remoteSessionId,
        stream: streams.client,
        saveRemoteSessionId,
      };
    }),
  };

  return {
    close: () => connections.forEach((connection) => connection.close()),
    platform,
    saveRemoteSessionId,
  };
};

const baseAgentApp = (handlers?: {
  readonly loadSession?: boolean;
  readonly onPrompt?: AgentRequestHandler<PromptRequest, PromptResponse>;
}): AgentApp =>
  createAgentApp({ name: "ACP test fixture" })
    .onRequest(methods.agent.initialize, ({ params }) => ({
      protocolVersion: params.protocolVersion,
      agentCapabilities: { loadSession: handlers?.loadSession ?? true },
      agentInfo: { name: "ACP test fixture", version: "1.0.0" },
    }))
    .onRequest(methods.agent.session.new, () => ({ sessionId: "remote-1" }))
    .onRequest(methods.agent.session.load, () => ({}))
    .onRequest(
      methods.agent.session.prompt,
      handlers?.onPrompt ??
        (async ({ params, client }) => {
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Hello from ACP" },
            },
          });
          return { stopReason: "end_turn" };
        }),
    )
    .onNotification(methods.agent.session.cancel, () => undefined);

const createAgent = (platform: AcpAgentPlatform): AcpAgent =>
  new AcpAgent({
    intelligence: platform,
    userId: "customer-user-1",
    runtimeInstanceId: "rti_external_01",
    agentId: "coding-agent",
    cwd: "/workspace",
  });

describe("AcpAgent", () => {
  it("creates an external ACP session and translates its stable v1 updates", async () => {
    const app = baseAgentApp();
    const fixture = createPlatform({ app });
    const agent = createAgent(fixture.platform);

    const events = await lastValueFrom(agent.run(input).pipe(toArray()));
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(events.at(-1)).toMatchObject({
      result: { acp: { stopReason: "end_turn" } },
    });
    expect(fixture.platform.ɵopenAcpRelay).toHaveBeenCalledWith({
      agentId: "coding-agent",
      appUserId: "customer-user-1",
      runtimeInstanceId: "rti_external_01",
      threadId: "thread-1",
    });
    expect(fixture.saveRemoteSessionId).toHaveBeenCalledWith("remote-1");
    fixture.close();
  });

  it("loads the durable remote session before sending a later prompt", async () => {
    const order: string[] = [];
    const app = createAgentApp({ name: "load fixture" })
      .onRequest(methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(methods.agent.session.new, () => {
        order.push("new");
        return { sessionId: "unexpected" };
      })
      .onRequest(methods.agent.session.load, ({ params }) => {
        order.push(`load:${params.sessionId}`);
        return {};
      })
      .onRequest(methods.agent.session.prompt, ({ params }) => {
        order.push(`prompt:${params.prompt[0]?.type}`);
        return { stopReason: "end_turn" };
      })
      .onNotification(methods.agent.session.cancel, () => undefined);
    const fixture = createPlatform({
      app,
      initialRemoteSessionId: "remote-existing",
    });

    await lastValueFrom(createAgent(fixture.platform).run(input));

    expect(order).toEqual(["load:remote-existing", "prompt:text"]);
    expect(fixture.saveRemoteSessionId).not.toHaveBeenCalled();
    fixture.close();
  });

  it("keeps a permission request open across an AG-UI interrupt resume", async () => {
    const responses: unknown[] = [];
    const app = baseAgentApp({
      onPrompt: async ({ params, client }) => {
        const response = await client.request(
          methods.client.session.requestPermission,
          {
            sessionId: params.sessionId,
            toolCall: { toolCallId: "tool-1", title: "Edit source" },
            options: [
              {
                optionId: "allow-once",
                name: "Allow once",
                kind: "allow_once",
              },
            ],
          },
        );
        responses.push(response);
        return { stopReason: "end_turn" };
      },
    });
    const fixture = createPlatform({ app });
    const agent = createAgent(fixture.platform);

    const interrupted = await lastValueFrom(agent.run(input).pipe(toArray()));
    const outcome =
      interrupted.at(-1)?.type === EventType.RUN_FINISHED
        ? (interrupted.at(-1)?.outcome as
            | {
                readonly type?: string;
                readonly interrupts?: readonly { readonly id: string }[];
              }
            | undefined)
        : undefined;
    const interruptId =
      outcome?.type === "interrupt" ? outcome.interrupts?.[0]?.id : undefined;
    expect(interruptId).toBeDefined();

    const resumed = await lastValueFrom(
      agent
        .clone()
        .run({
          ...input,
          runId: "run-2",
          resume: [
            {
              interruptId: interruptId!,
              status: "resolved",
              payload: { optionId: "allow-once" },
            },
          ],
        })
        .pipe(toArray()),
    );

    expect(resumed.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
    expect(responses).toEqual([
      { outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    expect(fixture.platform.ɵopenAcpRelay).toHaveBeenCalledOnce();
    fixture.close();
  });

  it("sends session/cancel to the external agent and accepts its final result", async () => {
    let finishPrompt: (() => void) | undefined;
    const cancelled = vi.fn(() => {
      finishPrompt?.();
    });
    const app = createAgentApp({ name: "cancel fixture" })
      .onRequest(methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: "remote-1" }))
      .onRequest(methods.agent.session.load, () => ({}))
      .onRequest(methods.agent.session.prompt, async () => {
        await new Promise<void>((resolve) => {
          finishPrompt = resolve;
        });
        return { stopReason: "cancelled" };
      })
      .onNotification(methods.agent.session.cancel, cancelled);
    const fixture = createPlatform({ app });
    const agent = createAgent(fixture.platform);
    const result = lastValueFrom(agent.run(input).pipe(toArray()));
    await vi.waitFor(() =>
      expect(fixture.saveRemoteSessionId).toHaveBeenCalledWith("remote-1"),
    );

    agent.abortRun();

    const events = await result;
    expect(cancelled).toHaveBeenCalledWith(
      expect.objectContaining({ params: { sessionId: "remote-1" } }),
    );
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      result: { acp: { stopReason: "cancelled" } },
    });
    fixture.close();
  });

  it("fails closed when a durable session cannot be loaded", async () => {
    const app = baseAgentApp({ loadSession: false });
    const fixture = createPlatform({
      app,
      initialRemoteSessionId: "remote-existing",
    });

    const events = await lastValueFrom(
      createAgent(fixture.platform).run(input).pipe(toArray()),
    );

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: "acp_session_load_unsupported",
    });
    fixture.close();
  });

  it("does not open another relay or replay a prompt after transport loss", async () => {
    const platform: AcpAgentPlatform = {
      ɵopenAcpRelay: vi.fn(async () => {
        const readable = new ReadableStream<AnyMessage>({
          start(controller) {
            controller.error(new Error("relay disconnected"));
          },
        });
        return {
          relaySessionId: "019fcf74-08bf-75cd-af71-2021d7e7d05f",
          remoteSessionId: null,
          stream: {
            readable,
            writable: new WritableStream<AnyMessage>(),
          },
          saveRemoteSessionId: vi.fn(),
        };
      }),
    };

    const events = await lastValueFrom(
      createAgent(platform).run(input).pipe(toArray()),
    );

    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_ERROR,
      code: "acp_transport_error",
    });
    expect(platform.ɵopenAcpRelay).toHaveBeenCalledOnce();
  });

  it("advertises stable protocol support without client-side file or terminal tools", async () => {
    const initialize = vi.fn(({ params }) => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      received: params,
    }));
    const app = createAgentApp({ name: "capability fixture" })
      .onRequest(methods.agent.initialize, initialize)
      .onRequest(methods.agent.session.new, () => ({ sessionId: "remote-1" }))
      .onRequest(methods.agent.session.load, () => ({}))
      .onRequest(methods.agent.session.prompt, () => ({
        stopReason: "end_turn",
      }))
      .onNotification(methods.agent.session.cancel, () => undefined);
    const fixture = createPlatform({ app });
    const agent = createAgent(fixture.platform);

    await lastValueFrom(agent.run(input));

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {
            auth: { terminal: false },
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        }),
      }),
    );
    await expect(agent.getCapabilities()).resolves.toEqual({
      transport: { streaming: true },
      humanInTheLoop: { interrupts: true },
    });
    fixture.close();
  });
});
