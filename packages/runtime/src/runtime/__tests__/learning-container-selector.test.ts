import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { AbstractAgent } from "@ag-ui/client";
import { createChannel } from "@copilotkit/channels";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import { expect, test, vi } from "vitest";

import type { ChannelsIntelligenceModule } from "../core/channel-manager";
import { defaultActivateChannel } from "../core/channel-manager";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { handleIntelligenceRun } from "../handlers/intelligence/run";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { AgentRunner } from "../runner/agent-runner";
import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentRunnerStopRequest,
} from "../runner/agent-runner";

class TestAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    return EMPTY;
  }
}

class TestRunner extends AgentRunner {
  run(_request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return EMPTY;
  }

  connect(_request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return EMPTY;
  }

  isRunning(_request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(false);
  }

  stop(_request: AgentRunnerStopRequest): Promise<boolean> {
    return Promise.resolve(false);
  }
}

type RunCanonical = Parameters<
  ChannelsIntelligenceModule["startChannelsOverRealtimeGateway"]
>[1]["runCanonical"];

function setup(
  getLearningContainerId = vi.fn(async () => "enterprise-support"),
) {
  const user = { id: "user-1", name: "Ada Lovelace" };
  const input: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    state: { account: { plan: "enterprise" } },
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Help with an enterprise account",
      },
    ],
    tools: [],
    context: [{ description: "region", value: "eu" }],
    forwardedProps: { workspaceId: "workspace-1" },
  };
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
    getLearningContainerId,
  });
  const getOrCreateThread = vi
    .spyOn(intelligence, "getOrCreateThread")
    .mockResolvedValue({
      thread: { id: input.threadId, name: "Existing thread" },
      created: false,
    });
  vi.spyOn(intelligence, "ɵacquireThreadLock").mockRejectedValue(
    new Error("stop after thread assignment"),
  );
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence,
    identifyUser: async () => user,
  });
  const request = new Request("https://runtime.example/agent/support/run", {
    method: "POST",
  });

  return {
    agent: new TestAgent({ agentId: "support" }),
    getLearningContainerId,
    getOrCreateThread,
    input,
    request,
    runtime,
    teardown: () => vi.restoreAllMocks(),
    user,
  };
}

test("the Intelligence client rejects a non-callback Learning Container selector", () => {
  expect(() =>
    Reflect.construct(CopilotKitIntelligence, [
      {
        apiKey: "test-api-key",
        getLearningContainerId: "support-quality",
      },
    ]),
  ).toThrow(
    "CopilotKitIntelligence `getLearningContainerId` must be a callback",
  );
});

test("the runtime rejects public and deprecated Learning Container selectors together", () => {
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    getLearningContainerId: () => "support-quality",
  });

  expect(
    () =>
      new CopilotIntelligenceRuntime({
        agents: {},
        intelligence,
        identifyUser: async () => ({ id: "user-1", name: "Ada Lovelace" }),
        ɵlearning: { containerId: "support-quality" },
      }),
  ).toThrow(
    "Configure Learning Containers with `getLearningContainerId` on `CopilotKitIntelligence`",
  );
});

test("an invalid selected Learning Container ID stops the web run", async () => {
  const selector = vi.fn(async () => "Invalid Container");
  const { agent, getOrCreateThread, input, request, runtime, teardown } =
    setup(selector);

  try {
    const response = await handleIntelligenceRun({
      runtime,
      request,
      agentId: "support",
      agent,
      input,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to resolve Learning Container",
    });
    expect(selector).toHaveBeenCalledOnce();
    expect(getOrCreateThread).not.toHaveBeenCalled();
  } finally {
    teardown();
  }
});

test("a null Learning Container selection leaves the Thread unassigned", async () => {
  const selector = vi.fn(async () => null);
  const { agent, getOrCreateThread, input, request, runtime, teardown, user } =
    setup(selector);

  try {
    const response = await handleIntelligenceRun({
      runtime,
      request,
      agentId: "support",
      agent,
      input,
    });

    expect(response.status).toBe(502);
    expect(getOrCreateThread).toHaveBeenCalledWith({
      threadId: input.threadId,
      userId: user.id,
      agentId: "support",
    });
  } finally {
    teardown();
  }
});

test("the Intelligence selector receives the resolved user and AG-UI run input", async () => {
  const {
    agent,
    getLearningContainerId,
    getOrCreateThread,
    input,
    request,
    runtime,
    teardown,
    user,
  } = setup();

  try {
    const response = await handleIntelligenceRun({
      runtime,
      request,
      agentId: "support",
      agent,
      input,
    });

    expect(response.status).toBe(502);
    expect(getLearningContainerId).toHaveBeenCalledOnce();
    expect(getLearningContainerId).toHaveBeenCalledWith({
      surface: "web",
      user,
      agentId: "support",
      input,
    });
    expect(getOrCreateThread).toHaveBeenCalledWith({
      threadId: input.threadId,
      userId: user.id,
      agentId: "support",
      learningContainerId: "enterprise-support",
    });
  } finally {
    teardown();
  }
});

test("the Intelligence selector receives the Channel user and canonical run input", async () => {
  const user = { id: "user-2", name: "Grace Hopper" };
  const getLearningContainerId = vi.fn(async () => "channel-support");
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
    getLearningContainerId,
  });
  vi.spyOn(intelligence, "ɵacquireThreadLock").mockRejectedValue(
    new Error("stop after Channel assignment"),
  );
  let runCanonical: RunCanonical | undefined;
  const importer = async (): Promise<ChannelsIntelligenceModule> => ({
    startChannelsOverRealtimeGateway: async (_channels, options) => {
      runCanonical = options.runCanonical;
      return { metadata: {}, stop: async () => undefined };
    },
  });
  await defaultActivateChannel(
    {
      wsUrl: "wss://intelligence.example",
      apiUrl: "https://intelligence.example",
      apiKey: "test-api-key",
      projectId: 42,
      channelName: "support",
      runtimeInstanceId: "runtime-1",
    },
    createChannel({ identifyUser: "platform", name: "support" }),
    importer,
    undefined,
    { runner: new TestRunner(), intelligence },
  );
  if (!runCanonical) throw new Error("runCanonical was not configured");
  const agent = new TestAgent({
    agentId: "support",
    initialMessages: [
      {
        id: "message-2",
        role: "user",
        content: "A Channel question",
      },
    ],
    initialState: { source: "slack" },
  });
  const tools = [
    {
      name: "lookup-account",
      description: "Look up one account",
      parameters: { type: "object" },
    },
  ];
  const context = [{ description: "channel", value: "support" }];
  const channelRun = {
    agent,
    deliveryId: "delivery-1",
    threadId: "thread-2",
    runId: "run-2",
    user,
    userId: user.id,
    agentId: "support",
    tools,
    context,
    persistedInputMessages: agent.messages,
    execute: async () => ({ iterations: 1, interrupted: false }),
  };

  try {
    await expect(runCanonical(channelRun)).rejects.toThrow(
      "stop after Channel assignment",
    );

    expect(getLearningContainerId).toHaveBeenCalledOnce();
    expect(getLearningContainerId).toHaveBeenCalledWith({
      surface: "channel",
      user,
      agentId: "support",
      input: {
        threadId: "thread-2",
        runId: "run-2",
        messages: agent.messages,
        state: agent.state,
        tools,
        context,
        forwardedProps: undefined,
      },
    });
    expect(intelligence.ɵacquireThreadLock).toHaveBeenCalledWith(
      expect.objectContaining({ learningContainerId: "channel-support" }),
    );
  } finally {
    vi.restoreAllMocks();
  }
});
