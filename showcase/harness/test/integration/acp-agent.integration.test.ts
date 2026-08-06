import { agent as createAgentApp, methods } from "@agentclientprotocol/sdk";
import type {
  AgentApp,
  AgentRequestHandler,
  AnyMessage,
  PromptRequest,
  PromptResponse,
  Stream,
} from "@agentclientprotocol/sdk";
import { AcpAgent } from "../../../../packages/runtime/src/v2/runtime/intelligence-platform/acp-agent";
import type { AcpAgentPlatform } from "../../../../packages/runtime/src/v2/runtime/intelligence-platform/acp-agent";
import { lastValueFrom, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";

type AcpRunInput = Parameters<AcpAgent["run"]>[0];

const input = (runId: string, resume?: AcpRunInput["resume"]): AcpRunInput => ({
  threadId: "showcase-acp-thread",
  runId,
  state: {},
  messages: [{ id: "user-1", role: "user", content: "Inspect this project." }],
  tools: [],
  context: [],
  forwardedProps: {},
  ...(resume ? { resume } : {}),
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

const createPlatform = (app: AgentApp) => {
  let remoteSessionId: string | null = null;
  const connections: ReturnType<AgentApp["connect"]>[] = [];
  const saveRemoteSessionId = vi.fn(async (sessionId: string) => {
    remoteSessionId = sessionId;
  });
  const platform: AcpAgentPlatform = {
    ɵopenAcpRelay: vi.fn(async () => {
      const streams = streamPair();
      connections.push(app.connect(streams.agent));
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

const createShowcaseAgent = (platform: AcpAgentPlatform): AcpAgent =>
  new AcpAgent({
    intelligence: platform,
    userId: "showcase-user-1",
    runtimeInstanceId: "rti_showcase_relay_01",
    agentId: "showcase-acp",
    cwd: "/workspace",
    permissionMode: "live",
  });

const firstInterruptId = (
  event: { readonly outcome?: unknown; readonly type: string } | undefined,
): string | undefined => {
  if (event?.type !== "RUN_FINISHED") return undefined;
  const outcome = event.outcome;
  if (
    typeof outcome !== "object" ||
    outcome === null ||
    !("type" in outcome) ||
    outcome.type !== "interrupt" ||
    !("interrupts" in outcome) ||
    !Array.isArray(outcome.interrupts)
  ) {
    return undefined;
  }
  const first = outcome.interrupts[0];
  return typeof first === "object" &&
    first !== null &&
    "id" in first &&
    typeof first.id === "string"
    ? first.id
    : undefined;
};

const fixtureApp = (
  onPrompt: AgentRequestHandler<PromptRequest, PromptResponse>,
): AgentApp =>
  createAgentApp({ name: "ACP Showcase fixture" })
    .onRequest(methods.agent.initialize, ({ params }) => ({
      protocolVersion: params.protocolVersion,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "ACP Showcase fixture", version: "1.0.0" },
    }))
    .onRequest(methods.agent.session.new, () => ({
      sessionId: "showcase-remote-session",
    }))
    .onRequest(methods.agent.session.load, () => ({}))
    .onRequest(methods.agent.session.prompt, onPrompt)
    .onNotification(methods.agent.session.cancel, () => undefined);

describe("ACP Agent Showcase public contract", () => {
  it("translates reasoning, plans, tools, and text from a stable ACP agent", async () => {
    const app = fixtureApp(async ({ params, client }) => {
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId: "thought-1",
          content: { type: "text", text: "Inspect the package graph" },
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "plan",
          entries: [
            {
              content: "Read the package manifest",
              priority: "high",
              status: "in_progress",
            },
          ],
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "read-1",
          title: "Read package.json",
          kind: "read",
          status: "in_progress",
          rawInput: { path: "package.json" },
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "read-1",
          status: "completed",
          rawOutput: { bytes: 2048 },
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "answer-1",
          content: { type: "text", text: "I found the integration." },
        },
      });
      return { stopReason: "end_turn" };
    });
    const fixture = createPlatform(app);

    const events = await lastValueFrom(
      createShowcaseAgent(fixture.platform)
        .run(input("showcase-run-rich"))
        .pipe(toArray()),
    );

    expect(events.map((event) => event.type)).toEqual([
      "RUN_STARTED",
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "ACTIVITY_SNAPSHOT",
      "ACTIVITY_SNAPSHOT",
      "ACTIVITY_SNAPSHOT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
    expect(fixture.platform.ɵopenAcpRelay).toHaveBeenCalledWith({
      agentId: "showcase-acp",
      appUserId: "showcase-user-1",
      runtimeInstanceId: "rti_showcase_relay_01",
      signal: expect.any(AbortSignal),
      threadId: "showcase-acp-thread",
    });
    expect(fixture.saveRemoteSessionId).toHaveBeenCalledWith(
      "showcase-remote-session",
    );
    fixture.close();
  });

  it("resumes an ACP permission request on the same live agent coordinator", async () => {
    const permissionResponses: unknown[] = [];
    const app = fixtureApp(async ({ params, client }) => {
      permissionResponses.push(
        await client.request(methods.client.session.requestPermission, {
          sessionId: params.sessionId,
          toolCall: { toolCallId: "edit-1", title: "Edit source" },
          options: [
            {
              optionId: "allow-once",
              name: "Allow once",
              kind: "allow_once",
            },
          ],
        }),
      );
      return { stopReason: "end_turn" };
    });
    const fixture = createPlatform(app);
    const agent = createShowcaseAgent(fixture.platform);

    const interrupted = await lastValueFrom(
      agent.run(input("showcase-run-interrupt")).pipe(toArray()),
    );
    const interruptId = firstInterruptId(interrupted.at(-1));
    expect(interruptId).toBeDefined();

    const resumed = await lastValueFrom(
      agent
        .clone()
        .run(
          input("showcase-run-resume", [
            {
              interruptId: interruptId!,
              status: "resolved",
              payload: { optionId: "allow-once" },
            },
          ]),
        )
        .pipe(toArray()),
    );

    expect(resumed.map((event) => event.type)).toEqual([
      "RUN_STARTED",
      "RUN_FINISHED",
    ]);
    expect(permissionResponses).toEqual([
      { outcome: { outcome: "selected", optionId: "allow-once" } },
    ]);
    expect(fixture.platform.ɵopenAcpRelay).toHaveBeenCalledOnce();
    fixture.close();
  });

  it("sends ACP cancellation before the external prompt completes", async () => {
    let finishPrompt: (() => void) | undefined;
    const cancelled = vi.fn(() => finishPrompt?.());
    const app = createAgentApp({ name: "ACP cancel fixture" })
      .onRequest(methods.agent.initialize, ({ params }) => ({
        protocolVersion: params.protocolVersion,
        agentCapabilities: { loadSession: true },
      }))
      .onRequest(methods.agent.session.new, () => ({
        sessionId: "showcase-remote-session",
      }))
      .onRequest(methods.agent.session.load, () => ({}))
      .onRequest(methods.agent.session.prompt, async () => {
        await new Promise<void>((resolve) => {
          finishPrompt = resolve;
        });
        return { stopReason: "cancelled" };
      })
      .onNotification(methods.agent.session.cancel, cancelled);
    const fixture = createPlatform(app);
    const agent = createShowcaseAgent(fixture.platform);
    const result = lastValueFrom(
      agent.run(input("showcase-run-cancel")).pipe(toArray()),
    );
    await vi.waitFor(() =>
      expect(fixture.saveRemoteSessionId).toHaveBeenCalledWith(
        "showcase-remote-session",
      ),
    );

    agent.abortRun();

    const events = await result;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({
      type: "RUN_FINISHED",
      result: { acp: { stopReason: "cancelled" } },
    });
    fixture.close();
  });
});
