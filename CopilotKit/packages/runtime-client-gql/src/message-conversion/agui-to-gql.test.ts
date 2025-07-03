import { describe, test, expect } from "vitest";
import * as gql from "../client";
import agui from "@copilotkit/shared";
import { 
  aguiToGQL, 
  aguiTextMessageToGQLMessage, 
  aguiToolCallToGQLActionExecution,
  aguiToolMessageToGQLResultMessage 
} from "./agui-to-gql";

describe("agui-to-gql", () => {
  describe("aguiTextMessageToGQLMessage", () => {
    test("should convert developer message", () => {
      const aguiMessage: agui.Message = {
        id: "dev-message-id",
        role: "developer",
        content: "Hello from developer"
      };

      const result = aguiTextMessageToGQLMessage(aguiMessage);
      
      expect(result).toBeInstanceOf(gql.TextMessage);
      expect(result.id).toBe("dev-message-id");
      expect(result.content).toBe("Hello from developer");
      expect(result.role).toBe(gql.Role.Developer);
    });

    test("should convert system message", () => {
      const aguiMessage: agui.Message = {
        id: "system-message-id",
        role: "system",
        content: "System instruction"
      };

      const result = aguiTextMessageToGQLMessage(aguiMessage);
      
      expect(result).toBeInstanceOf(gql.TextMessage);
      expect(result.id).toBe("system-message-id");
      expect(result.content).toBe("System instruction");
      expect(result.role).toBe(gql.Role.System);
    });

    test("should convert assistant message", () => {
      const aguiMessage: agui.Message = {
        id: "assistant-message-id",
        role: "assistant",
        content: "Assistant response"
      };

      const result = aguiTextMessageToGQLMessage(aguiMessage);
      
      expect(result).toBeInstanceOf(gql.TextMessage);
      expect(result.id).toBe("assistant-message-id");
      expect(result.content).toBe("Assistant response");
      expect(result.role).toBe(gql.Role.Assistant);
    });

    test("should convert user message", () => {
      const aguiMessage: agui.Message = {
        id: "user-message-id",
        role: "user",
        content: "User input"
      };

      const result = aguiTextMessageToGQLMessage(aguiMessage);
      
      expect(result).toBeInstanceOf(gql.TextMessage);
      expect(result.id).toBe("user-message-id");
      expect(result.content).toBe("User input");
      expect(result.role).toBe(gql.Role.User);
    });

    test("should throw error for unsupported role", () => {
      const aguiMessage: agui.Message = {
        id: "tool-message-id",
        role: "tool",
        content: "Tool response",
        toolCallId: "tool-call-id"
      };

      expect(() => aguiTextMessageToGQLMessage(aguiMessage)).toThrow("Cannot convert message with role tool to TextMessage");
    });

    test("should handle undefined content", () => {
      const aguiMessage: agui.Message = {
        id: "assistant-message-id",
        role: "assistant",
        content: undefined
      } as any;

      const result = aguiTextMessageToGQLMessage(aguiMessage);
      
      expect(result.content).toBe("");
    });
  });

  describe("aguiToolCallToGQLActionExecution", () => {
    test("should convert function tool call to action execution message", () => {
      const toolCall: agui.ToolCall = {
        id: "tool-call-id",
        type: "function",
        function: {
          name: "testFunction",
          arguments: JSON.stringify({ param: "value" })
        }
      };

      const result = aguiToolCallToGQLActionExecution(toolCall, "parent-message-id");
      
      expect(result).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result.id).toBe("tool-call-id");
      expect(result.name).toBe("testFunction");
      expect(result.arguments).toEqual({ param: "value" });
      expect(result.parentMessageId).toBe("parent-message-id");
    });

    test("should throw error for unsupported tool call type", () => {
      const toolCall = {
        id: "tool-call-id",
        type: "unsupported-type",
        function: {
          name: "testFunction",
          arguments: "{}"
        }
      } as any;

      expect(() => aguiToolCallToGQLActionExecution(toolCall, "parent-id")).toThrow("Unsupported tool call type");
    });
  });

  describe("aguiToolMessageToGQLResultMessage", () => {
    test("should convert tool message to result message", () => {
      const aguiMessage: agui.Message = {
        id: "tool-message-id",
        role: "tool",
        content: "Tool execution result",
        toolCallId: "tool-call-id"
      };

      const result = aguiToolMessageToGQLResultMessage(aguiMessage);
      
      expect(result).toBeInstanceOf(gql.ResultMessage);
      expect(result.id).toBe("tool-message-id");
      expect(result.result).toBe("Tool execution result");
      expect(result.actionExecutionId).toBe("tool-call-id");
    });

    test("should throw error for non-tool message", () => {
      const aguiMessage: agui.Message = {
        id: "assistant-message-id",
        role: "assistant",
        content: "Assistant response"
      };

      expect(() => aguiToolMessageToGQLResultMessage(aguiMessage)).toThrow("Cannot convert message with role assistant to ResultMessage");
    });

    test("should throw error for tool message without toolCallId", () => {
      const aguiMessage = {
        id: "tool-message-id",
        role: "tool",
        content: "Tool execution result"
      } as any;

      expect(() => aguiToolMessageToGQLResultMessage(aguiMessage)).toThrow("Tool message must have a toolCallId");
    });

    test("should handle undefined content", () => {
      const aguiMessage: agui.Message = {
        id: "tool-message-id",
        role: "tool",
        content: undefined,
        toolCallId: "tool-call-id"
      } as any;

      const result = aguiToolMessageToGQLResultMessage(aguiMessage);
      
      expect(result.result).toBe("");
    });
  });

  describe("aguiToGQL", () => {
    test("should convert an array of text messages", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "dev-1",
          role: "developer",
          content: "Hello"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hi there"
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[0].id).toBe("dev-1");
      expect((result[0] as gql.TextMessage).content).toBe("Hello");
      expect((result[0] as gql.TextMessage).role).toBe(gql.Role.Developer);
      
      expect(result[1]).toBeInstanceOf(gql.TextMessage);
      expect(result[1].id).toBe("assistant-1");
      expect((result[1] as gql.TextMessage).content).toBe("Hi there");
      expect((result[1] as gql.TextMessage).role).toBe(gql.Role.Assistant);
    });

    test("should convert an array of text messages including user messages", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "user-1",
          role: "user",
          content: "Hello from user"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hi there"
        },
        {
          id: "user-2",
          role: "user",
          content: "Another user message"
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[0].id).toBe("user-1");
      expect((result[0] as gql.TextMessage).content).toBe("Hello from user");
      expect((result[0] as gql.TextMessage).role).toBe(gql.Role.User);
      
      expect(result[1]).toBeInstanceOf(gql.TextMessage);
      expect(result[1].id).toBe("assistant-1");
      expect((result[1] as gql.TextMessage).content).toBe("Hi there");
      expect((result[1] as gql.TextMessage).role).toBe(gql.Role.Assistant);
      
      expect(result[2]).toBeInstanceOf(gql.TextMessage);
      expect(result[2].id).toBe("user-2");
      expect((result[2] as gql.TextMessage).content).toBe("Another user message");
      expect((result[2] as gql.TextMessage).role).toBe(gql.Role.User);
    });

    test("should handle assistant messages with tool calls", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "assistant-1",
          role: "assistant",
          content: "I'll execute a function",
          toolCalls: [
            {
              id: "tool-call-1",
              type: "function",
              function: {
                name: "testFunction",
                arguments: JSON.stringify({ param: "value" })
              }
            }
          ]
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[0].id).toBe("assistant-1");
      
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[1].id).toBe("tool-call-1");
      expect((result[1] as gql.ActionExecutionMessage).name).toBe("testFunction");
      expect((result[1] as gql.ActionExecutionMessage).arguments).toEqual({ param: "value" });
      expect((result[1] as gql.ActionExecutionMessage).parentMessageId).toBe("assistant-1");
    });

    test("should handle multiple tool calls in assistant message", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "assistant-1",
          role: "assistant",
          content: "I'll execute multiple functions",
          toolCalls: [
            {
              id: "tool-call-1",
              type: "function",
              function: {
                name: "firstFunction",
                arguments: JSON.stringify({ param: "value1" })
              }
            },
            {
              id: "tool-call-2",
              type: "function",
              function: {
                name: "secondFunction",
                arguments: JSON.stringify({ param: "value2" })
              }
            }
          ]
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[1].id).toBe("tool-call-1");
      expect((result[1] as gql.ActionExecutionMessage).name).toBe("firstFunction");
      
      expect(result[2]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[2].id).toBe("tool-call-2");
      expect((result[2] as gql.ActionExecutionMessage).name).toBe("secondFunction");
    });

    test("should convert tool messages to result messages", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "tool-1",
          role: "tool",
          content: "Tool result",
          toolCallId: "tool-call-1"
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.ResultMessage);
      expect(result[0].id).toBe("tool-1");
      expect((result[0] as gql.ResultMessage).result).toBe("Tool result");
      expect((result[0] as gql.ResultMessage).actionExecutionId).toBe("tool-call-1");
    });

    // test("should throw error for unknown message role", () => {
    //   const aguiMessage = {
    //     id: "unknown-1",
    //     role: "unknown",
    //     content: "Unknown message"
    //   } as any;

    //   expect(() => aguiToGQL([aguiMessage])).toThrow("Unknown message role: unknown");
    // });

    test("should handle a mix of message types", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "dev-1",
          role: "developer",
          content: "Can you run a function?"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Yes, I'll run it",
          toolCalls: [
            {
              id: "tool-call-1",
              type: "function",
              function: {
                name: "testFunction",
                arguments: JSON.stringify({ param: "value" })
              }
            }
          ]
        },
        {
          id: "tool-1",
          role: "tool",
          content: "Function result",
          toolCallId: "tool-call-1"
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(4);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[0].id).toBe("dev-1");
      
      expect(result[1]).toBeInstanceOf(gql.TextMessage);
      expect(result[1].id).toBe("assistant-1");
      
      expect(result[2]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[2].id).toBe("tool-call-1");
      
      expect(result[3]).toBeInstanceOf(gql.ResultMessage);
      expect(result[3].id).toBe("tool-1");
    });

    test("should handle a mix of message types including user messages", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "user-1",
          role: "user",
          content: "Can you help me?"
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Yes, I'll help you",
          toolCalls: [
            {
              id: "tool-call-1",
              type: "function",
              function: {
                name: "helpFunction",
                arguments: JSON.stringify({ query: "help" })
              }
            }
          ]
        },
        {
          id: "tool-1",
          role: "tool",
          content: "Help result",
          toolCallId: "tool-call-1"
        },
        {
          id: "user-2",
          role: "user",
          content: "Thank you!"
        }
      ];

      const result = aguiToGQL(aguiMessages);
      
      expect(result).toHaveLength(5);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[0].id).toBe("user-1");
      expect((result[0] as gql.TextMessage).role).toBe(gql.Role.User);
      
      expect(result[1]).toBeInstanceOf(gql.TextMessage);
      expect(result[1].id).toBe("assistant-1");
      expect((result[1] as gql.TextMessage).role).toBe(gql.Role.Assistant);
      
      expect(result[2]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[2].id).toBe("tool-call-1");
      
      expect(result[3]).toBeInstanceOf(gql.ResultMessage);
      expect(result[3].id).toBe("tool-1");
      
      expect(result[4]).toBeInstanceOf(gql.TextMessage);
      expect(result[4].id).toBe("user-2");
      expect((result[4] as gql.TextMessage).role).toBe(gql.Role.User);
    });
  });
});