import { EventType } from "@ag-ui/client";
import type {
  AbstractAgent,
  AgentSubscriber,
  Message,
  RunAgentInput,
} from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "../core";
import { RunHandler } from "../run-handler";

type MessagesSnapshotArgs = Parameters<
  NonNullable<AgentSubscriber["onMessagesSnapshotEvent"]>
>[0];

const userMessage = {
  id: "user-message",
  role: "user",
  content: "hello",
} as Message;

const assistantMessage = {
  id: "assistant-message",
  role: "assistant",
  content: "hi",
} as Message;

const toolMessage = {
  id: "tool-message",
  role: "tool",
  toolCallId: "tool-call",
  content: "tool result",
} as Message;

class SnapshotEmittingAgent {
  agentId = "snapshot-agent";
  threadId = "snapshot-thread";
  messages: Message[];
  state: Record<string, unknown> = {};
  snapshotResult: unknown;

  constructor(
    private readonly inputMessages: Message[],
    private readonly snapshotMessages: Message[],
    agentMessages: Message[],
  ) {
    this.messages = agentMessages;
  }

  abortRun() {}

  async detachActiveRun() {}

  setMessages(messages: Message[]) {
    this.messages = messages;
  }

  setState(state: Record<string, unknown>) {
    this.state = state;
  }

  subscribe() {
    return { unsubscribe() {} };
  }

  async runAgent(_params: unknown, subscriber?: AgentSubscriber) {
    const args = {
      event: {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: this.snapshotMessages,
      },
      input: {
        messages: this.inputMessages,
      } as RunAgentInput,
      messages: this.messages,
      state: this.state,
      agent: this as unknown as AbstractAgent,
    } as MessagesSnapshotArgs;

    this.snapshotResult = await subscriber?.onMessagesSnapshotEvent?.(args);
    return { newMessages: [] };
  }
}

function createRunHandler(): RunHandler {
  return new RunHandler(new CopilotKitCore({}));
}

async function runSnapshotCase({
  inputMessages,
  snapshotMessages,
  agentMessages,
}: {
  inputMessages: Message[];
  snapshotMessages: Message[];
  agentMessages: Message[];
}) {
  const agent = new SnapshotEmittingAgent(
    inputMessages,
    snapshotMessages,
    agentMessages,
  );

  await createRunHandler().runAgent({
    agent: agent as unknown as AbstractAgent,
  });

  return agent.snapshotResult;
}

describe("RunHandler frontend-tool snapshot suppression", () => {
  it("suppresses transient empty snapshots during frontend-tool follow-up runs", async () => {
    await expect(
      runSnapshotCase({
        inputMessages: [userMessage, assistantMessage, toolMessage],
        snapshotMessages: [],
        agentMessages: [userMessage, assistantMessage, toolMessage],
      }),
    ).resolves.toEqual({ stopPropagation: true });
  });

  it("does not suppress empty snapshots without tool results in the run input", async () => {
    await expect(
      runSnapshotCase({
        inputMessages: [userMessage],
        snapshotMessages: [],
        agentMessages: [userMessage],
      }),
    ).resolves.toBeUndefined();
  });

  it("does not suppress empty snapshots when the agent has no mounted messages", async () => {
    await expect(
      runSnapshotCase({
        inputMessages: [userMessage, toolMessage],
        snapshotMessages: [],
        agentMessages: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("does not suppress non-empty snapshots during frontend-tool follow-up runs", async () => {
    await expect(
      runSnapshotCase({
        inputMessages: [userMessage, toolMessage],
        snapshotMessages: [assistantMessage],
        agentMessages: [userMessage, toolMessage],
      }),
    ).resolves.toBeUndefined();
  });
});
