import { describe, test, expect, vi } from "vitest";
import * as gql from "../client";
import { MessageStatusCode } from "../graphql/@generated/graphql";
import {
  gqlToAGUI,
  gqlTextMessageToAGUIMessage,
  gqlResultMessageToAGUIMessage,
  gqlImageMessageToAGUIMessage,
  gqlActionExecutionMessageToAGUIMessage,
} from "./gql-to-agui";
import { AIMessage } from "@copilotkit/shared";

describe("message-conversion", () => {
  describe("gqlTextMessageToAGUIMessage", () => {
    test("should convert developer message", () => {
      const gqlMessage = new gql.TextMessage({
        id: "dev-message-id",
        content: "Hello from developer",
        role: gql.Role.Developer,
      });

      const result = gqlTextMessageToAGUIMessage(gqlMessage);

      expect(result).toEqual({
        id: "dev-message-id",
        role: "developer",
        content: "Hello from developer",
      });
    });

    test("should convert system message", () => {
      const gqlMessage = new gql.TextMessage({
        id: "system-message-id",
        content: "System instruction",
        role: gql.Role.System,
      });

      const result = gqlTextMessageToAGUIMessage(gqlMessage);

      expect(result).toEqual({
        id: "system-message-id",
        role: "system",
        content: "System instruction",
      });
    });

    test("should convert assistant message", () => {
      const gqlMessage = new gql.TextMessage({
        id: "assistant-message-id",
        content: "Assistant response",
        role: gql.Role.Assistant,
      });

      const result = gqlTextMessageToAGUIMessage(gqlMessage);

      expect(result).toEqual({
        id: "assistant-message-id",
        role: "assistant",
        content: "Assistant response",
      });
    });

    test("should throw error for unknown role", () => {
      const gqlMessage = new gql.TextMessage({
        id: "unknown-message-id",
        content: "Unknown message",
        role: "unknown" as any,
      });

      expect(() => gqlTextMessageToAGUIMessage(gqlMessage)).toThrow("Unknown message role");
    });
  });

  describe("gqlResultMessageToAGUIMessage", () => {
    test("should convert result message to tool message", () => {
      const gqlMessage = new gql.ResultMessage({
        id: "result-id",
        result: "Function result data",
        actionExecutionId: "action-exec-123",
        actionName: "testAction",
      });

      const result = gqlResultMessageToAGUIMessage(gqlMessage);

      expect(result).toEqual({
        id: "result-id",
        role: "tool",
        content: "Function result data",
        toolCallId: "action-exec-123",
        toolName: "testAction",
      });
    });
  });

  describe("gqlToAGUI", () => {
    test("should convert an array of text messages", () => {
      const gqlMessages = [
        new gql.TextMessage({
          id: "dev-1",
          content: "Hello",
          role: gql.Role.Developer,
        }),
        new gql.TextMessage({
          id: "assistant-1",
          content: "Hi there",
          role: gql.Role.Assistant,
        }),
      ];

      const result = gqlToAGUI(gqlMessages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "dev-1",
        role: "developer",
        content: "Hello",
      });
      expect(result[1]).toEqual({
        id: "assistant-1",
        role: "assistant",
        content: "Hi there",
      });
    });

    test("should handle agent state messages", () => {
      const gqlMessages = [new gql.AgentStateMessage({ id: "agent-state-1" })];

      const result = gqlToAGUI(gqlMessages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "agent-state-1",
        role: "assistant",
      });
    });

    // test("should throw error for unknown message type", () => {
    //   // Create a message with unknown type
    //   const unknownMessage = new gql.Message({ id: "unknown-1" });
    //   // Override the type checking methods to simulate unknown type
    //   unknownMessage.isTextMessage = () => false as any;
    //   unknownMessage.isResultMessage = () => false as any;
    //   unknownMessage.isActionExecutionMessage = () => false as any;
    //   unknownMessage.isAgentStateMessage = () => false as any;
    //   unknownMessage.isImageMessage = () => false as any;

    //   expect(() => gqlToAGUI([unknownMessage])).toThrow("Unknown message type");
    // });

    test("should handle a mix of message types", () => {
      const gqlMessages = [
        new gql.TextMessage({
          id: "dev-1",
          content: "Run action",
          role: gql.Role.Developer,
        }),
        new gql.TextMessage({
          id: "assistant-1",
          content: "I'll run the action",
          role: gql.Role.Assistant,
        }),
        new gql.ResultMessage({
          id: "result-1",
          result: "Action result",
          actionExecutionId: "action-exec-1",
          actionName: "testAction",
        }),
      ];

      const result = gqlToAGUI(gqlMessages);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: "dev-1",
        role: "developer",
        content: "Run action",
      });
      expect(result[1]).toEqual({
        id: "assistant-1",
        role: "assistant",
        content: "I'll run the action",
      });
      expect(result[2]).toEqual({
        id: "result-1",
        role: "tool",
        content: "Action result",
        toolCallId: "action-exec-1",
        toolName: "testAction",
      });
    });

    test("should handle action execution messages with parent messages", () => {
      const assistantMsg = new gql.TextMessage({
        id: "assistant-1",
        content: "I'll execute an action",
        role: gql.Role.Assistant,
      });

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        parentMessageId: "assistant-1",
      });

      const result = gqlToAGUI([assistantMsg, actionExecMsg]);

      // Now we expect 2 messages: the original assistant message and the action execution message
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "assistant-1",
        role: "assistant",
        content: "I'll execute an action",
      });
      expect(result[1]).toEqual({
        id: "action-1",
        role: "assistant",
        name: "testAction",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "testAction",
              arguments: JSON.stringify({ param: "value" }),
            },
            type: "function",
          },
        ],
      });
    });

    test("should handle multiple action execution messages for the same parent", () => {
      const assistantMsg = new gql.TextMessage({
        id: "assistant-1",
        content: "I'll execute multiple actions",
        role: gql.Role.Assistant,
      });

      const action1 = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "firstAction",
        arguments: { param: "value1" },
        parentMessageId: "assistant-1",
      });

      const action2 = new gql.ActionExecutionMessage({
        id: "action-2",
        name: "secondAction",
        arguments: { param: "value2" },
        parentMessageId: "assistant-1",
      });

      const result = gqlToAGUI([assistantMsg, action1, action2]);

      // Now we expect 3 messages: the original assistant message and 2 separate action execution messages
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        id: "assistant-1",
        role: "assistant",
        content: "I'll execute multiple actions",
      });
      expect(result[1]).toEqual({
        id: "action-1",
        role: "assistant",
        name: "firstAction",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "firstAction",
              arguments: JSON.stringify({ param: "value1" }),
            },
            type: "function",
          },
        ],
      });
      expect(result[2]).toEqual({
        id: "action-2",
        role: "assistant",
        name: "secondAction",
        toolCalls: [
          {
            id: "action-2",
            function: {
              name: "secondAction",
              arguments: JSON.stringify({ param: "value2" }),
            },
            type: "function",
          },
        ],
      });
    });

    test("should not add toolCalls to non-assistant messages", () => {
      const developerMsg = new gql.TextMessage({
        id: "dev-1",
        content: "Developer message",
        role: gql.Role.Developer,
      });

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        parentMessageId: "dev-1", // This should be ignored since parent is not assistant
      });

      const result = gqlToAGUI([developerMsg, actionExecMsg]);

      // Now we expect 2 messages: the developer message and the action execution as assistant message
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "dev-1",
        role: "developer",
        content: "Developer message",
      });
      // The action execution becomes its own assistant message regardless of parent
      expect(result[1]).toEqual({
        id: "action-1",
        role: "assistant",
        name: "testAction",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "testAction",
              arguments: JSON.stringify({ param: "value" }),
            },
            type: "function",
          },
        ],
      });
    });

    test("should handle action execution messages without actions context", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
      });

      const result = gqlToAGUI([actionExecMsg]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "action-1",
        role: "assistant",
        name: "testAction",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "testAction",
              arguments: JSON.stringify({ param: "value" }),
            },
            type: "function",
          },
        ],
      });
      // Should not have render functions without actions context
      expect(result[0]).not.toHaveProperty("render");
      expect(result[0]).not.toHaveProperty("renderAndWaitForResponse");
    });

    test("should handle action execution messages with actions context and render functions", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        status: { code: MessageStatusCode.Pending },
      });

      const mockRender = vi.fn();
      const mockRenderAndWaitForResponse = (props: any) => "Test Render With Response";

      const actions = {
        testAction: {
          name: "testAction",
          render: mockRender,
          renderAndWaitForResponse: mockRenderAndWaitForResponse,
        },
      };

      const result = gqlToAGUI([actionExecMsg], actions);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "action-1",
        role: "assistant",
        name: "testAction",
        content: "",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "testAction",
              arguments: JSON.stringify({ param: "value" }),
            },
            type: "function",
          },
        ],
      });

      // Should have generativeUI function
      expect(result[0]).toHaveProperty("generativeUI");
      expect(typeof (result[0] as any).generativeUI).toBe("function");
    });

    test("should provide correct status in generativeUI function props", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        status: { code: MessageStatusCode.Pending },
      });

      const mockRender = vi.fn();
      const actions = {
        testAction: {
          name: "testAction",
          render: mockRender,
        },
      };

      const result = gqlToAGUI([actionExecMsg], actions);

      // Call the generativeUI function
      (result[0] as any).generativeUI?.();

      expect(mockRender).toHaveBeenCalledWith({
        status: "inProgress",
        args: { param: "value" },
        result: undefined,
        respond: expect.any(Function),
        messageId: "action-1",
        // Regular actions should NOT have the name property
      });
    });

    test("should provide executing status when not pending", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        status: { code: MessageStatusCode.Success },
      });

      const mockRender = vi.fn();
      const actions = {
        testAction: {
          name: "testAction",
          render: mockRender,
        },
      };

      const result = gqlToAGUI([actionExecMsg], actions);

      // Call the generativeUI function
      (result[0] as any).generativeUI?.();

      expect(mockRender).toHaveBeenCalledWith({
        status: "executing",
        args: { param: "value" },
        result: undefined,
        respond: expect.any(Function),
        messageId: "action-1",
        // Regular actions should NOT have the name property
      });
    });

    test("should provide complete status when result is available", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        status: { code: MessageStatusCode.Success },
      });

      const resultMsg = new gql.ResultMessage({
        id: "result-1",
        result: "Action completed successfully",
        actionExecutionId: "action-1",
        actionName: "testAction",
      });

      const mockRender = vi.fn();
      const actions = {
        testAction: {
          name: "testAction",
          render: mockRender,
        },
      };

      const result = gqlToAGUI([actionExecMsg, resultMsg], actions);

      // Find the action execution message result (not the tool result)
      const actionMessage = result.find((msg) => msg.role === "assistant" && "toolCalls" in msg);

      // Call the generativeUI function
      (actionMessage as any)?.generativeUI?.();

      expect(mockRender).toHaveBeenCalledWith({
        status: "complete",
        args: { param: "value" },
        result: "Action completed successfully",
        respond: expect.any(Function),
        messageId: "action-1",
        // Regular actions should NOT have the name property
      });
    });

    test("should handle generativeUI function props override", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
        status: { code: MessageStatusCode.Pending },
      });

      const mockRender = vi.fn();
      const actions = {
        testAction: {
          name: "testAction",
          render: mockRender,
        },
      };

      const result = gqlToAGUI([actionExecMsg], actions);

      // Call with custom props
      (result[0] as any).generativeUI?.({
        status: "custom",
        customProp: "test",
        respond: () => "custom respond",
      });

      expect(mockRender).toHaveBeenCalledWith({
        status: "custom",
        args: { param: "value" },
        result: undefined,
        respond: expect.any(Function),
        customProp: "test",
        messageId: "action-1",
        // Regular actions should NOT have the name property
      });
    });

    test("should handle missing render functions gracefully", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { param: "value" },
      });

      const actions = {
        testAction: {
          name: "testAction",
          // No render functions provided
        },
      };

      const result = gqlToAGUI([actionExecMsg], actions);

      expect(result[0]).toMatchObject({
        id: "action-1",
        role: "assistant",
        name: "testAction",
        content: "",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "testAction",
              arguments: JSON.stringify({ param: "value" }),
            },
            type: "function",
          },
        ],
      });

      // Should have undefined generativeUI functions
      expect((result[0] as any).generativeUI).toBeUndefined();
    });

    test("should handle action not found in actions context", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "unknownAction",
        arguments: { param: "value" },
      });

      const actions = {
        testAction: {
          name: "testAction",
          render: () => "Test",
        },
      };

      const result = gqlToAGUI([actionExecMsg], actions);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "action-1",
        role: "assistant",
        name: "unknownAction",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "unknownAction",
              arguments: JSON.stringify({ param: "value" }),
            },
            type: "function",
          },
        ],
      });

      // Should not have generativeUI functions when action not found
      expect(result[0]).not.toHaveProperty("generativeUI");
    });

    test("should handle agent state messages with coAgentStateRenders", () => {
      const agentStateMsg = new gql.AgentStateMessage({
        id: "agent-state-1",
        agentName: "testAgent",
        state: { status: "running", data: "test data" },
        role: gql.Role.Assistant,
      });

      const mockRender = vi.fn();
      const coAgentStateRenders = {
        testAgent: {
          name: "testAgent",
          render: mockRender,
        },
      };

      const result = gqlToAGUI([agentStateMsg], undefined, coAgentStateRenders);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "agent-state-1",
        role: "assistant",
        agentName: "testAgent",
        state: { status: "running", data: "test data" },
        generativeUI: expect.any(Function),
      });

      // Should have generativeUI function
      expect(result[0]).toHaveProperty("generativeUI");
      expect(typeof (result[0] as any).generativeUI).toBe("function");

      // Call the generativeUI function
      (result[0] as any).generativeUI?.();

      expect(mockRender).toHaveBeenCalledWith({
        state: { status: "running", data: "test data" },
      });
    });

    test("should handle agent state messages without coAgentStateRenders", () => {
      const agentStateMsg = new gql.AgentStateMessage({
        id: "agent-state-1",
        agentName: "testAgent",
        state: { status: "running", data: "test data" },
        role: gql.Role.Assistant,
      });

      const result = gqlToAGUI([agentStateMsg]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "agent-state-1",
        role: "assistant",
        agentName: "testAgent",
        state: { status: "running", data: "test data" },
      });

      // Should not have generativeUI functions without coAgentStateRenders
      expect(result[0]).not.toHaveProperty("generativeUI");
    });

    test("should handle agent state messages with agent not found in coAgentStateRenders", () => {
      const agentStateMsg = new gql.AgentStateMessage({
        id: "agent-state-1",
        agentName: "unknownAgent",
        state: { status: "running", data: "test data" },
        role: gql.Role.Assistant,
      });

      const coAgentStateRenders = {
        testAgent: {
          name: "testAgent",
          render: () => "Test",
        },
      };

      const result = gqlToAGUI([agentStateMsg], undefined, coAgentStateRenders);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "agent-state-1",
        role: "assistant",
        agentName: "unknownAgent",
        state: { status: "running", data: "test data" },
      });

      // Should not have generativeUI functions when agent not found
      expect(result[0]).not.toHaveProperty("generativeUI");
    });

    test("should handle user role messages", () => {
      const userMsg = new gql.TextMessage({
        id: "user-1",
        content: "Hello from user",
        role: gql.Role.User,
      });

      const result = gqlToAGUI([userMsg]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "user-1",
        role: "user",
        content: "Hello from user",
      });
    });

    test("should handle mixed message types including agent state messages", () => {
      const textMsg = new gql.TextMessage({
        id: "text-1",
        content: "Hello",
        role: gql.Role.Assistant,
      });

      const agentStateMsg = new gql.AgentStateMessage({
        id: "agent-state-1",
        agentName: "testAgent",
        state: { status: "running" },
        role: gql.Role.Assistant,
      });

      const mockRender = vi.fn();
      const coAgentStateRenders = {
        testAgent: {
          name: "testAgent",
          render: mockRender,
        },
      };

      const result = gqlToAGUI([textMsg, agentStateMsg], undefined, coAgentStateRenders);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "text-1",
        role: "assistant",
        content: "Hello",
      });
      expect(result[1]).toMatchObject({
        id: "agent-state-1",
        role: "assistant",
        agentName: "testAgent",
        state: { status: "running" },
        generativeUI: expect.any(Function),
      });
      expect(result[1]).toHaveProperty("generativeUI");
    });
  });

  describe("gqlImageMessageToAGUIMessage", () => {
    test("should throw error for invalid image format", () => {
      const invalidImageMsg = new gql.ImageMessage({
        id: "img-1",
        format: "bmp", // not in VALID_IMAGE_FORMATS
        bytes: "somebase64string",
        role: gql.Role.User,
      });
      expect(() => gqlImageMessageToAGUIMessage(invalidImageMsg)).toThrow("Invalid image format");
    });

    test("should throw error for empty image bytes", () => {
      const invalidImageMsg = new gql.ImageMessage({
        id: "img-2",
        format: "jpeg",
        bytes: "",
        role: gql.Role.User,
      });
      expect(() => gqlImageMessageToAGUIMessage(invalidImageMsg)).toThrow(
        "Image bytes must be a non-empty string",
      );
    });

    test("should convert valid image message", () => {
      const validImageMsg = new gql.ImageMessage({
        id: "img-3",
        format: "jpeg",
        bytes: "somebase64string",
        role: gql.Role.User,
      });
      const result = gqlImageMessageToAGUIMessage(validImageMsg);
      expect(result).toMatchObject({
        id: "img-3",
        role: "user",
        content: "",
        image: {
          format: "jpeg",
          bytes: "somebase64string",
        },
      });
    });

    test("should convert valid user image message", () => {
      const validImageMsg = new gql.ImageMessage({
        id: "img-user-1",
        format: "jpeg",
        bytes: "userbase64string",
        role: gql.Role.User,
      });
      const result = gqlImageMessageToAGUIMessage(validImageMsg);
      expect(result).toMatchObject({
        id: "img-user-1",
        role: "user",
        content: "",
        image: {
          format: "jpeg",
          bytes: "userbase64string",
        },
      });
    });

    test("should convert valid assistant image message", () => {
      const validImageMsg = new gql.ImageMessage({
        id: "img-assistant-1",
        format: "png",
        bytes: "assistantbase64string",
        role: gql.Role.Assistant,
      });
      const result = gqlImageMessageToAGUIMessage(validImageMsg);
      expect(result).toMatchObject({
        id: "img-assistant-1",
        role: "assistant",
        content: "",
        image: {
          format: "png",
          bytes: "assistantbase64string",
        },
      });
    });
  });

  describe("Wild Card Actions", () => {
    test("should handle action execution with specific action", () => {
      const actions = {
        testAction: {
          name: "testAction",
          render: vi.fn((props) => `Rendered: ${props.args.test}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-1",
        name: "testAction",
        arguments: { test: "value" },
        parentMessageId: "parent-1",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-1",
            function: {
              name: "testAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with wild card action", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Wildcard rendered: ${props.args.test}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-2",
        name: "unknownAction",
        arguments: { test: "wildcard-value" },
        parentMessageId: "parent-2",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-2",
            function: {
              name: "unknownAction",
              arguments: '{"test":"wildcard-value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "unknownAction",
      });
    });

    test("should pass tool name to wildcard action render function", () => {
      const mockRender = vi.fn(
        (props) => `Wildcard rendered: ${props.name} with args: ${JSON.stringify(props.args)}`,
      );
      const actions = {
        "*": {
          name: "*",
          render: mockRender,
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-wildcard-name",
        name: "testTool",
        arguments: { param: "value" },
        parentMessageId: "parent-wildcard-name",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      // Call the generativeUI function to trigger the render
      (result as any).generativeUI?.();

      // Verify that the render function was called with the name property
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "testTool",
          args: { param: "value" },
        }),
      );
    });

    test("should pass tool name to regular action render function", () => {
      const mockRender = vi.fn((props) => `Regular action rendered: ${JSON.stringify(props.args)}`);
      const actions = {
        testAction: {
          name: "testAction",
          render: mockRender,
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-regular-name",
        name: "testAction",
        arguments: { param: "value" },
        parentMessageId: "parent-regular-name",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      // Call the generativeUI function to trigger the render
      (result as any).generativeUI?.();

      // Verify that the render function was called with the correct props
      // Regular actions should NOT have the name property
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { param: "value" },
          // name property should NOT be present for regular actions
        }),
      );

      // Verify that the name property is NOT present
      const callArgs = mockRender.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("name");
    });

    test("should prioritize specific action over wild card action", () => {
      const actions = {
        specificAction: {
          name: "specificAction",
          render: vi.fn((props) => "Specific action rendered"),
        },
        "*": {
          name: "*",
          render: vi.fn((props) => "Wildcard action rendered"),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-3",
        name: "specificAction",
        arguments: { test: "value" },
        parentMessageId: "parent-3",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-3",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-3",
            function: {
              name: "specificAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "specificAction",
      });
    });

    test("should handle action execution without any matching actions", () => {
      const actions = {
        otherAction: {
          name: "otherAction",
          render: vi.fn(),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-4",
        name: "unmatchedAction",
        arguments: { test: "value" },
        parentMessageId: "parent-4",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-4",
        role: "assistant",
        toolCalls: [
          {
            id: "action-4",
            function: {
              name: "unmatchedAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        name: "unmatchedAction",
      });
      expect(result).not.toHaveProperty("generativeUI");
    });

    test("should handle action execution with no actions provided", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-5",
        name: "anyAction",
        arguments: { test: "value" },
        parentMessageId: "parent-5",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg);

      expect(result).toMatchObject({
        id: "action-5",
        role: "assistant",
        toolCalls: [
          {
            id: "action-5",
            function: {
              name: "anyAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        name: "anyAction",
      });
      expect(result).not.toHaveProperty("generativeUI");
    });

    test("should handle action execution with completed result", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Result: ${props.result}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-6",
        name: "testAction",
        arguments: { test: "value" },
        parentMessageId: "parent-6",
      });

      const actionResults = new Map([["action-6", "completed result"]]);

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions, actionResults);

      expect(result).toMatchObject({
        id: "action-6",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-6",
            function: {
              name: "testAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with executing status", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Status: ${props.status}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-7",
        name: "testAction",
        arguments: { test: "value" },
        parentMessageId: "parent-7",
        status: { code: MessageStatusCode.Success },
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-7",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-7",
            function: {
              name: "testAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with pending status", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Status: ${props.status}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-8",
        name: "testAction",
        arguments: { test: "value" },
        parentMessageId: "parent-8",
        status: { code: MessageStatusCode.Pending },
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-8",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-8",
            function: {
              name: "testAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with failed status", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Status: ${props.status}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-9",
        name: "testAction",
        arguments: { test: "value" },
        parentMessageId: "parent-9",
        status: { code: MessageStatusCode.Failed },
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-9",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-9",
            function: {
              name: "testAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with undefined status", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Status: ${props.status}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-10",
        name: "testAction",
        arguments: { test: "value" },
        parentMessageId: "parent-10",
        // No status field
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-10",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-10",
            function: {
              name: "testAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with empty arguments", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Args: ${JSON.stringify(props.args)}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-11",
        name: "testAction",
        arguments: {},
        parentMessageId: "parent-11",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-11",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-11",
            function: {
              name: "testAction",
              arguments: "{}",
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with null arguments", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Args: ${JSON.stringify(props.args)}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-12",
        name: "testAction",
        arguments: null as any,
        parentMessageId: "parent-12",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-12",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-12",
            function: {
              name: "testAction",
              arguments: "null",
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle action execution with complex nested arguments", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Complex: ${JSON.stringify(props.args)}`),
        },
      };

      const complexArgs = {
        nested: {
          array: [1, 2, 3],
          object: { key: "value" },
          nullValue: null,
          undefinedValue: undefined,
        },
        string: "test",
        number: 42,
        boolean: true,
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-13",
        name: "testAction",
        arguments: complexArgs,
        parentMessageId: "parent-13",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-13",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-13",
            function: {
              name: "testAction",
              arguments: JSON.stringify(complexArgs),
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "testAction",
      });
    });

    test("should handle multiple wild card actions (should use first one)", () => {
      const actions = {
        wildcard1: {
          name: "*",
          render: vi.fn((props) => "First wildcard"),
        },
        wildcard2: {
          name: "*",
          render: vi.fn((props) => "Second wildcard"),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-14",
        name: "unknownAction",
        arguments: { test: "value" },
        parentMessageId: "parent-14",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions);

      expect(result).toMatchObject({
        id: "action-14",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "action-14",
            function: {
              name: "unknownAction",
              arguments: '{"test":"value"}',
            },
            type: "function",
          },
        ],
        generativeUI: expect.any(Function),
        name: "unknownAction",
      });
    });

    test("should parse string results in generativeUI props", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Result: ${JSON.stringify(props.result)}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-string-result",
        name: "stringResultAction",
        arguments: { test: "value" },
        parentMessageId: "parent-string",
      });

      const actionResults = new Map<string, string>();
      actionResults.set("action-string-result", '{"parsed": true, "value": 42}');

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions, actionResults);

      expect((result as AIMessage).generativeUI).toBeDefined();
      // Call the render function to test the result parsing
      const renderResult = (result as AIMessage).generativeUI!({
        result: '{"from": "props", "data": "test"}',
      });

      // Verify the render function was called and the result was parsed
      expect(actions["*"].render).toHaveBeenCalledWith(
        expect.objectContaining({
          result: { from: "props", data: "test" }, // Should be parsed from string
          args: { test: "value" },
          status: "complete",
          messageId: "action-string-result",
        }),
      );
    });

    test("should handle malformed JSON strings gracefully in results", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Result: ${JSON.stringify(props.result)}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-malformed",
        name: "malformedAction",
        arguments: { test: "value" },
        parentMessageId: "parent-malformed",
      });

      const actionResults = new Map<string, string>();
      actionResults.set("action-malformed", "invalid json {");

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions, actionResults);

      expect((result as AIMessage).generativeUI).toBeDefined();
      // Call the render function to test malformed JSON handling
      const renderResult = (result as AIMessage).generativeUI!({
        result: "invalid json {",
      });

      // Verify the render function was called with the original string (unparsed)
      expect(actions["*"].render).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "invalid json {", // Should remain as string due to parse error
          args: { test: "value" },
          status: "complete",
          messageId: "action-malformed",
        }),
      );
    });

    test("should handle non-string results without parsing", () => {
      const actions = {
        "*": {
          name: "*",
          render: vi.fn((props) => `Result: ${JSON.stringify(props.result)}`),
        },
      };

      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-object-result",
        name: "objectResultAction",
        arguments: { test: "value" },
        parentMessageId: "parent-object",
      });

      const actionResults = new Map<string, string>();
      actionResults.set("action-object-result", '{"already": "parsed"}');

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg, actions, actionResults);

      expect((result as AIMessage).generativeUI).toBeDefined();
      // Call the render function with an object result
      const renderResult = (result as AIMessage).generativeUI!({
        result: { from: "props", data: "object" },
      });

      // Verify the render function was called with the object as-is
      expect(actions["*"].render).toHaveBeenCalledWith(
        expect.objectContaining({
          result: { from: "props", data: "object" }, // Should remain as object
          args: { test: "value" },
          status: "complete",
          messageId: "action-object-result",
        }),
      );
    });

    test("should handle action execution arguments correctly with simplified conversion", () => {
      const actionExecMsg = new gql.ActionExecutionMessage({
        id: "action-simplified",
        name: "simplifiedAction",
        arguments: { complex: { nested: "value" }, array: [1, 2, 3] },
        parentMessageId: "parent-simplified",
      });

      const result = gqlActionExecutionMessageToAGUIMessage(actionExecMsg);

      expect(result).toMatchObject({
        id: "action-simplified",
        role: "assistant",
        toolCalls: [
          {
            id: "action-simplified",
            function: {
              name: "simplifiedAction",
              arguments: '{"complex":{"nested":"value"},"array":[1,2,3]}',
            },
            type: "function",
          },
        ],
        name: "simplifiedAction",
      });
    });
  });
});
