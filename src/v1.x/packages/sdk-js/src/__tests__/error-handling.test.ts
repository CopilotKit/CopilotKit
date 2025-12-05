import { CopilotKitMisuseError } from "@copilotkit/shared";
import {
  copilotKitInterrupt,
  convertActionToDynamicStructuredTool,
  convertActionsToDynamicStructuredTools,
  copilotkitCustomizeConfig,
  copilotkitEmitMessage,
  copilotkitEmitState,
  copilotkitEmitToolCall,
  copilotkitExit,
} from "../langgraph";

describe("SDK-JS Error Handling", () => {
  describe("copilotKitInterrupt", () => {
    it("should throw CopilotKitMisuseError when neither message nor action provided", () => {
      expect(() => {
        copilotKitInterrupt({});
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotKitInterrupt({});
      }).toThrow(
        "Either message or action (and optional arguments) must be provided for copilotKitInterrupt",
      );
    });

    it("should throw CopilotKitMisuseError when action is not a string", () => {
      expect(() => {
        copilotKitInterrupt({ action: 123 as any });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotKitInterrupt({ action: 123 as any });
      }).toThrow("Action must be a string when provided to copilotKitInterrupt");
    });

    it("should throw CopilotKitMisuseError when message is not a string", () => {
      expect(() => {
        copilotKitInterrupt({ message: 123 as any });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotKitInterrupt({ message: 123 as any });
      }).toThrow("Message must be a string when provided to copilotKitInterrupt");
    });

    it("should throw CopilotKitMisuseError when args is not an object", () => {
      expect(() => {
        copilotKitInterrupt({ action: "test", args: "invalid" as any });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotKitInterrupt({ action: "test", args: "invalid" as any });
      }).toThrow("Args must be an object when provided to copilotKitInterrupt");
    });
  });

  describe("convertActionToDynamicStructuredTool", () => {
    it("should throw CopilotKitMisuseError when actionInput is null/undefined", () => {
      expect(() => {
        convertActionToDynamicStructuredTool(null);
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        convertActionToDynamicStructuredTool(null);
      }).toThrow("Action input is required but was not provided");
    });

    it("should throw CopilotKitMisuseError when name is missing", () => {
      expect(() => {
        convertActionToDynamicStructuredTool({ description: "test" });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        convertActionToDynamicStructuredTool({ description: "test" });
      }).toThrow("Action must have a valid 'name' property of type string");
    });

    it("should throw CopilotKitMisuseError when description is missing", () => {
      expect(() => {
        convertActionToDynamicStructuredTool({ name: "test" });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        convertActionToDynamicStructuredTool({ name: "test" });
      }).toThrow("Action 'test' must have a valid 'description' property of type string");
    });

    it("should throw CopilotKitMisuseError when parameters is missing", () => {
      expect(() => {
        convertActionToDynamicStructuredTool({ name: "test", description: "test desc" });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        convertActionToDynamicStructuredTool({ name: "test", description: "test desc" });
      }).toThrow("Action 'test' must have a 'parameters' property");
    });
  });

  describe("convertActionsToDynamicStructuredTools", () => {
    it("should throw CopilotKitMisuseError when actions is not an array", () => {
      expect(() => {
        convertActionsToDynamicStructuredTools("not an array" as any);
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        convertActionsToDynamicStructuredTools("not an array" as any);
      }).toThrow("Actions must be an array");
    });
  });

  describe("copilotkitCustomizeConfig", () => {
    it("should throw CopilotKitMisuseError when baseConfig is not an object", () => {
      expect(() => {
        copilotkitCustomizeConfig("invalid" as any);
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotkitCustomizeConfig("invalid" as any);
      }).toThrow("baseConfig must be an object or null/undefined");
    });

    it("should throw CopilotKitMisuseError when options is not an object", () => {
      expect(() => {
        copilotkitCustomizeConfig({}, "invalid" as any);
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotkitCustomizeConfig({}, "invalid" as any);
      }).toThrow("options must be an object when provided");
    });

    it("should throw CopilotKitMisuseError when emitIntermediateState is not an array", () => {
      expect(() => {
        copilotkitCustomizeConfig({}, { emitIntermediateState: "invalid" as any });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotkitCustomizeConfig({}, { emitIntermediateState: "invalid" as any });
      }).toThrow("emitIntermediateState must be an array when provided");
    });

    it("should throw CopilotKitMisuseError when emitIntermediateState item is invalid", () => {
      expect(() => {
        copilotkitCustomizeConfig({}, { emitIntermediateState: [{ invalidKey: "value" }] as any });
      }).toThrow(CopilotKitMisuseError);

      expect(() => {
        copilotkitCustomizeConfig({}, { emitIntermediateState: [{ invalidKey: "value" }] as any });
      }).toThrow("emitIntermediateState[0] must have a valid 'stateKey' string property");
    });
  });

  describe("emit functions", () => {
    const mockConfig = { metadata: {} };

    it("should throw CopilotKitMisuseError when config is missing for copilotkitExit", async () => {
      await expect(copilotkitExit(null as any)).rejects.toThrow(CopilotKitMisuseError);
      await expect(copilotkitExit(null as any)).rejects.toThrow(
        "LangGraph configuration is required for copilotkitExit",
      );
    });

    it("should throw CopilotKitMisuseError when config is missing for copilotkitEmitState", async () => {
      await expect(copilotkitEmitState(null as any, {})).rejects.toThrow(CopilotKitMisuseError);
      await expect(copilotkitEmitState(null as any, {})).rejects.toThrow(
        "LangGraph configuration is required for copilotkitEmitState",
      );
    });

    it("should throw CopilotKitMisuseError when state is undefined for copilotkitEmitState", async () => {
      await expect(copilotkitEmitState(mockConfig, undefined)).rejects.toThrow(
        CopilotKitMisuseError,
      );
      await expect(copilotkitEmitState(mockConfig, undefined)).rejects.toThrow(
        "State is required for copilotkitEmitState",
      );
    });

    it("should throw CopilotKitMisuseError when message is invalid for copilotkitEmitMessage", async () => {
      await expect(copilotkitEmitMessage(mockConfig, "" as any)).rejects.toThrow(
        CopilotKitMisuseError,
      );
      await expect(copilotkitEmitMessage(mockConfig, "" as any)).rejects.toThrow(
        "Message must be a non-empty string for copilotkitEmitMessage",
      );
    });

    it("should throw CopilotKitMisuseError when tool name is invalid for copilotkitEmitToolCall", async () => {
      await expect(copilotkitEmitToolCall(mockConfig, "", {})).rejects.toThrow(
        CopilotKitMisuseError,
      );
      await expect(copilotkitEmitToolCall(mockConfig, "", {})).rejects.toThrow(
        "Tool name must be a non-empty string for copilotkitEmitToolCall",
      );
    });

    it("should throw CopilotKitMisuseError when args is undefined for copilotkitEmitToolCall", async () => {
      await expect(copilotkitEmitToolCall(mockConfig, "testTool", undefined)).rejects.toThrow(
        CopilotKitMisuseError,
      );
      await expect(copilotkitEmitToolCall(mockConfig, "testTool", undefined)).rejects.toThrow(
        "Tool arguments are required for copilotkitEmitToolCall",
      );
    });
  });
});
