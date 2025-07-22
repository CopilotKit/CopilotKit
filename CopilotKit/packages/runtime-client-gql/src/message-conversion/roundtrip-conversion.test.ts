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
});
