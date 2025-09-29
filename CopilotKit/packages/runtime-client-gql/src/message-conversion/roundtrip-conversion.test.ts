import { describe, test, expect, vi } from "vitest";
import * as gql from "../client";
import agui from "@copilotkit/shared";
import { aguiToGQL } from "./agui-to-gql";
import { gqlToAGUI } from "./gql-to-agui";

// Helper to strip functions for deep equality
function stripFunctions(obj: any): any {
  if (typeof obj === "function") return undefined;
  if (Array.isArray(obj)) return obj.map(stripFunctions);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const k in obj) {
      if (typeof obj[k] !== "function") {
        out[k] = stripFunctions(obj[k]);
      }
    }
    return out;
  }
  return obj;
}

describe("roundtrip message conversion", () => {
  test("text message AGUI -> GQL -> AGUI", () => {
    const aguiMsg: agui.Message = {
      id: "user-1",
      role: "user",
      content: "Hello!",
    };
    const gqlMsgs = aguiToGQL(aguiMsg);
    const aguiMsgs2 = gqlToAGUI(gqlMsgs);
    expect(stripFunctions(aguiMsgs2[0])).toEqual(stripFunctions(aguiMsg));
  });

  test("text message GQL -> AGUI -> GQL", () => {
    const gqlMsg = new gql.TextMessage({
      id: "assistant-1",
      content: "Hi!",
      role: gql.Role.Assistant,
    });
    const aguiMsgs = gqlToAGUI(gqlMsg);
    const gqlMsgs2 = aguiToGQL(aguiMsgs);
    // Should be equivalent in content, id, and role
    expect(gqlMsgs2[0].id).toBe(gqlMsg.id);
    expect((gqlMsgs2[0] as any).content).toBe(gqlMsg.content);
    expect((gqlMsgs2[0] as any).role).toBe(gqlMsg.role);
  });

  test("tool message AGUI -> GQL -> AGUI", () => {
    const aguiMsg: agui.Message = {
      id: "tool-1",
      role: "tool",
      content: "Tool result",
      toolCallId: "tool-call-1",
      toolName: "testAction",
    };
    const gqlMsgs = aguiToGQL(aguiMsg);
    const aguiMsgs2 = gqlToAGUI(gqlMsgs);
    expect(stripFunctions(aguiMsgs2[0])).toEqual(stripFunctions(aguiMsg));
  });

  test("tool message GQL -> AGUI -> GQL", () => {
    const gqlMsg = new gql.ResultMessage({
      id: "tool-1",
      result: "Tool result",
      actionExecutionId: "tool-call-1",
      actionName: "testAction",
    });
    const aguiMsgs = gqlToAGUI(gqlMsg);
    const gqlMsgs2 = aguiToGQL(aguiMsgs);
    expect(gqlMsgs2[0].id).toBe(gqlMsg.id);
    expect((gqlMsgs2[0] as any).result).toBe(gqlMsg.result);
    expect((gqlMsgs2[0] as any).actionExecutionId).toBe(gqlMsg.actionExecutionId);
  });

  test("action execution AGUI -> GQL -> AGUI", () => {
    const aguiMsg: agui.Message = {
      id: "assistant-1",
      role: "assistant",
      content: "Running action",
      toolCalls: [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "doSomething",
            arguments: JSON.stringify({ foo: "bar" }),
          },
        },
      ],
    };
    const gqlMsgs = aguiToGQL(aguiMsg);
    const aguiMsgs2 = gqlToAGUI(gqlMsgs);
    // Should have an assistant message and an action execution message
    expect(aguiMsgs2[0].role).toBe("assistant");
    expect(aguiMsgs2[1].role).toBe("assistant");
    // Only check toolCalls if present
    if ("toolCalls" in aguiMsgs2[1]) {
      expect((aguiMsgs2[1] as any).toolCalls[0].function.name).toBe("doSomething");
    }
  });

  test("action execution GQL -> AGUI -> GQL", () => {
    const actionExecMsg = new gql.ActionExecutionMessage({
      id: "tool-call-1",
      name: "doSomething",
      arguments: { foo: "bar" },
      parentMessageId: "assistant-1",
    });
    const aguiMsgs = gqlToAGUI([actionExecMsg]);
    const gqlMsgs2 = aguiToGQL(aguiMsgs);
    // The ActionExecutionMessage is at index 1, not index 0
    expect(gqlMsgs2[1].id).toBe("tool-call-1");
    // The name should be extracted from the toolCall function name
    expect((gqlMsgs2[1] as any).name).toBe("doSomething");
    expect((gqlMsgs2[1] as any).arguments).toEqual({ foo: "bar" });
  });

  test("agent state GQL -> AGUI -> GQL", () => {
    const agentStateMsg = new gql.AgentStateMessage({
      id: "agent-state-1",
      agentName: "testAgent",
      state: { status: "running" },
      role: gql.Role.Assistant,
    });
    const aguiMsgs = gqlToAGUI([agentStateMsg]);
    const gqlMsgs2 = aguiToGQL(aguiMsgs);
    expect(gqlMsgs2[0].id).toBe("agent-state-1");
    // The agentName should be preserved in the roundtrip
    expect((gqlMsgs2[0] as any).agentName).toBe("testAgent");
  });

  test("action execution with render function roundtrip", () => {
    const mockRender = vi.fn();
    const aguiMsg: agui.Message = {
      id: "assistant-1",
      role: "assistant",
      content: "Running action",
      toolCalls: [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "doSomething",
            arguments: JSON.stringify({ foo: "bar" }),
          },
        },
      ],
      generativeUI: mockRender,
    };
    const actions: Record<string, any> = { doSomething: { name: "doSomething" } };
    const gqlMsgs = aguiToGQL(aguiMsg, actions);
    const aguiMsgs2 = gqlToAGUI(gqlMsgs, actions);
    // The render function should be preserved in actions context
    expect(typeof actions.doSomething.render).toBe("function");
    // The roundtripped message should have the same tool call
    if ("toolCalls" in aguiMsgs2[1]) {
      expect((aguiMsgs2[1] as any).toolCalls[0].function.name).toBe("doSomething");
    }
  });

  test("image message GQL -> AGUI -> GQL", () => {
    const gqlMsg = new gql.ImageMessage({
      id: "img-1",
      format: "jpeg",
      bytes: "somebase64string",
      role: gql.Role.User,
    });
    const aguiMsgs = gqlToAGUI(gqlMsg);
    const gqlMsgs2 = aguiToGQL(aguiMsgs);
    expect(gqlMsgs2[0].id).toBe(gqlMsg.id);
    expect((gqlMsgs2[0] as any).format).toBe(gqlMsg.format);
    expect((gqlMsgs2[0] as any).bytes).toBe(gqlMsg.bytes);
    expect((gqlMsgs2[0] as any).role).toBe(gqlMsg.role);
  });

  test("image message AGUI -> GQL -> AGUI (assistant and user)", () => {
    // Assistant image message
    const aguiAssistantImageMsg: agui.Message = {
      id: "img-assistant-1",
      role: "assistant",
      image: {
        format: "jpeg",
        bytes: "assistantbase64data",
      },
      content: "", // required for type
    };
    const gqlAssistantMsgs = aguiToGQL(aguiAssistantImageMsg);
    const aguiAssistantMsgs2 = gqlToAGUI(gqlAssistantMsgs);
    expect(aguiAssistantMsgs2[0].id).toBe(aguiAssistantImageMsg.id);
    expect(aguiAssistantMsgs2[0].role).toBe("assistant");
    expect((aguiAssistantMsgs2[0] as any).image.format).toBe("jpeg");
    expect((aguiAssistantMsgs2[0] as any).image.bytes).toBe("assistantbase64data");

    // User image message
    const aguiUserImageMsg: agui.Message = {
      id: "img-user-1",
      role: "user",
      image: {
        format: "png",
        bytes: "userbase64data",
      },
      content: "", // required for type
    };
    const gqlUserMsgs = aguiToGQL(aguiUserImageMsg);
    const aguiUserMsgs2 = gqlToAGUI(gqlUserMsgs);
    expect(aguiUserMsgs2[0].id).toBe(aguiUserImageMsg.id);
    expect(aguiUserMsgs2[0].role).toBe("user");
    expect((aguiUserMsgs2[0] as any).image.format).toBe("png");
    expect((aguiUserMsgs2[0] as any).image.bytes).toBe("userbase64data");
  });

  test("wild card action roundtrip conversion", () => {
    const mockRender = vi.fn((props) => `Wildcard rendered: ${props.args.test}`);
    const aguiMsg: agui.Message = {
      id: "assistant-wildcard-1",
      role: "assistant",
      content: "Running wild card action",
      toolCalls: [
        {
          id: "tool-call-wildcard-1",
          type: "function",
          function: {
            name: "unknownAction",
            arguments: JSON.stringify({ test: "wildcard-value" }),
          },
        },
      ],
      generativeUI: mockRender,
    };

    const actions: Record<string, any> = {
      "*": { name: "*" },
    };

    // AGUI -> GQL -> AGUI roundtrip
    const gqlMsgs = aguiToGQL(aguiMsg, actions);
    const aguiMsgs2 = gqlToAGUI(gqlMsgs, actions);

    // Verify the wild card action preserved the render function
    expect(typeof actions["*"].render).toBe("function");
    expect(actions["*"].render).toBe(mockRender);

    // Verify the roundtripped message structure
    expect(aguiMsgs2).toHaveLength(2);
    expect(aguiMsgs2[0].role).toBe("assistant");
    expect(aguiMsgs2[1].role).toBe("assistant");

    // Check that the tool call is preserved
    if ("toolCalls" in aguiMsgs2[1]) {
      expect((aguiMsgs2[1] as any).toolCalls[0].function.name).toBe("unknownAction");
      expect((aguiMsgs2[1] as any).toolCalls[0].function.arguments).toBe(
        '{"test":"wildcard-value"}',
      );
    }
  });

  test("wild card action with specific action priority roundtrip", () => {
    const mockRender = vi.fn((props) => `Specific action rendered: ${props.args.test}`);
    const aguiMsg: agui.Message = {
      id: "assistant-priority-1",
      role: "assistant",
      content: "Running specific action",
      toolCalls: [
        {
          id: "tool-call-priority-1",
          type: "function",
          function: {
            name: "specificAction",
            arguments: JSON.stringify({ test: "specific-value" }),
          },
        },
      ],
      generativeUI: mockRender,
    };

    const actions: Record<string, any> = {
      specificAction: { name: "specificAction" },
      "*": { name: "*" },
    };

    // AGUI -> GQL -> AGUI roundtrip
    const gqlMsgs = aguiToGQL(aguiMsg, actions);
    const aguiMsgs2 = gqlToAGUI(gqlMsgs, actions);

    // Verify the specific action preserved the render function (not wild card)
    expect(typeof actions.specificAction.render).toBe("function");
    expect(actions.specificAction.render).toBe(mockRender);
    expect(actions["*"].render).toBeUndefined();

    // Verify the roundtripped message structure
    expect(aguiMsgs2).toHaveLength(2);
    expect(aguiMsgs2[0].role).toBe("assistant");
    expect(aguiMsgs2[1].role).toBe("assistant");

    // Check that the tool call is preserved
    if ("toolCalls" in aguiMsgs2[1]) {
      expect((aguiMsgs2[1] as any).toolCalls[0].function.name).toBe("specificAction");
      expect((aguiMsgs2[1] as any).toolCalls[0].function.arguments).toBe(
        '{"test":"specific-value"}',
      );
    }
  });

  test("wild card action GQL -> AGUI -> GQL roundtrip", () => {
    const actionExecMsg = new gql.ActionExecutionMessage({
      id: "wildcard-action-1",
      name: "unknownAction",
      arguments: { test: "wildcard-gql-value" },
      parentMessageId: "assistant-1",
    });

    const actions: Record<string, any> = {
      "*": {
        name: "*",
        render: vi.fn((props) => `GQL wildcard rendered: ${props.args.test}`),
      },
    };

    // GQL -> AGUI -> GQL roundtrip
    const aguiMsgs = gqlToAGUI([actionExecMsg], actions);
    const gqlMsgs2 = aguiToGQL(aguiMsgs, actions);

    // When converting ActionExecutionMessage to AGUI and back, we get:
    // 1. A TextMessage (assistant message with toolCalls)
    // 2. An ActionExecutionMessage (the tool call itself)
    expect(gqlMsgs2).toHaveLength(2);
    expect(gqlMsgs2[0].id).toBe("wildcard-action-1");
    expect((gqlMsgs2[0] as any).role).toBe(gql.Role.Assistant);
    expect(gqlMsgs2[1].id).toBe("wildcard-action-1");
    expect((gqlMsgs2[1] as any).name).toBe("unknownAction");
    expect((gqlMsgs2[1] as any).arguments).toEqual({ test: "wildcard-gql-value" });
  });

  test("roundtrip conversion with result parsing edge cases", () => {
    // Test with a tool result that contains a JSON string
    const toolResultMsg: agui.Message = {
      id: "tool-result-json",
      role: "tool",
      content: '{"status": "success", "data": {"value": 42}}',
      toolCallId: "tool-call-json",
      toolName: "jsonAction",
    };

    // Convert AGUI -> GQL -> AGUI
    const gqlMsgs = aguiToGQL(toolResultMsg);
    const aguiMsgs = gqlToAGUI(gqlMsgs);

    expect(gqlMsgs).toHaveLength(1);
    expect(gqlMsgs[0]).toBeInstanceOf(gql.ResultMessage);
    expect((gqlMsgs[0] as any).result).toBe('{"status": "success", "data": {"value": 42}}');

    expect(aguiMsgs).toHaveLength(1);
    expect(aguiMsgs[0].role).toBe("tool");
    expect(aguiMsgs[0].content).toBe('{"status": "success", "data": {"value": 42}}');
  });

  test("roundtrip conversion with object content in tool results", () => {
    // Test with a tool result that has object content (edge case)
    const toolResultMsg: agui.Message = {
      id: "tool-result-object",
      role: "tool",
      content: { status: "success", data: { value: 42 } } as any,
      toolCallId: "tool-call-object",
      toolName: "objectAction",
    };

    // Convert AGUI -> GQL -> AGUI
    const gqlMsgs = aguiToGQL(toolResultMsg);
    const aguiMsgs = gqlToAGUI(gqlMsgs);

    expect(gqlMsgs).toHaveLength(1);
    expect(gqlMsgs[0]).toBeInstanceOf(gql.ResultMessage);
    expect((gqlMsgs[0] as any).result).toBe('{"status":"success","data":{"value":42}}');

    expect(aguiMsgs).toHaveLength(1);
    expect(aguiMsgs[0].role).toBe("tool");
    expect(aguiMsgs[0].content).toBe('{"status":"success","data":{"value":42}}');
  });

  test("roundtrip conversion with action execution and result parsing", () => {
    const mockRender = vi.fn((props) => `Rendered: ${JSON.stringify(props.result)}`);

    // Create action execution message
    const actionExecMsg = new gql.ActionExecutionMessage({
      id: "action-with-result",
      name: "testAction",
      arguments: { input: "test-value" },
      parentMessageId: "parent-result",
    });

    // Create result message
    const resultMsg = new gql.ResultMessage({
      id: "result-with-json",
      result: '{"output": "processed", "count": 5}',
      actionExecutionId: "action-with-result",
      actionName: "testAction",
    });

    const actions = {
      testAction: {
        name: "testAction",
        render: mockRender,
      },
    };

    // Convert GQL -> AGUI
    const aguiMsgs = gqlToAGUI([actionExecMsg, resultMsg], actions);

    // The action execution should have a generativeUI function that parses string results
    expect(aguiMsgs).toHaveLength(2);
    expect(aguiMsgs[0].role).toBe("assistant");
    expect("generativeUI" in aguiMsgs[0]).toBe(true);
    expect(aguiMsgs[1].role).toBe("tool");
    expect(aguiMsgs[1].content).toBe('{"output": "processed", "count": 5}');

    // Test that the render function receives parsed results
    if ("generativeUI" in aguiMsgs[0] && aguiMsgs[0].generativeUI) {
      aguiMsgs[0].generativeUI({ result: '{"parsed": true}' });
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          result: { parsed: true }, // Should be parsed from string
        }),
      );
    }

    // Convert back AGUI -> GQL
    const gqlMsgs2 = aguiToGQL(aguiMsgs, actions);

    // Should have 3 messages: TextMessage, ActionExecutionMessage, ResultMessage
    expect(gqlMsgs2).toHaveLength(3);
    expect(gqlMsgs2[0]).toBeInstanceOf(gql.TextMessage);
    expect(gqlMsgs2[1]).toBeInstanceOf(gql.ActionExecutionMessage);
    expect(gqlMsgs2[2]).toBeInstanceOf(gql.ResultMessage);

    // Check that arguments roundtripped correctly
    expect((gqlMsgs2[1] as any).arguments).toEqual({ input: "test-value" });
    expect((gqlMsgs2[2] as any).result).toBe('{"output": "processed", "count": 5}');
  });

  test("roundtrip conversion verifies correct property distribution for regular actions", () => {
    const mockRender = vi.fn((props) => `Regular action: ${JSON.stringify(props.args)}`);

    const actionExecMsg = new gql.ActionExecutionMessage({
      id: "regular-action-test",
      name: "regularAction",
      arguments: { test: "regular-value" },
      parentMessageId: "parent-regular",
    });

    const actions = {
      regularAction: {
        name: "regularAction",
        render: mockRender,
      },
    };

    // GQL -> AGUI -> GQL roundtrip
    const aguiMsgs = gqlToAGUI([actionExecMsg], actions);
    const gqlMsgs2 = aguiToGQL(aguiMsgs, actions);

    // Verify the roundtrip preserved the action
    expect(gqlMsgs2).toHaveLength(2);
    expect(gqlMsgs2[1]).toBeInstanceOf(gql.ActionExecutionMessage);
    expect((gqlMsgs2[1] as any).name).toBe("regularAction");

    // Test that regular actions do NOT receive the name property in render props
    if ("generativeUI" in aguiMsgs[0] && aguiMsgs[0].generativeUI) {
      aguiMsgs[0].generativeUI();
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { test: "regular-value" },
          // name property should NOT be present for regular actions
        }),
      );

      // Verify name property is NOT present
      const callArgs = mockRender.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("name");
    }
  });

  test("roundtrip conversion verifies correct property distribution for wildcard actions", () => {
    const mockRender = vi.fn(
      (props) => `Wildcard action: ${props.name} with ${JSON.stringify(props.args)}`,
    );

    const actionExecMsg = new gql.ActionExecutionMessage({
      id: "wildcard-action-test",
      name: "unknownAction",
      arguments: { test: "wildcard-value" },
      parentMessageId: "parent-wildcard",
    });

    const actions = {
      "*": {
        name: "*",
        render: mockRender,
      },
    };

    // GQL -> AGUI -> GQL roundtrip
    const aguiMsgs = gqlToAGUI([actionExecMsg], actions);
    const gqlMsgs2 = aguiToGQL(aguiMsgs, actions);

    // Verify the roundtrip preserved the action
    expect(gqlMsgs2).toHaveLength(2);
    expect(gqlMsgs2[1]).toBeInstanceOf(gql.ActionExecutionMessage);
    expect((gqlMsgs2[1] as any).name).toBe("unknownAction");

    // Test that wildcard actions DO receive the name property in render props
    if ("generativeUI" in aguiMsgs[0] && aguiMsgs[0].generativeUI) {
      aguiMsgs[0].generativeUI();
      expect(mockRender).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { test: "wildcard-value" },
          name: "unknownAction", // name property SHOULD be present for wildcard actions
        }),
      );

      // Verify name property IS present
      const callArgs = mockRender.mock.calls[0][0];
      expect(callArgs).toHaveProperty("name", "unknownAction");
    }
  });
});
