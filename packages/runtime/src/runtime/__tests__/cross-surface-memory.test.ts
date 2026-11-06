import { afterEach, expect, test, vi } from "vitest";
import {
  createChannel,
  FakeAdapter,
  FakeAgent,
} from "@copilotkit/channels-core";
import type {
  ChannelAgentLifecycleArgs,
  MemoryGrant as ChannelMemoryGrant,
  ResolvedChannelMemory,
} from "@copilotkit/channels-core";
import { CopilotRuntime } from "../core/runtime";
import { handleCreateMemory } from "../handlers/handle-memories";
import { CopilotKitIntelligence } from "../intelligence-platform";

const activeChannels: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(activeChannels.splice(0).map((channel) => channel.stop()));
  vi.restoreAllMocks();
});

class ContractMemoryStore {
  private readonly users = new Map<string, string[]>();
  private readonly project: string[] = [];

  /** Save one test fact under the same user/project domains as Intelligence Memory. */
  save(scope: "user" | "project", userId: string, content: string): void {
    if (scope === "project") {
      this.project.push(content);
      return;
    }
    const memories = this.users.get(userId) ?? [];
    this.users.set(userId, [...memories, content]);
  }

  /** Recall only the scopes selected by the immutable per-run grant. */
  recall(memory: ResolvedChannelMemory): string[] {
    return [
      ...(memory.grant.user === "none"
        ? []
        : (this.users.get(memory.user?.id ?? "") ?? [])),
      ...(memory.grant.project === "none" ? [] : this.project),
    ];
  }
}

function intelligence(): CopilotKitIntelligence {
  return new CopilotKitIntelligence({
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
    apiKey: "cpk-42_short_long",
  });
}

function memoryAdapter(
  platform: "slack" | "teams",
  execute: (
    memory: ResolvedChannelMemory,
    lifecycle: ChannelAgentLifecycleArgs,
  ) => void | Promise<void>,
): FakeAdapter {
  const adapter = new FakeAdapter({ platform });
  adapter.supportsIntelligenceMemory = true;
  adapter.runAgentLifecycle = async (args: ChannelAgentLifecycleArgs) => {
    if (!args.memory) throw new Error("expected an explicit Memory grant");
    await execute(args.memory, args);
    return args.execute(args.renderer.subscriber, undefined);
  };
  return adapter;
}

function linkedUser(actorId: string): { id: string; name: string } | null {
  const mapping: Record<string, { id: string; name: string }> = {
    "slack-alice": { id: "person-42", name: "Alice" },
    "teams-alice": { id: "person-42", name: "Alice" },
    "slack-bob": { id: "person-99", name: "Bob" },
  };
  return mapping[actorId] ?? null;
}

async function startChannel(args: {
  adapters: FakeAdapter[];
  memory: ChannelMemoryGrant;
}) {
  const channel = createChannel({
    name: "cross-surface-contract",
    identifyUser: ({ actor }) => linkedUser(actor.id),
    adapters: args.adapters,
    agent: () => new FakeAgent(),
  });
  channel.onMessage(async ({ thread }) => {
    await thread.runAgent({ memory: args.memory });
  });
  await channel.ɵruntime.start();
  activeChannels.push({ stop: () => channel.ɵruntime.stop() });
  return channel;
}

test("Memory saved on web is recalled from Slack through one canonical user", async () => {
  const store = new ContractMemoryStore();
  const recalled: string[][] = [];
  const slack = memoryAdapter("slack", (memory) => {
    recalled.push(store.recall(memory));
  });
  const channel = await startChannel({
    adapters: [slack],
    memory: { user: "read" },
  });
  const platform = intelligence();
  vi.spyOn(platform, "createMemory").mockImplementation(async (input) => {
    store.save(
      input.scope === "project" ? "project" : "user",
      input.userId,
      input.content,
    );
    return {
      id: "memory-1",
      kind: input.kind,
      scope: input.scope ?? "user",
      content: input.content,
      sourceThreadIds: input.sourceThreadIds ?? [],
      invalidatedAt: null,
    };
  });
  const identifyUser = vi.fn(async () => ({ id: "person-42", name: "Alice" }));
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence: platform,
    identifyUser,
    memory: {
      access: () => ({ user: "read-write", project: "none" }),
    },
    channels: [channel],
  });
  const request = new Request("https://app.example/api/copilotkit/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "topical",
      scope: "user",
      content: "Prefers oat milk",
    }),
  });

  const response = await handleCreateMemory({ runtime, request });
  expect(response.status).toBe(201);
  expect(identifyUser).toHaveBeenCalledTimes(1);

  await slack.getSink().onTurn({
    conversationKey: "slack-thread",
    replyTarget: {},
    userText: "What milk do I prefer?",
    platform: "slack",
    actor: { id: "slack-alice", kind: "human", name: "Alice" },
  });

  expect(recalled).toEqual([["Prefers oat milk"]]);
});

test("Memory saved from Slack is recalled from Teams through the same mapping", async () => {
  const store = new ContractMemoryStore();
  const teamsRecall: string[][] = [];
  const slack = memoryAdapter("slack", (memory) => {
    store.save("user", memory.user!.id, "Uses compact table rows");
  });
  const teams = memoryAdapter("teams", (memory) => {
    teamsRecall.push(store.recall(memory));
  });
  await startChannel({
    adapters: [slack, teams],
    memory: { user: "read-write" },
  });

  await slack.getSink().onTurn({
    conversationKey: "slack-thread",
    replyTarget: {},
    userText: "Remember my display preference",
    platform: "slack",
    actor: { id: "slack-alice", kind: "human", name: "Alice" },
  });
  await teams.getSink().onTurn({
    conversationKey: "teams-thread",
    replyTarget: {},
    userText: "What display style do I use?",
    platform: "teams",
    actor: { id: "teams-alice", kind: "human", name: "Alice" },
  });

  expect(teamsRecall).toEqual([["Uses compact table rows"]]);
});

test("Alice and Bob share one Channel Thread but receive isolated user Memory", async () => {
  const store = new ContractMemoryStore();
  store.save("user", "person-42", "Alice likes oat milk");
  store.save("user", "person-99", "Bob likes soy milk");
  store.save("project", "", "Support hours start at 09:00");
  const observations: Array<{
    threadId: string;
    userId: string | null;
    memories: string[];
  }> = [];
  const slack = memoryAdapter("slack", (memory, lifecycle) => {
    observations.push({
      threadId: lifecycle.agent.threadId,
      userId: memory.user?.id ?? null,
      memories: store.recall(memory),
    });
  });
  await startChannel({
    adapters: [slack],
    memory: { user: "read", project: "read" },
  });

  for (const actor of [
    { id: "slack-alice", kind: "human" as const, name: "Alice" },
    { id: "slack-bob", kind: "human" as const, name: "Bob" },
  ]) {
    await slack.getSink().onTurn({
      conversationKey: "shared-provider-thread",
      replyTarget: {},
      userText: "Recall my preference and the support hours",
      platform: "slack",
      actor,
    });
  }

  expect(observations).toEqual([
    {
      threadId: "shared-provider-thread",
      userId: "person-42",
      memories: ["Alice likes oat milk", "Support hours start at 09:00"],
    },
    {
      threadId: "shared-provider-thread",
      userId: "person-99",
      memories: ["Bob likes soy milk", "Support hours start at 09:00"],
    },
  ]);
});
