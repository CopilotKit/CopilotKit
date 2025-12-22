import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import { FrontendTool } from "../types";
import {
  MockAgent,
  createAssistantMessage,
  createToolCallMessage,
  createMultipleToolCallsMessage,
  createTool,
} from "./test-utils";

describe("CopilotKitCore.runAgent - Follow-up Logic", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should trigger recursive call when tool.followUp is true", async () => {
    const tool = createTool({
      name: "followUpTool",
      handler: vi.fn(async () => "Result"),
      followUp: true,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("followUpTool");
    const followUpMessage = createAssistantMessage({ content: "Follow-up response" });
    
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([followUpMessage]);
      }
    };

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(2);
    expect(result.newMessages).toContain(followUpMessage);
  });

  it("should not trigger recursive call when tool.followUp is false", async () => {
    const tool = createTool({
      name: "noFollowUpTool",
      handler: vi.fn(async () => "Result"),
      followUp: false,
    });
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("noFollowUpTool");
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should trigger recursive call when tool.followUp is undefined (default)", async () => {
    const tool: FrontendTool = {
      name: "defaultFollowUpTool",
      handler: vi.fn(async () => "Result"),
      // followUp is undefined
    };
    copilotKitCore.addTool(tool);

    const message = createToolCallMessage("defaultFollowUpTool");
    const followUpMessage = createAssistantMessage({ content: "Follow-up" });
    
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([followUpMessage]);
      }
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(2);
  });

  it("should trigger follow-up when at least one tool needs it", async () => {
    const tool1 = createTool({
      name: "tool1",
      handler: vi.fn(async () => "Result 1"),
      followUp: false,
    });
    const tool2 = createTool({
      name: "tool2",
      handler: vi.fn(async () => "Result 2"),
      followUp: true,
    });
    const tool3 = createTool({
      name: "tool3",
      handler: vi.fn(async () => "Result 3"),
      followUp: false,
    });
    copilotKitCore.addTool(tool1);
    copilotKitCore.addTool(tool2);
    copilotKitCore.addTool(tool3);

    const message = createMultipleToolCallsMessage([
      { name: "tool1" },
      { name: "tool2" },
      { name: "tool3" },
    ]);
    
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([]);
      }
    };

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(2);
  });

  it("should not trigger follow-up when all tools have followUp=false", async () => {
    const tool1 = createTool({
      name: "tool1",
      handler: vi.fn(async () => "Result 1"),
      followUp: false,
    });
    const tool2 = createTool({
      name: "tool2",
      handler: vi.fn(async () => "Result 2"),
      followUp: false,
    });
    copilotKitCore.addTool(tool1);
    copilotKitCore.addTool(tool2);

    const message = createMultipleToolCallsMessage([
      { name: "tool1" },
      { name: "tool2" },
    ]);
    
    const agent = new MockAgent({ newMessages: [message] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });

    await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("should return final result after recursive follow-up", async () => {
    const tool = createTool({
      name: "recursiveTool",
      handler: vi.fn(async () => "Tool result"),
      followUp: true,
    });
    copilotKitCore.addTool(tool);

    const initialMessage = createToolCallMessage("recursiveTool");
    const finalMessage = createAssistantMessage({ content: "Final response" });
    
    const agent = new MockAgent({ newMessages: [initialMessage] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([finalMessage]);
      }
    };

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(result.newMessages).toEqual([finalMessage]);
  });

  it("should handle multiple recursive follow-ups (chain)", async () => {
    const tool1 = createTool({
      name: "chainTool1",
      handler: vi.fn(async () => "Result 1"),
      followUp: true,
    });
    const tool2 = createTool({
      name: "chainTool2",
      handler: vi.fn(async () => "Result 2"),
      followUp: true,
    });
    copilotKitCore.addTool(tool1);
    copilotKitCore.addTool(tool2);

    const msg1 = createToolCallMessage("chainTool1");
    const msg2 = createToolCallMessage("chainTool2");
    const finalMsg = createAssistantMessage({ content: "Done" });
    
    const agent = new MockAgent({ newMessages: [msg1] });
    copilotKitCore.addAgent__unsafe_dev_only({ id: "test", agent: agent as any });
    let callCount = 0;
    agent.runAgentCallback = () => {
      callCount++;
      if (callCount === 2) {
        agent.setNewMessages([msg2]);
      } else if (callCount === 3) {
        agent.setNewMessages([finalMsg]);
      }
    };

    const result = await copilotKitCore.runAgent({ agent: agent as any });

    expect(agent.runAgentCalls).toHaveLength(3);
    expect(result.newMessages).toEqual([finalMsg]);
  });
});