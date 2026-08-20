import { describe, expect, it, vi } from "vitest";
import type { AnyTextAdapter } from "@tanstack/ai";
import { createChannel } from "./create-channel.js";
import type { ChannelTask, ChannelTaskAdapter } from "./tasks.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";

const task: ChannelTask = {
  id: "task_support_01",
  surfaceId: "surface_support_01",
  goal: "Escalate urgent support requests",
  when: {
    kind: "event",
    event: "message",
    rule: "The customer says the issue blocks production",
  },
  enabled: true,
  createdBy: {
    kind: "application",
    applicationId: "runtime_support",
  },
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
};

function taskModel(selectedTaskId: string | null): {
  model: AnyTextAdapter;
  structuredOutput: ReturnType<typeof vi.fn>;
} {
  const structuredOutput = vi.fn().mockResolvedValue({
    data: { taskId: selectedTaskId },
    rawText: JSON.stringify({ taskId: selectedTaskId }),
  });
  return {
    model: {
      kind: "text",
      name: "task-test",
      model: "task-test",
      structuredOutput,
      chatStream: vi.fn(),
      "~types": {},
    } as unknown as AnyTextAdapter,
    structuredOutput,
  };
}

function adapterWithTasks(tasks: ChannelTask[]): {
  adapter: FakeAdapter & { channelTasks: ChannelTaskAdapter };
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
} {
  const adapter = new FakeAdapter({ messageEvents: true }) as FakeAdapter & {
    channelTasks: ChannelTaskAdapter;
  };
  const list = vi.fn().mockResolvedValue(tasks);
  const create = vi.fn().mockResolvedValue(task);
  adapter.channelTasks = {
    create,
    list,
    update: vi.fn(),
    delete: vi.fn(),
  };
  return { adapter, list, create };
}

const messageTurn = {
  conversationKey: "thread_support_01",
  replyTarget: {},
  userText: "Production is down",
  platform: "slack",
  surfaceId: "surface_support_01",
  occurredAt: "2026-08-01T10:01:00.000Z",
  actor: { id: "U123", kind: "human" as const },
  identityContext: {
    tenant: { id: "T123" },
    installation: { id: "installation_123" },
    conversation: { id: "C123", kind: "channel" },
    trigger: "message",
    event: {
      id: "evt_support_01",
      occurredAt: "2026-08-01T10:01:00.000Z",
    },
    raw: {},
  },
  operation: {
    kind: "created" as const,
    logicalMessageId: "message_support_01",
    revisionId: "revision_support_01",
    mentioned: false,
  },
};

describe("Channel Tasks", () => {
  it("rejects startup when only the Task model or handler is configured", async () => {
    const { model } = taskModel(null);
    const modelOnly = createChannel({
      identifyUser: "platform",
      name: "support",
      adapters: [new FakeAdapter()],
      tasks: { model },
    });
    const handlerOnly = createChannel({
      identifyUser: "platform",
      name: "support",
      adapters: [new FakeAdapter()],
    });
    handlerOnly.onTask(vi.fn());

    await expect(modelOnly.ɵruntime.start()).rejects.toThrow(
      "must configure both tasks.model and exactly one onTask handler",
    );
    await expect(handlerOnly.ɵruntime.start()).rejects.toThrow(
      "must configure both tasks.model and exactly one onTask handler",
    );
  });

  it("loads exact candidates, runs one structured match, and invokes only onTask", async () => {
    const { model, structuredOutput } = taskModel(task.id);
    const { adapter, list } = adapterWithTasks([task]);
    const channel = createChannel({
      identifyUser: "platform",
      name: "support",
      adapters: [adapter],
      tasks: { model },
    });
    const ordinary = vi.fn();
    const onTask = vi.fn();
    channel.onMessage(ordinary);
    channel.onTask(onTask);

    await channel.ɵruntime.start();
    await adapter.getSink().onTurn(messageTurn);

    expect(list).toHaveBeenCalledWith(
      { surfaceId: "surface_support_01", event: "message", enabled: true },
      expect.objectContaining({ replyTarget: messageTurn.replyTarget }),
    );
    expect(structuredOutput).toHaveBeenCalledOnce();
    expect(onTask).toHaveBeenCalledWith({
      task,
      cause: {
        kind: "event",
        actor: expect.objectContaining({ id: "U123", kind: "human" }),
        event: expect.objectContaining({
          kind: "message",
          text: "Production is down",
          mentioned: false,
        }),
      },
      thread: expect.anything(),
    });
    expect(ordinary).not.toHaveBeenCalled();
  });

  it("skips the model with no candidates and falls back on matcher failure", async () => {
    const noCandidatesModel = taskModel(null);
    const noCandidatesAdapter = adapterWithTasks([]);
    const noCandidates = createChannel({
      identifyUser: "platform",
      adapters: [noCandidatesAdapter.adapter],
      tasks: { model: noCandidatesModel.model },
    });
    const noCandidatesOrdinary = vi.fn();
    noCandidates.onMessage(noCandidatesOrdinary);
    noCandidates.onTask(vi.fn());
    await noCandidates.ɵruntime.start();
    await noCandidatesAdapter.adapter.getSink().onTurn(messageTurn);

    expect(noCandidatesModel.structuredOutput).not.toHaveBeenCalled();
    expect(noCandidatesOrdinary).toHaveBeenCalledOnce();

    const failingModel = taskModel(task.id);
    failingModel.structuredOutput.mockRejectedValueOnce(new Error("offline"));
    const failingAdapter = adapterWithTasks([task]);
    const failing = createChannel({
      identifyUser: "platform",
      adapters: [failingAdapter.adapter],
      tasks: { model: failingModel.model },
    });
    const failingOrdinary = vi.fn();
    failing.onMessage(failingOrdinary);
    failing.onTask(vi.fn());
    await failing.ɵruntime.start();
    await failingAdapter.adapter.getSink().onTurn(messageTurn);

    expect(failingOrdinary).toHaveBeenCalledOnce();
  });

  it("does not match message updates or system-authored events", async () => {
    const { model, structuredOutput } = taskModel(task.id);
    const { adapter, list } = adapterWithTasks([task]);
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      tasks: { model },
    });
    const ordinary = vi.fn();
    channel.onMessage(ordinary);
    channel.onTask(vi.fn());
    await channel.ɵruntime.start();

    await adapter.getSink().onTurn({
      ...messageTurn,
      operation: { ...messageTurn.operation, kind: "updated" },
    });
    await adapter.getSink().onTurn({
      ...messageTurn,
      actor: { id: "B123", kind: "system" },
      operation: {
        ...messageTurn.operation,
        logicalMessageId: "message_support_02",
        revisionId: "revision_support_02",
      },
    });

    expect(list).not.toHaveBeenCalled();
    expect(structuredOutput).not.toHaveBeenCalled();
    expect(ordinary).toHaveBeenCalledTimes(2);
  });

  it("lets onTask choose an agent for only that run", async () => {
    const { model } = taskModel(task.id);
    const { adapter } = adapterWithTasks([task]);
    const defaultAgent = new FakeAgent();
    defaultAgent.agentId = "default-agent";
    const taskAgent = new FakeAgent();
    taskAgent.agentId = "task-agent";
    const selectedAgentIds: string[] = [];
    const getOrCreate = adapter.conversationStore.getOrCreate.bind(
      adapter.conversationStore,
    );
    adapter.conversationStore.getOrCreate = async (key, target, makeAgent) => {
      const session = await getOrCreate(key, target, makeAgent);
      selectedAgentIds.push(session.agent.agentId ?? "");
      return session;
    };
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      agent: defaultAgent,
      tasks: { model },
    });
    channel.onTask(async ({ thread, task: selectedTask }) => {
      await thread.runAgent({ agent: taskAgent, prompt: selectedTask.goal });
    });

    await channel.ɵruntime.start();
    await adapter.getSink().onTurn(messageTurn);

    expect(selectedAgentIds).toEqual(["task-agent"]);
  });

  it("Task tools use the current trusted surface instead of model scope", async () => {
    const { model } = taskModel(task.id);
    const { adapter, create } = adapterWithTasks([task]);
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      tasks: { model },
    });
    let taskThread: unknown;
    channel.onTask(({ thread }) => {
      taskThread = thread;
    });
    await channel.ɵruntime.start();
    await adapter.getSink().onTurn(messageTurn);

    const tool = channel.tasks.tools.find(
      (candidate) => candidate.name === "create_channel_task",
    );
    await tool?.handler(
      {
        goal: "Send a daily prompt",
        when: {
          kind: "schedule",
          cron: "0 9 * * 1-5",
          timeZone: "America/Los_Angeles",
        },
      },
      {
        thread: taskThread as never,
        user: null,
        actor: { id: "model-spoof", kind: "app" },
        platform: "slack",
      },
    );

    expect(create).toHaveBeenCalledWith(
      {
        surfaceId: "surface_support_01",
        goal: "Send a daily prompt",
        when: {
          kind: "schedule",
          cron: "0 9 * * 1-5",
          timeZone: "America/Los_Angeles",
        },
      },
      expect.objectContaining({
        replyTarget: messageTurn.replyTarget,
        actor: expect.objectContaining({ id: "U123" }),
      }),
    );
  });

  it("matches only reaction-added candidates and skips ordinary reactions", async () => {
    const reactionTask: ChannelTask = {
      ...task,
      id: "task_reaction_01",
      when: {
        kind: "event",
        event: "reaction_added",
        rule: "The reaction is a warning",
      },
    };
    const { model } = taskModel(reactionTask.id);
    const { adapter, list } = adapterWithTasks([reactionTask]);
    const channel = createChannel({
      identifyUser: "platform",
      adapters: [adapter],
      tasks: { model },
    });
    const onTask = vi.fn();
    const ordinary = vi.fn();
    channel.onTask(onTask);
    channel.onReaction(ordinary);
    await channel.ɵruntime.start();

    await adapter.getSink().onReaction({
      conversationKey: "thread_support_01",
      replyTarget: {},
      platform: "slack",
      surfaceId: "surface_support_01",
      occurredAt: "2026-08-01T10:02:00.000Z",
      rawEmoji: "warning",
      added: true,
      messageId: "message_support_01",
      actor: { id: "U123", kind: "human" },
      identityContext: messageTurn.identityContext,
      raw: {},
    });

    expect(list).toHaveBeenCalledWith(
      {
        surfaceId: "surface_support_01",
        event: "reaction_added",
        enabled: true,
      },
      expect.anything(),
    );
    expect(onTask).toHaveBeenCalledOnce();
    expect(ordinary).not.toHaveBeenCalled();
  });
});
