import { describe, it, expect } from "vitest";
import * as headless from "../headless";

// Guards the two regressions issue #4893 fixed that neither the bundle guard nor
// `tsc` catches: (1) a documented hook silently dropped from the entry, and
// (2) UseAgentUpdate — a runtime enum — re-exported via `export type`, which
// type-checks clean but strips the runtime binding under isolatedModules, leaving
// useAgent's `updates` option undefined at runtime.
//
// Typing the name lists as `(keyof typeof headless)[]` also fails `tsc` if a
// listed export is removed, so the surface is guarded at build time too.
describe("@copilotkit/react-core/v2/headless runtime exports", () => {
  it("exports the documented hooks as runtime functions", () => {
    const hooks: (keyof typeof headless)[] = [
      "useCopilotKit",
      "useAgent",
      "useFrontendTool",
      "useComponent",
      "useHumanInTheLoop",
      "useInterrupt",
      "useSuggestions",
      "useConfigureSuggestions",
      "useAgentContext",
      "useThreads",
      "useRenderTool",
      "useRenderToolCall",
      "useCapabilities",
      "useCopilotChatConfiguration",
    ];
    for (const name of hooks) {
      expect(
        typeof headless[name],
        `${name} should be a runtime function`,
      ).toBe("function");
    }
  });

  it("exports the provider, core class, and helpers as runtime values", () => {
    const values: (keyof typeof headless)[] = [
      "CopilotKitCoreReact",
      "CopilotChatConfigurationProvider",
      "CopilotChatDefaultLabels",
      "defineToolCallRenderer",
    ];
    for (const name of values) {
      expect(headless[name], `${name} should be a runtime value`).toBeDefined();
    }
  });

  it("exports UseAgentUpdate as a runtime enum value (not stripped by `export type`)", () => {
    expect(headless.UseAgentUpdate).toBeDefined();
    expect(headless.UseAgentUpdate.OnMessagesChanged).toBe("OnMessagesChanged");
  });
});
