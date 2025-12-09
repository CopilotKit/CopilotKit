import { describe, test, expect, vi } from "vitest";
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

    test("should verify render function receives correct props including name", () => {
      const mockRender = vi.fn(
        (props) => `Rendered: ${props.name} with args: ${JSON.stringify(props.args)}`,
      );
      const aguiMessage: agui.Message = {
        id: "assistant-render-props",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-render-props",
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
        testFunction: { name: "testFunction" },
      };

      const result = aguiMessageWithRenderToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);

      // Check that the render function was preserved in actions
      expect(actions.testFunction.render).toBe(mockRender);

      // Now test that when the render function is called, it receives the correct props
      // This simulates what happens when the render function is actually used
      if (actions.testFunction.render) {
        actions.testFunction.render({
          status: "inProgress",
          args: { param: "value" },
          result: undefined,
          respond: () => {},
          messageId: "tool-call-render-props",
          name: "testFunction",
        });

        expect(mockRender).toHaveBeenCalledWith({
          status: "inProgress",
          args: { param: "value" },
          result: undefined,
          respond: expect.any(Function),
          messageId: "tool-call-render-props",
          name: "testFunction",
        });
      }
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

  describe("Wild Card Actions", () => {
    test("should preserve render function for specific action", () => {
      const mockRender = () => "Specific Action Render";
      const aguiMessage: agui.Message = {
        id: "assistant-1",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-1",
            type: "function",
            function: {
              name: "specificAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        specificAction: { name: "specificAction" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions.specificAction.render).toBe(mockRender);
    });

    test("should preserve render function for wild card action", () => {
      const mockRender = () => "Wild Card Action Render";
      const aguiMessage: agui.Message = {
        id: "assistant-2",
        role: "assistant",
        content: "I'll execute an unknown function",
        toolCalls: [
          {
            id: "tool-call-2",
            type: "function",
            function: {
              name: "unknownAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should prioritize specific action over wild card action", () => {
      const mockRender = () => "Prioritized Render";
      const aguiMessage: agui.Message = {
        id: "assistant-3",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-3",
            type: "function",
            function: {
              name: "specificAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        specificAction: { name: "specificAction" },
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions.specificAction.render).toBe(mockRender);
      expect(actions["*"].render).toBeUndefined();
    });

    test("should not preserve render function when no matching action", () => {
      const mockRender = () => "Unmatched Render";
      const aguiMessage: agui.Message = {
        id: "assistant-4",
        role: "assistant",
        content: "I'll execute an unmatched function",
        toolCalls: [
          {
            id: "tool-call-4",
            type: "function",
            function: {
              name: "unmatchedAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        otherAction: { name: "otherAction" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions.otherAction.render).toBeUndefined();
    });

    test("should handle multiple tool calls with wild card action", () => {
      const mockRender = () => "Wild Card Render";
      const aguiMessage: agui.Message = {
        id: "assistant-5",
        role: "assistant",
        content: "I'll execute multiple functions",
        toolCalls: [
          {
            id: "tool-call-5",
            type: "function",
            function: {
              name: "firstFunction",
              arguments: JSON.stringify({ param: "value1" }),
            },
          },
          {
            id: "tool-call-6",
            type: "function",
            function: {
              name: "secondFunction",
              arguments: JSON.stringify({ param: "value2" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[2]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle mixed specific and wild card actions", () => {
      const mockRender = () => "Mixed Render";
      const aguiMessage: agui.Message = {
        id: "assistant-6",
        role: "assistant",
        content: "I'll execute mixed functions",
        toolCalls: [
          {
            id: "tool-call-7",
            type: "function",
            function: {
              name: "specificAction",
              arguments: JSON.stringify({ param: "value1" }),
            },
          },
          {
            id: "tool-call-8",
            type: "function",
            function: {
              name: "unknownAction",
              arguments: JSON.stringify({ param: "value2" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        specificAction: { name: "specificAction" },
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(3);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(result[2]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions.specificAction.render).toBe(mockRender);
      // The wild card action should get the render function for the second tool call
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle no actions provided", () => {
      const mockRender = () => "No Actions Render";
      const aguiMessage: agui.Message = {
        id: "assistant-7",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-9",
            type: "function",
            function: {
              name: "anyAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const result = aguiToGQL(aguiMessage);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
    });

    test("should handle empty actions object", () => {
      const mockRender = () => "Empty Actions Render";
      const aguiMessage: agui.Message = {
        id: "assistant-8",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-10",
            type: "function",
            function: {
              name: "anyAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {};

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
    });

    test("should handle actions with null render functions", () => {
      const mockRender = () => "Null Render Test";
      const aguiMessage: agui.Message = {
        id: "assistant-9",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-11",
            type: "function",
            function: {
              name: "specificAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        specificAction: { name: "specificAction", render: null },
        "*": { name: "*", render: null },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      // The render function should still be assigned even if the action had null render
      expect(actions.specificAction.render).toBe(mockRender);
    });

    test("should handle actions with undefined render functions", () => {
      const mockRender = () => "Undefined Render Test";
      const aguiMessage: agui.Message = {
        id: "assistant-10",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-12",
            type: "function",
            function: {
              name: "wildcardAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*", render: undefined },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      // The render function should still be assigned even if the action had undefined render
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle tool calls with malformed arguments", () => {
      const mockRender = () => "Malformed Args Test";
      const aguiMessage: agui.Message = {
        id: "assistant-11",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-13",
            type: "function",
            function: {
              name: "wildcardAction",
              arguments: "invalid json {", // Malformed JSON
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle tool calls with empty arguments string", () => {
      const mockRender = () => "Empty Args Test";
      const aguiMessage: agui.Message = {
        id: "assistant-12",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-14",
            type: "function",
            function: {
              name: "wildcardAction",
              arguments: "",
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle multiple wild card actions in same object", () => {
      const mockRender = () => "Multiple Wildcards Test";
      const aguiMessage: agui.Message = {
        id: "assistant-13",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-15",
            type: "function",
            function: {
              name: "unknownAction",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        wildcard1: { name: "*" },
        wildcard2: { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      // Should assign to the first wild card action found
      expect(actions.wildcard1.render).toBe(mockRender);
      expect(actions.wildcard2.render).toBeUndefined();
    });

    test("should handle tool calls with object arguments (backward compatibility)", () => {
      const mockRender = () => "Object Args Test";
      const aguiMessage: agui.Message = {
        id: "assistant-14",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-16",
            type: "function",
            function: {
              name: "objectArgsAction",
              arguments: { param: "value" } as any, // Object instead of string
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect((result[1] as any).arguments).toEqual({ param: "value" });
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle tool calls with null/undefined arguments", () => {
      const mockRender = () => "Null Args Test";
      const aguiMessage: agui.Message = {
        id: "assistant-15",
        role: "assistant",
        content: "I'll execute a function",
        toolCalls: [
          {
            id: "tool-call-17",
            type: "function",
            function: {
              name: "nullArgsAction",
              arguments: null as any,
            },
          },
        ],
        generativeUI: mockRender,
      };

      const actions: Record<string, any> = {
        "*": { name: "*" },
      };

      const result = aguiToGQL(aguiMessage, actions);

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(gql.TextMessage);
      expect(result[1]).toBeInstanceOf(gql.ActionExecutionMessage);
      expect((result[1] as any).arguments).toEqual({});
      expect(actions["*"].render).toBe(mockRender);
    });

    test("should handle tool result messages with object content", () => {
      const aguiMessage: agui.Message = {
        id: "tool-result-1",
        role: "tool",
        content: { status: "success", data: { value: 42 } } as any,
        toolCallId: "tool-call-1",
        toolName: "testAction",
      };

      const toolCallNames = { "tool-call-1": "testAction" };
      const result = aguiToGQL(aguiMessage);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.ResultMessage);
      expect((result[0] as any).result).toBe('{"status":"success","data":{"value":42}}');
      expect((result[0] as any).actionExecutionId).toBe("tool-call-1");
      expect((result[0] as any).actionName).toBe("testAction");
    });

    test("should handle tool result messages with non-string content types", () => {
      const aguiMessage: agui.Message = {
        id: "tool-result-2",
        role: "tool",
        content: 42 as any,
        toolCallId: "tool-call-2",
        toolName: "numberAction",
      };

      const result = aguiToGQL(aguiMessage);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.ResultMessage);
      expect((result[0] as any).result).toBe("42");
      expect((result[0] as any).actionExecutionId).toBe("tool-call-2");
      expect((result[0] as any).actionName).toBe("numberAction");
    });

    test("should handle tool result messages with circular reference content", () => {
      const circularObj: any = { status: "success" };
      circularObj.self = circularObj;

      const aguiMessage: agui.Message = {
        id: "tool-result-3",
        role: "tool",
        content: circularObj as any,
        toolCallId: "tool-call-3",
        toolName: "circularAction",
      };

      const result = aguiToGQL(aguiMessage);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.ResultMessage);
      expect((result[0] as any).result).toBe("[object Object]"); // Should fallback to String conversion
      expect((result[0] as any).actionExecutionId).toBe("tool-call-3");
      expect((result[0] as any).actionName).toBe("circularAction");
    });

    test("should handle tool result messages with boolean content", () => {
      const aguiMessage: agui.Message = {
        id: "tool-result-4",
        role: "tool",
        content: true as any,
        toolCallId: "tool-call-4",
        toolName: "booleanAction",
      };

      const result = aguiToGQL(aguiMessage);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(gql.ResultMessage);
      expect((result[0] as any).result).toBe("true");
      expect((result[0] as any).actionExecutionId).toBe("tool-call-4");
      expect((result[0] as any).actionName).toBe("booleanAction");
    });
  });
});
