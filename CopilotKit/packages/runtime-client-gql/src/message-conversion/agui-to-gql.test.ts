import { describe, test, expect } from "vitest";
import * as gql from "../client";
import agui from "@copilotkit/shared";
import {
  aguiToGQL,
  aguiTextMessageToGQLMessage,
  aguiToolCallToGQLActionExecution,
  aguiToolMessageToGQLResultMessage,
  aguiMessageWithRenderToGQL,
  aguiMessageWithImageToGQLMessage,
} from "./agui-to-gql";

describe("agui-to-gql", () => {
  describe("aguiTextMessageToGQLMessage", () => {
    test("should convert developer message", () => {
      const aguiMessage: agui.Message = {
        id: "dev-message-id",
        role: "developer",
        content: "Hello from developer",
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
        content: "System instruction",
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
        content: "Assistant response",
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
        content: "User input",
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
        toolCallId: "tool-call-id",
      };

      expect(() => aguiTextMessageToGQLMessage(aguiMessage)).toThrow(
        "Cannot convert message with role tool to TextMessage",
      );
    });

    test("should handle undefined content", () => {
      const aguiMessage: agui.Message = {
        id: "assistant-message-id",
        role: "assistant",
        content: undefined,
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
          arguments: JSON.stringify({ param: "value" }),
        },
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
          arguments: "{}",
        },
      } as any;

      expect(() => aguiToolCallToGQLActionExecution(toolCall, "parent-id")).toThrow(
        "Unsupported tool call type",
      );
    });
  });

  describe("aguiToolMessageToGQLResultMessage", () => {
    test("should convert tool message to result message", () => {
      const aguiMessage: agui.Message = {
        id: "tool-message-id",
        role: "tool",
        content: "Tool execution result",
        toolCallId: "tool-call-id",
      };

      const toolCallNames = { "tool-call-id": "testFunction" };
      const result = aguiToolMessageToGQLResultMessage(aguiMessage, toolCallNames);

      expect(result).toBeInstanceOf(gql.ResultMessage);
      expect(result.id).toBe("tool-message-id");
      expect(result.result).toBe("Tool execution result");
      expect(result.actionExecutionId).toBe("tool-call-id");
      expect(result.actionName).toBe("testFunction");
    });

    test("should throw error for non-tool message", () => {
      const aguiMessage: agui.Message = {
        id: "assistant-message-id",
        role: "assistant",
        content: "Assistant response",
      };

      expect(() => aguiToolMessageToGQLResultMessage(aguiMessage, {})).toThrow(
        "Cannot convert message with role assistant to ResultMessage",
      );
    });

    test("should throw error for tool message without toolCallId", () => {
      const aguiMessage = {
        id: "tool-message-id",
        role: "tool",
        content: "Tool execution result",
      } as any;

      expect(() => aguiToolMessageToGQLResultMessage(aguiMessage, {})).toThrow(
        "Tool message must have a toolCallId",
      );
    });

    test("should handle undefined content", () => {
      const aguiMessage: agui.Message = {
        id: "tool-message-id",
        role: "tool",
        content: undefined,
        toolCallId: "tool-call-id",
      } as any;

      const toolCallNames = { "tool-call-id": "testFunction" };
      const result = aguiToolMessageToGQLResultMessage(aguiMessage, toolCallNames);

      expect(result.result).toBe("");
      expect(result.actionName).toBe("testFunction");
    });
  });

  describe("aguiToGQL", () => {
    test("should convert an array of text messages", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "dev-1",
          role: "developer",
          content: "Hello",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hi there",
        },
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
          content: "Hello from user",
        },
        {
          id: "assistant-1",
          role: "assistant",
          content: "Hi there",
        },
        {
          id: "user-2",
          role: "user",
          content: "Another user message",
        },
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
                arguments: JSON.stringify({ param: "value" }),
              },
            },
          ],
        },
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
                arguments: JSON.stringify({ param: "value1" }),
              },
            },
            {
              id: "tool-call-2",
              type: "function",
              function: {
                name: "secondFunction",
                arguments: JSON.stringify({ param: "value2" }),
              },
            },
          ],
        },
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
          toolCallId: "tool-call-1",
        },
      ];

      const result = aguiToGQL(aguiMessages);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.ResultMessage);
      expect(result[0].id).toBe("tool-1");
      expect((result[0] as gql.ResultMessage).result).toBe("Tool result");
      expect((result[0] as gql.ResultMessage).actionExecutionId).toBe("tool-call-1");
    });

    test("should handle a mix of message types", () => {
      const aguiMessages: agui.Message[] = [
        {
          id: "dev-1",
          role: "developer",
          content: "Can you run a function?",
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
                arguments: JSON.stringify({ param: "value" }),
              },
            },
          ],
        },
        {
          id: "tool-1",
          role: "tool",
          content: "Function result",
          toolCallId: "tool-call-1",
        },
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
          content: "Can you help me?",
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
                arguments: JSON.stringify({ query: "help" }),
              },
            },
          ],
        },
        {
          id: "tool-1",
          role: "tool",
          content: "Help result",
          toolCallId: "tool-call-1",
        },
        {
          id: "user-2",
          role: "user",
          content: "Thank you!",
        },
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

  describe("aguiMessageWithRenderToGQL", () => {
    test("should handle assistant message with tool calls and render function", () => {
      const mockRender = () => "Test Render";
      const aguiMessage: agui.Message = {
        id: "assistant-1",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-1",
            type: "function",
            function: {
              name: "testFunction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        testFunction: {
          name: "testFunction",
        },
      };

      const result = aguiMessageWithRenderToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);

      // Check that the render function was preserved in actions
      expect(actions.testFunction.render).toBe(mockRender);
    });

    test("should handle assistant message with render function but no tool calls", () => {
      const mockRender = () => "Agent State Render";
      const aguiMessage: agui.Message = {
        id: "agent-state-1",
        role: "assistant",
        generativeUI: mockRender,
      };

      const coAgentStateRenders: Record<string, any> = {};

      const result = aguiMessageWithRenderToGQL(aguiMessage, undefined, coAgentStateRenders);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.AgentStateMessage);
      expect((result[0] as gql.AgentStateMessage).agentName).toBe("unknown");

      // Check that the render function was preserved in coAgentStateRenders
      expect(coAgentStateRenders.unknown.render).toBe(mockRender);
    });

    test("should handle regular assistant message without render function", () => {
      const aguiMessage: agui.Message = {
        id: "assistant-1",
        role: "assistant",
        content: "Regular assistant message",
      };

      const result = aguiMessageWithRenderToGQL(aguiMessage);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect((result[0] as gql.TextMessage).content).toBe("Regular assistant message");
    });

    test("should handle non-assistant messages normally", () => {
      const aguiMessage: agui.Message = {
        id: "user-1",
        role: "user",
        content: "User message",
      };

      const result = aguiMessageWithRenderToGQL(aguiMessage);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect((result[0] as gql.TextMessage).role).toBe(gql.Role.User);
    });

    test("should handle multiple tool calls with render functions", () => {
      const mockRender1 = () => "Render 1";
      const mockRender2 = () => "Render 2";
      const aguiMessage: agui.Message = {
        id: "assistant-1",
        role: "assistant",
        content: "I'll execute multiple functions",
        toolCalls: [
          {
            id: "tool-call-1",
            type: "function",
            function: {
              name: "firstFunction",
              arguments: JSON.stringify({ param: "value1" }),
            },
          },
          {
            id: "tool-call-2",
            type: "function",
            function: {
              name: "secondFunction",
              arguments: JSON.stringify({ param: "value2" }),
            },
          },
        ],
        generativeUI: mockRender1,
      };

      const actions: Record<string, any> = {
        firstFunction: { name: "firstFunction" },
        secondFunction: { name: "secondFunction" },
      };

      const result = aguiMessageWithRenderToGQL(aguiMessage, actions);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[2]).toBeInstanceOf(gql.ActionExecutionMessage);

      // Assert that all actions receive the render function
      Object.values(actions).forEach((action) => {
        expect(action.render).toBe(mockRender1);
      });
    });
  });

  describe("aguiImageMessageToGQLMessage", () => {
    test("should throw error for missing format or bytes in image message", () => {
      const aguiMessage: agui.Message = {
        id: "image-1",
        role: "assistant",
        content: "Image message",
      } as any;

      expect(() => aguiMessageWithImageToGQLMessage(aguiMessage)).toThrow(
        "Cannot convert message to ImageMessage: missing format or bytes",
      );
    });

    test("should convert valid assistant image message", () => {
      const aguiMessage: agui.Message = {
        id: "image-2",
        role: "assistant",
        image: {
          format: "jpeg",
          bytes: "base64stringdata",
        },
      };

      const result = aguiMessageWithImageToGQLMessage(aguiMessage);
      expect(result).toBeInstanceOf(gql.ImageMessage);
      expect(result.id).toBe("image-2");
      expect(result.format).toBe("jpeg");
      expect(result.bytes).toBe("base64stringdata");
      expect(result.role).toBe(gql.Role.Assistant);
    });

    test("should convert valid user image message", () => {
      const aguiMessage: agui.Message = {
        id: "image-3",
        role: "user",
        content: "",
        image: {
          format: "png",
          bytes: "anotherbase64string",
        },
      };

      const result = aguiMessageWithImageToGQLMessage(aguiMessage);
      expect(result).toBeInstanceOf(gql.ImageMessage);
      expect(result.id).toBe("image-3");
      expect(result.format).toBe("png");
      expect(result.bytes).toBe("anotherbase64string");
      expect(result.role).toBe(gql.Role.User);
    });
  });
});
