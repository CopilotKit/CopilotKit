import {
  copilotkitCustomizeConfig,
  convertActionsToDynamicStructuredTools,
  convertActionToDynamicStructuredTool,
} from "../utils";

describe("copilotkitCustomizeConfig", () => {
  it("returns config unchanged when no options provided", () => {
    const baseConfig = { metadata: { existing: true } };
    const result = copilotkitCustomizeConfig(baseConfig);
    expect(result.metadata).toEqual({ existing: true });
  });

  it("returns config unchanged when options is empty object", () => {
    const baseConfig = { metadata: {} };
    const result = copilotkitCustomizeConfig(baseConfig, {});
    expect(result.metadata).toEqual({});
  });

  it("sets emit-messages metadata flag to false", () => {
    const result = copilotkitCustomizeConfig({}, { emitMessages: false });
    expect(result.metadata!["copilotkit:emit-messages"]).toBe(false);
  });

  it("sets emit-messages metadata flag to true", () => {
    const result = copilotkitCustomizeConfig({}, { emitMessages: true });
    expect(result.metadata!["copilotkit:emit-messages"]).toBe(true);
  });

  it("sets emit-tool-calls metadata flag to false", () => {
    const result = copilotkitCustomizeConfig({}, { emitToolCalls: false });
    expect(result.metadata!["copilotkit:emit-tool-calls"]).toBe(false);
  });

  it("sets emit-tool-calls to a specific tool name string", () => {
    const result = copilotkitCustomizeConfig(
      {},
      { emitToolCalls: "SearchTool" },
    );
    expect(result.metadata!["copilotkit:emit-tool-calls"]).toBe("SearchTool");
  });

  it("sets emit-tool-calls to an array of tool names", () => {
    const result = copilotkitCustomizeConfig(
      {},
      { emitToolCalls: ["SearchTool", "FetchTool"] },
    );
    expect(result.metadata!["copilotkit:emit-tool-calls"]).toEqual([
      "SearchTool",
      "FetchTool",
    ]);
  });

  it("sets both emit flags together", () => {
    const result = copilotkitCustomizeConfig(
      {},
      {
        emitMessages: false,
        emitToolCalls: false,
      },
    );
    expect(result.metadata!["copilotkit:emit-messages"]).toBe(false);
    expect(result.metadata!["copilotkit:emit-tool-calls"]).toBe(false);
  });

  it("emitAll sets both messages and tool-calls to true", () => {
    const result = copilotkitCustomizeConfig({}, { emitAll: true });
    expect(result.metadata!["copilotkit:emit-messages"]).toBe(true);
    expect(result.metadata!["copilotkit:emit-tool-calls"]).toBe(true);
  });

  it("converts emitIntermediateState to snake_case in metadata", () => {
    const result = copilotkitCustomizeConfig(
      {},
      {
        emitIntermediateState: [
          { stateKey: "steps", tool: "SearchTool", toolArgument: "steps" },
        ],
      },
    );
    const intermediateState =
      result.metadata!["copilotkit:emit-intermediate-state"];
    expect(intermediateState).toHaveLength(1);
    expect(intermediateState[0]).toEqual({
      state_key: "steps",
      tool: "SearchTool",
      tool_argument: "steps",
    });
  });

  it("handles emitIntermediateState without toolArgument", () => {
    const result = copilotkitCustomizeConfig(
      {},
      {
        emitIntermediateState: [{ stateKey: "output", tool: "WriteTool" }],
      },
    );
    const intermediateState =
      result.metadata!["copilotkit:emit-intermediate-state"];
    expect(intermediateState[0]).toEqual({
      state_key: "output",
      tool: "WriteTool",
      tool_argument: undefined,
    });
  });

  it("throws when emitIntermediateState item is missing stateKey", () => {
    expect(() => {
      copilotkitCustomizeConfig(
        {},
        {
          emitIntermediateState: [{ tool: "SearchTool" } as any],
        },
      );
    }).toThrow("stateKey");
  });

  it("throws when emitIntermediateState item is missing tool", () => {
    expect(() => {
      copilotkitCustomizeConfig(
        {},
        {
          emitIntermediateState: [{ stateKey: "steps" } as any],
        },
      );
    }).toThrow("tool");
  });

  it("preserves existing metadata from baseConfig", () => {
    const result = copilotkitCustomizeConfig(
      { metadata: { "custom-key": "custom-value" } },
      { emitMessages: false },
    );
    expect(result.metadata!["custom-key"]).toBe("custom-value");
    expect(result.metadata!["copilotkit:emit-messages"]).toBe(false);
  });

  it("handles null/undefined baseConfig gracefully", () => {
    const result = copilotkitCustomizeConfig(null as any, {
      emitMessages: false,
    });
    expect(result.metadata!["copilotkit:emit-messages"]).toBe(false);
  });
});

describe("convertActionToDynamicStructuredTool", () => {
  it("converts a valid action to DynamicStructuredTool", () => {
    const action = {
      name: "myTool",
      description: "A test tool",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
      },
    };
    const tool = convertActionToDynamicStructuredTool(action);
    expect(tool.name).toBe("myTool");
    expect(tool.description).toBe("A test tool");
  });

  it("throws when actionInput is null", () => {
    expect(() => convertActionToDynamicStructuredTool(null)).toThrow(
      "Action input is required",
    );
  });

  it("throws when name is missing", () => {
    expect(() =>
      convertActionToDynamicStructuredTool({
        description: "test",
        parameters: {},
      }),
    ).toThrow("name");
  });

  it("throws when description is missing", () => {
    expect(() =>
      convertActionToDynamicStructuredTool({ name: "test", parameters: {} }),
    ).toThrow("description");
  });

  it("throws when parameters is missing", () => {
    expect(() =>
      convertActionToDynamicStructuredTool({
        name: "test",
        description: "test",
      }),
    ).toThrow("parameters");
  });
});

describe("convertActionsToDynamicStructuredTools", () => {
  it("converts multiple actions", () => {
    const actions = [
      {
        name: "tool1",
        description: "First tool",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "tool2",
        description: "Second tool",
        parameters: { type: "object", properties: {} },
      },
    ];
    const tools = convertActionsToDynamicStructuredTools(actions);
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("tool1");
    expect(tools[1].name).toBe("tool2");
  });

  it("returns empty array for empty input", () => {
    const tools = convertActionsToDynamicStructuredTools([]);
    expect(tools).toEqual([]);
  });

  it("handles { type: 'function', function: {...} } format", () => {
    const actions = [
      {
        type: "function",
        function: {
          name: "wrappedTool",
          description: "A wrapped tool",
          parameters: { type: "object", properties: {} },
        },
      },
    ];
    const tools = convertActionsToDynamicStructuredTools(actions);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("wrappedTool");
  });

  it("throws when input is not an array", () => {
    expect(() =>
      convertActionsToDynamicStructuredTools("not-array" as any),
    ).toThrow("Actions must be an array");
  });

  it("wraps individual action errors with index info", () => {
    const actions = [
      {
        name: "goodTool",
        description: "works",
        parameters: { type: "object", properties: {} },
      },
      { name: "badTool" }, // missing description and parameters
    ];
    expect(() => convertActionsToDynamicStructuredTools(actions)).toThrow(
      "index 1",
    );
  });
});
