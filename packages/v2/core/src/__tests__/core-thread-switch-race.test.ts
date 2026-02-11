import type { AbstractAgent } from "@ag-ui/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createMessage,
  createTool,
  createToolCallMessage,
} from "./test-utils";

describe("CopilotKitCore.runAgent - Thread switch race condition", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not insert specific tool result into wrong thread when messages are cleared during execution", async () => {
    const toolCallMessage = createToolCallMessage("slowTool");

    const agent = new MockAgent({
      messages: [toolCallMessage],
      newMessages: [toolCallMessage],
    });

    const tool = createTool({
      name: "slowTool",
      handler: vi.fn(async () => {
        // Simulate thread switch: connectAgent clears messages and loads new thread
        agent.messages = [
          createMessage({ id: "thread-b-msg", content: "Thread B message" }),
        ];
        return "result-from-old-thread";
      }),
      followUp: false,
    });
    copilotKitCore.addTool(tool);
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as unknown as AbstractAgent,
    });

    await copilotKitCore.runAgent({ agent: agent as unknown as AbstractAgent });

    // The tool result from the old thread should NOT appear in Thread B's messages
    expect(agent.messages.some((m) => m.role === "tool")).toBe(false);
    // Thread B's message should be untouched
    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0]?.id).toBe("thread-b-msg");
  });

  it("should not insert wildcard tool result into wrong thread when messages are cleared during execution", async () => {
    const toolCallMessage = createToolCallMessage("unknownTool");

    const agent = new MockAgent({
      messages: [toolCallMessage],
      newMessages: [toolCallMessage],
    });

    const wildcardTool = createTool({
      name: "*",
      handler: vi.fn(async () => {
        // Simulate thread switch: connectAgent clears messages and loads new thread
        agent.messages = [
          createMessage({ id: "thread-b-msg", content: "Thread B message" }),
        ];
        return "result-from-old-thread";
      }),
      followUp: false,
    });
    copilotKitCore.addTool(wildcardTool);
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as unknown as AbstractAgent,
    });

    await copilotKitCore.runAgent({ agent: agent as unknown as AbstractAgent });

    // The tool result from the old thread should NOT appear in Thread B's messages
    expect(agent.messages.some((m) => m.role === "tool")).toBe(false);
    // Thread B's message should be untouched
    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0]?.id).toBe("thread-b-msg");
  });

  it("should not trigger follow-up run when parent message is gone after thread switch", async () => {
    const toolCallMessage = createToolCallMessage("followUpTool");

    // Use a counter so mock only returns tool call messages on the first run
    let runCount = 0;
    const agent = new MockAgent({
      messages: [toolCallMessage],
      newMessages: [toolCallMessage],
      runAgentCallback: () => {
        runCount++;
        if (runCount > 1) {
          agent.setNewMessages([]);
        }
      },
    });

    const tool = createTool({
      name: "followUpTool",
      handler: vi.fn(async () => {
        // Simulate thread switch mid-execution
        agent.messages = [];
        return "done";
      }),
      followUp: true,
    });
    copilotKitCore.addTool(tool);
    copilotKitCore.addAgent__unsafe_dev_only({
      id: "test",
      agent: agent as unknown as AbstractAgent,
    });

    await copilotKitCore.runAgent({ agent: agent as unknown as AbstractAgent });

    // runAgent should have been called only once (the initial call),
    // not a second time for a follow-up
    expect(agent.runAgentCalls).toHaveLength(1);
  });
});
