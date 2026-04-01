import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { CopilotKitCore } from "../core";
import { FrontendTool } from "../types";
import {
  MockAgent,
  createMessage,
  createAssistantMessage,
  createToolCallMessage,
  createToolResultMessage,
  createTool,
  createMultipleToolCallsMessage,
} from "./test-utils";

describe("CopilotKitCore.runAgent - Full Test Suite", () => {
  let copilotKitCore: CopilotKitCore;

  beforeEach(() => {
    copilotKitCore = new CopilotKitCore({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Tests that should pass", () => {
    it("TEST 1: should run agent without tools", async () => {
      const messages = [
        createMessage({ content: "Hello" }),
        createAssistantMessage({ content: "Hi there!" }),
      ];
      const agent = new MockAgent({ newMessages: messages });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });

      const result = await copilotKitCore.runAgent({ agent: agent as any });

      expect(result.newMessages).toEqual(messages);
      expect(agent.runAgentCalls).toHaveLength(1);
    });

    it("TEST 2: should execute tool with string result", async () => {
      const toolName = "stringTool";
      const tool = createTool({
        name: toolName,
        handler: vi.fn(async () => "String result"),
        followUp: false,
      });
      copilotKitCore.addTool(tool);

      const message = createToolCallMessage(toolName, { input: "test" });
      const agent = new MockAgent({ newMessages: [message] });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });

      await copilotKitCore.runAgent({ agent: agent as any });

      expect(tool.handler).toHaveBeenCalledWith(
        { input: "test" },
        expect.objectContaining({
          toolCall: expect.objectContaining({
            id: expect.any(String),
            function: expect.objectContaining({
              name: toolName,
              arguments: '{"input":"test"}',
            }),
          }),
          agent: expect.objectContaining({
            agentId: "test",
          }),
        }),
      );
      expect(agent.messages.some((m) => m.role === "tool")).toBe(true);
    });

    it("TEST 3: should skip tool when not found", async () => {
      const message = createToolCallMessage("nonExistentTool");
      const agent = new MockAgent({ newMessages: [message] });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });

      await copilotKitCore.runAgent({ agent: agent as any });

      expect(agent.messages.filter((m) => m.role === "tool")).toHaveLength(0);
    });
  });

  describe("Tests that might reveal problems", () => {
    it("TEST 4: should handle follow-up with recursion", async () => {
      const tool = createTool({
        name: "followUpTool",
        handler: vi.fn(async () => "Result"),
        followUp: true, // This should trigger recursion
      });
      copilotKitCore.addTool(tool);

      const message = createToolCallMessage("followUpTool");
      const followUpMessage = createAssistantMessage({
        content: "Follow-up response",
      });

      const agent = new MockAgent({ newMessages: [message] });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });
      let callCount = 0;
      agent.runAgentCallback = () => {
        callCount++;
        if (callCount === 2) {
          agent.setNewMessages([followUpMessage]);
        }
      };

      try {
        const result = await copilotKitCore.runAgent({ agent: agent as any });
        expect(agent.runAgentCalls).toHaveLength(2);
        expect(result.newMessages).toContain(followUpMessage);
      } catch (error) {
        throw error;
      }
    });

    it("TEST 5: should handle multiple tools with at least one follow-up", async () => {
      const tool1 = createTool({
        name: "tool1",
        handler: vi.fn(async () => "Result 1"),
        followUp: false,
      });
      const tool2 = createTool({
        name: "tool2",
        handler: vi.fn(async () => "Result 2"),
        followUp: true, // This one needs follow-up
      });
      copilotKitCore.addTool(tool1);
      copilotKitCore.addTool(tool2);

      const message = createMultipleToolCallsMessage([
        { name: "tool1" },
        { name: "tool2" },
      ]);

      const agent = new MockAgent({ newMessages: [message] });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });
      let callCount = 0;
      agent.runAgentCallback = () => {
        callCount++;
        if (callCount === 2) {
          agent.setNewMessages([]);
        }
      };

      try {
        await copilotKitCore.runAgent({ agent: agent as any });
        expect(agent.runAgentCalls).toHaveLength(2);
      } catch (error) {
        throw error;
      }
    });

    it("TEST 6: should handle tool with undefined follow-up (defaults to true)", async () => {
      const tool: FrontendTool = {
        name: "defaultFollowUpTool",
        handler: vi.fn(async () => "Result"),
        // followUp is undefined - should default to true
      };
      copilotKitCore.addTool(tool);

      const message = createToolCallMessage("defaultFollowUpTool");
      const followUpMessage = createAssistantMessage({ content: "Follow-up" });

      const agent = new MockAgent({ newMessages: [message] });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });
      let callCount = 0;
      agent.runAgentCallback = () => {
        callCount++;
        if (callCount === 2) {
          agent.setNewMessages([followUpMessage]);
        }
      };

      try {
        await copilotKitCore.runAgent({ agent: agent as any });
        expect(agent.runAgentCalls).toHaveLength(2);
      } catch (error) {
        throw error;
      }
    });

    it("TEST 9: should handle chain of follow-ups", async () => {
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
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });
      let callCount = 0;
      agent.runAgentCallback = () => {
        callCount++;
        if (callCount === 2) {
          agent.setNewMessages([msg2]);
        } else if (callCount === 3) {
          agent.setNewMessages([finalMsg]);
        }
      };

      try {
        const result = await copilotKitCore.runAgent({ agent: agent as any });
        expect(agent.runAgentCalls).toHaveLength(3);
        expect(result.newMessages).toEqual([finalMsg]);
      } catch (error) {
        throw error;
      }
    });

    it("TEST 10: should handle concurrent tool calls", async () => {
      const delays = [50, 30, 70];
      const tools = delays.map((delay, i) =>
        createTool({
          name: `concurrentTool${i}`,
          handler: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return `Result ${i} after ${delay}ms`;
          }),
          followUp: false,
        }),
      );

      tools.forEach((tool) => copilotKitCore.addTool(tool));

      const message = createMultipleToolCallsMessage(
        delays.map((_, i) => ({ name: `concurrentTool${i}` })),
      );
      const agent = new MockAgent({ newMessages: [message] });
      copilotKitCore.addAgent__unsafe_dev_only({
        id: "test",
        agent: agent as any,
      });

      const startTime = Date.now();
      try {
        await copilotKitCore.runAgent({ agent: agent as any });
        const duration = Date.now() - startTime;

        // Should execute sequentially
        const expectedMinDuration = delays.reduce((a, b) => a + b, 0);
        expect(duration).toBeGreaterThanOrEqual(expectedMinDuration - 10);

        tools.forEach((tool) => {
          expect(tool.handler).toHaveBeenCalled();
        });
      } catch (error) {
        throw error;
      }
    });
  });
});
