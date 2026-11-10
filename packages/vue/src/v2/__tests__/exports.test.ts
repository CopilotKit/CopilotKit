import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as VuePackage from "../index";
import * as GenerativeUIEntry from "../generative-ui";
import * as GenerativeUIChartEntry from "../generative-ui-chart";
import * as GenerativeUIMapEntry from "../generative-ui-map";

describe("package exports", () => {
  it("exports chat components and built-in activity renderers from the package root", () => {
    expect(typeof VuePackage.CopilotChat).toBe("object");
    expect(typeof VuePackage.CopilotChat.View).toBe("object");
    expect(typeof VuePackage.CopilotChatMessageView).toBe("object");
    expect(typeof VuePackage.CopilotChatToolCallsView).toBe("object");
    expect(typeof VuePackage.CopilotChatToolCallGroup).toBe("object");
    expect(typeof VuePackage.CopilotChatInput).toBe("object");
    expect(typeof VuePackage.CopilotChatAssistantMessage).toBe("object");
    expect(typeof VuePackage.CopilotChatUserMessage).toBe("object");
    expect(typeof VuePackage.CopilotChatReasoningMessage).toBe("object");
    expect(typeof VuePackage.CopilotChatSuggestionPill).toBe("object");
    expect(typeof VuePackage.CopilotChatSuggestionView).toBe("object");
    expect(typeof VuePackage.CopilotChatView).toBe("object");
    expect(typeof VuePackage.CopilotPopupView).toBe("object");
    expect(typeof VuePackage.CopilotPopupView.WelcomeScreen).toBe("object");
    expect(typeof VuePackage.CopilotPopup).toBe("object");
    expect(typeof VuePackage.CopilotSidebar).toBe("object");
    expect(VuePackage.MCPAppsActivityType).toBe("mcp-apps");
    expect(typeof VuePackage.MCPAppsActivityRenderer).toBe("object");
    expect(VuePackage.A2UISurfaceActivityType).toBe("a2ui-surface");
    expect(typeof VuePackage.A2UISurfaceActivityRenderer).toBe("object");
    expect(
      VuePackage.getOperationSurfaceId({ createSurface: { surfaceId: "s" } }),
    ).toBe("s");
    // Standard Schemas since 2.0 (see the generative UI migration guide).
    expect(VuePackage.OpenGenerativeUIContentSchema["~standard"].vendor).toBe(
      "copilotkit",
    );
    expect(VuePackage.GenerateSandboxedUiArgsSchema["~standard"].vendor).toBe(
      "copilotkit",
    );
  });

  it("exports the default A2UI catalog for the catalog-on-provider path", () => {
    // Users pass this to `a2ui.catalog` to enable A2UI from the provider.
    // Guards against the library build tree-shaking the re-export away.
    expect(VuePackage.vueBasicCatalog).toBeDefined();
    expect(VuePackage.vueBasicCatalog.components.size).toBeGreaterThan(0);
  });

  it("exports CopilotKitStyles and no stylesheet, since the CSS is injected", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports?: Record<string, unknown>;
    };

    expect(typeof VuePackage.CopilotKitStyles).toBe("object");
    expect(packageJson.exports?.["./styles.css"]).toBeUndefined();
  });
});

describe("generative UI entry exports", () => {
  it("exports the React /v2/generative-ui runtime names from /v2/generative-ui", () => {
    expect(Object.keys(GenerativeUIEntry).sort()).toEqual([
      "DefaultGenerativeUIChatCard",
      "GenerativeUIError",
      "GenerativeUISurface",
      "MarkdownSurfaces",
      "child",
      "childList",
      "createGenerativeUI",
      "exportA2UICatalog",
      "standardUI",
      "useGenerativeUIAccessibility",
      "useGenerativeUIFunction",
      "useGenerativeUIRuntime",
      "useGenerativeUIState",
    ]);
  });

  it("exports the chart plugin and its provide function from /v2/generative-ui/chart", () => {
    expect(Object.keys(GenerativeUIChartEntry).sort()).toEqual([
      "GenerativeUIChart",
      "provideGenerativeUIChart",
    ]);
  });

  it("exports the map plugin from /v2/generative-ui/map", () => {
    expect(Object.keys(GenerativeUIMapEntry)).toEqual(["GenerativeUIMap"]);
  });
});
