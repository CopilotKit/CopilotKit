import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scanPlayground } from "../scanner";

describe("test-workspace/playground smoke scan", () => {
  const workspace = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "test-workspace",
    "playground",
  );

  it("discovers the CopilotKitProvider and its ancestor chain", () => {
    const result = scanPlayground(workspace);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].importedName).toBe("CopilotKitProvider");
    expect(result.providers[0].importSource).toBe("@copilotkit/react-core/v2");

    expect(result.ancestorChain?.map((p) => p.tagName)).toEqual([
      "AuthProvider",
      "ThemeProvider",
    ]);
  });

  it("discovers every hook in HOOK_REGISTRY at least once", () => {
    const result = scanPlayground(workspace);
    const found = new Set(result.hookSites.map((s) => s.hook));

    const expected = [
      // v1 render
      "useCopilotAction",
      "useCopilotAuthenticatedAction_c",
      "useCoAgentStateRender",
      "useLangGraphInterrupt",
      // v2 render
      "useRenderTool",
      "useRenderToolCall",
      "useDefaultRenderTool",
      "useLazyToolRenderer",
      "useRenderCustomMessages",
      "useRenderActivityMessage",
      "useHumanInTheLoop",
      "useInterrupt",
      "useFrontendTool",
      "useComponent",
      "useDefaultTool",
      // v1 data
      "useCopilotReadable",
      "useCopilotAdditionalInstructions",
      "useCoAgent",
      "useCopilotChat",
      "useMakeCopilotDocumentReadable",
      "useCopilotChatSuggestions",
      // v2 data
      "useAgent",
      "useSuggestions",
      "useConfigureSuggestions",
      "useThreads",
      "useAttachments",
      "useAgentContext",
      "useCapabilities",
    ];

    const missing = expected.filter((h) => !found.has(h));
    expect(missing).toEqual([]);
  });

  it("has zero warnings (every hook is inside a component)", () => {
    const result = scanPlayground(workspace);
    expect(result.warnings).toEqual([]);
  });
});
