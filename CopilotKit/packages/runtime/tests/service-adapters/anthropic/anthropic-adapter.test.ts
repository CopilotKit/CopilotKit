/**
 * @jest-environment node
 */

import { AnthropicAdapter } from "../../../src/service-adapters/anthropic/anthropic-adapter";

// Mock only the Anthropic SDK, not our adapter
jest.mock("@anthropic-ai/sdk", () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: jest.fn(),
      },
    })),
  };
});

// Mock the message classes
jest.mock("../../../src/graphql/types/converted", () => {
  class MockTextMessage {
    content: string;
    role: string;
    id: string;

    constructor(role: string, content: string) {
      this.role = role;
      this.content = content;
      this.id = "mock-text-" + Math.random().toString(36).substring(7);
    }

    isTextMessage() {
      return true;
    }
    isImageMessage() {
      return false;
    }
    isActionExecutionMessage() {
      return false;
    }
    isResultMessage() {
      return false;
    }
  }

  class MockActionExecutionMessage {
    id: string;
    name: string;
    arguments: string;

    constructor(params: { id: string; name: string; arguments: string }) {
      this.id = params.id;
      this.name = params.name;
      this.arguments = params.arguments;
    }

    isTextMessage() {
      return false;
    }
    isImageMessage() {
      return false;
    }
    isActionExecutionMessage() {
      return true;
    }
    isResultMessage() {
      return false;
    }
  }

  class MockResultMessage {
    actionExecutionId: string;
    result: string;
    id: string;

    constructor(params: { actionExecutionId: string; result: string }) {
      this.actionExecutionId = params.actionExecutionId;
      this.result = params.result;
      this.id = "mock-result-" + Math.random().toString(36).substring(7);
    }

    isTextMessage() {
      return false;
    }
    isImageMessage() {
      return false;
    }
    isActionExecutionMessage() {
      return false;
    }
    isResultMessage() {
      return true;
    }
  }

  return {
    TextMessage: MockTextMessage,
    ActionExecutionMessage: MockActionExecutionMessage,
    ResultMessage: MockResultMessage,
  };
});

describe("AnthropicAdapter", () => {
  let adapter: AnthropicAdapter;
  let mockEventSource: any;
  let mockAnthropicCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock Anthropic instance
    const mockAnthropic = {
      messages: {
        create: jest.fn(),
      },
    };

    // Create adapter with the mocked instance
    adapter = new AnthropicAdapter({ anthropic: mockAnthropic as any });

    // Mock the create method to capture what's being sent
    mockAnthropicCreate = mockAnthropic.messages.create;

    mockEventSource = {
      stream: jest.fn((callback) => {
        const mockStream = {
          sendTextMessageStart: jest.fn(),
          sendTextMessageContent: jest.fn(),
          sendTextMessageEnd: jest.fn(),
          sendActionExecutionStart: jest.fn(),
          sendActionExecutionArgs: jest.fn(),
          sendActionExecutionEnd: jest.fn(),
          complete: jest.fn(),
        };
        callback(mockStream);
        return Promise.resolve();
      }),
    };
  });

  describe("Deduplication Logic", () => {
    it("should filter out duplicate result messages", async () => {
      const {
        TextMessage,
        ActionExecutionMessage,
        ResultMessage,
      } = require("../../../src/graphql/types/converted");

      const systemMessage = new TextMessage("system", "System message");
      const userMessage = new TextMessage("user", "Set theme to orange");

      // Tool execution
      const toolExecution = new ActionExecutionMessage({
        id: "tool-123",
        name: "setThemeColor",
        arguments: '{"themeColor": "orange"}',
      });

      // Multiple duplicate results (this was causing the infinite loop)
      const result1 = new ResultMessage({
        actionExecutionId: "tool-123",
        result: "Theme color set to orange",
      });
      const result2 = new ResultMessage({
        actionExecutionId: "tool-123",
        result: "Theme color set to orange",
      });
      const result3 = new ResultMessage({
        actionExecutionId: "tool-123",
        result: "Theme color set to orange",
      });

      // Mock Anthropic to return empty stream (simulating the original problem)
      mockAnthropicCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          // Empty stream - no content from Anthropic
        },
      });

      await adapter.process({
        threadId: "test-thread",
        model: "claude-3-5-sonnet-latest",
        messages: [systemMessage, userMessage, toolExecution, result1, result2, result3],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      // Check that only one result message was sent to Anthropic
      expect(mockAnthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: [{ type: "text", text: "Set theme to orange" }],
            }),
            expect.objectContaining({
              role: "assistant",
              content: [
                expect.objectContaining({
                  type: "tool_use",
                  id: "tool-123",
                  name: "setThemeColor",
                }),
              ],
            }),
            expect.objectContaining({
              role: "user",
              content: [
                expect.objectContaining({
                  type: "tool_result",
                  content: "Theme color set to orange",
                  tool_use_id: "tool-123",
                }),
              ],
            }),
          ]),
        }),
      );

      // Verify only 3 messages sent (user, assistant tool_use, user tool_result) - no duplicates
      const sentMessages = mockAnthropicCreate.mock.calls[0][0].messages;
      expect(sentMessages).toHaveLength(3);

      // Count tool_result messages - should be only 1
      const toolResults = sentMessages.filter(
        (msg: any) => msg.role === "user" && msg.content.some((c: any) => c.type === "tool_result"),
      );
      expect(toolResults).toHaveLength(1);
    });

    it("should filter out invalid result messages without corresponding tool_use", async () => {
      const {
        TextMessage,
        ActionExecutionMessage,
        ResultMessage,
      } = require("../../../src/graphql/types/converted");

      const systemMessage = new TextMessage("system", "System message");

      // Valid tool execution
      const validTool = new ActionExecutionMessage({
        id: "valid-tool",
        name: "validAction",
        arguments: "{}",
      });
      const validResult = new ResultMessage({
        actionExecutionId: "valid-tool",
        result: "Valid result",
      });

      // Invalid result with no corresponding tool_use
      const invalidResult = new ResultMessage({
        actionExecutionId: "nonexistent-tool",
        result: "Invalid result",
      });

      mockAnthropicCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {},
      });

      await adapter.process({
        threadId: "test-thread",
        messages: [systemMessage, validTool, validResult, invalidResult],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      const sentMessages = mockAnthropicCreate.mock.calls[0][0].messages;

      // Should only include the valid tool result
      const toolResults = sentMessages.filter(
        (msg: any) => msg.role === "user" && msg.content.some((c: any) => c.type === "tool_result"),
      );
      expect(toolResults).toHaveLength(1);
      expect(toolResults[0].content[0].tool_use_id).toBe("valid-tool");
    });
  });

  describe("Fallback Response Logic", () => {
    it("should generate contextual fallback when Anthropic returns no content", async () => {
      const {
        TextMessage,
        ActionExecutionMessage,
        ResultMessage,
      } = require("../../../src/graphql/types/converted");

      const systemMessage = new TextMessage("system", "System message");
      const userMessage = new TextMessage("user", "Set theme to orange");

      const toolExecution = new ActionExecutionMessage({
        id: "tool-123",
        name: "setThemeColor",
        arguments: '{"themeColor": "orange"}',
      });

      const toolResult = new ResultMessage({
        actionExecutionId: "tool-123",
        result: "Theme color set to orange",
      });

      // Mock Anthropic to return empty stream
      mockAnthropicCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {
          // No content blocks - simulates Anthropic not responding
        },
      });

      const mockStream = {
        sendTextMessageStart: jest.fn(),
        sendTextMessageContent: jest.fn(),
        sendTextMessageEnd: jest.fn(),
        complete: jest.fn(),
      };

      mockEventSource.stream.mockImplementation((callback) => {
        callback(mockStream);
        return Promise.resolve();
      });

      await adapter.process({
        threadId: "test-thread",
        messages: [systemMessage, userMessage, toolExecution, toolResult],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      // Should generate fallback response with the tool result content
      expect(mockStream.sendTextMessageStart).toHaveBeenCalled();
      expect(mockStream.sendTextMessageContent).toHaveBeenCalledWith({
        messageId: expect.any(String),
        content: "Theme color set to orange", // Uses the actual result content
      });
      expect(mockStream.sendTextMessageEnd).toHaveBeenCalled();
    });

    it("should use generic fallback when no tool result content available", async () => {
      const {
        TextMessage,
        ActionExecutionMessage,
        ResultMessage,
      } = require("../../../src/graphql/types/converted");

      const systemMessage = new TextMessage("system", "System message");

      const toolExecution = new ActionExecutionMessage({
        id: "tool-123",
        name: "someAction",
        arguments: "{}",
      });

      const toolResult = new ResultMessage({
        actionExecutionId: "tool-123",
        result: "", // Empty result
      });

      mockAnthropicCreate.mockResolvedValue({
        [Symbol.asyncIterator]: async function* () {},
      });

      const mockStream = {
        sendTextMessageStart: jest.fn(),
        sendTextMessageContent: jest.fn(),
        sendTextMessageEnd: jest.fn(),
        complete: jest.fn(),
      };

      mockEventSource.stream.mockImplementation((callback) => {
        callback(mockStream);
        return Promise.resolve();
      });

      await adapter.process({
        threadId: "test-thread",
        messages: [systemMessage, toolExecution, toolResult],
        actions: [],
        eventSource: mockEventSource,
        forwardedParameters: {},
      });

      // Should use generic fallback
      expect(mockStream.sendTextMessageContent).toHaveBeenCalledWith({
        messageId: expect.any(String),
        content: "Task completed successfully.",
      });
    });
  });
});
