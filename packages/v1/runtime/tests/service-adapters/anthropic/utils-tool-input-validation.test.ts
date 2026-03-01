import { convertMessageToAnthropicMessage } from "../../../src/service-adapters/anthropic/utils";

/**
 * Tests for tool_use input validation in convertMessageToAnthropicMessage.
 *
 * Anthropic requires tool_use.input to be a valid dictionary (object).
 * When an LLM returns non-object arguments (empty string, array, null, etc.),
 * the converter must fall back to {} to avoid HTTP 400 errors.
 *
 * See: https://github.com/CopilotKit/CopilotKit/issues/3300
 */

function makeActionExecutionMessage(overrides: {
  id?: string;
  name?: string;
  arguments?: any;
}) {
  return {
    id: overrides.id ?? "tool-1",
    name: overrides.name ?? "myTool",
    arguments: overrides.arguments ?? {},
    isTextMessage: () => false,
    isImageMessage: () => false,
    isActionExecutionMessage: () => true,
    isResultMessage: () => false,
    isAgentStateMessage: () => false,
  } as any;
}

describe("convertMessageToAnthropicMessage – tool_use input validation", () => {
  it("passes through valid object arguments", () => {
    const msg = makeActionExecutionMessage({
      arguments: { key: "value" },
    });
    const result = convertMessageToAnthropicMessage(msg);
    expect(result.role).toBe("assistant");
    const content = (result as any).content[0];
    expect(content.type).toBe("tool_use");
    expect(content.input).toEqual({ key: "value" });
  });

  it("falls back to {} when arguments is an empty string", () => {
    const msg = makeActionExecutionMessage({ arguments: "" });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });

  it("falls back to {} when arguments is a non-empty string", () => {
    const msg = makeActionExecutionMessage({ arguments: "some string" });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });

  it("falls back to {} when arguments is null", () => {
    const msg = makeActionExecutionMessage({ arguments: null });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });

  it("falls back to {} when arguments is undefined", () => {
    const msg = makeActionExecutionMessage({ arguments: undefined });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });

  it("falls back to {} when arguments is an array", () => {
    const msg = makeActionExecutionMessage({ arguments: [1, 2, 3] });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });

  it("falls back to {} when arguments is a number", () => {
    const msg = makeActionExecutionMessage({ arguments: 42 });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });

  it("passes through an empty object {}", () => {
    const msg = makeActionExecutionMessage({ arguments: {} });
    const result = convertMessageToAnthropicMessage(msg);
    const content = (result as any).content[0];
    expect(content.input).toEqual({});
  });
});
