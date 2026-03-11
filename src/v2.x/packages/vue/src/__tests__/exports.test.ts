import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as VuePackage from "../index";

describe("package exports", () => {
  it("exports chat components and MCP activity renderer from the package root", () => {
    expect(typeof VuePackage.CopilotChat).toBe("object");
    expect(typeof VuePackage.CopilotChat.View).toBe("object");
    expect(typeof VuePackage.CopilotChatMessageView).toBe("object");
    expect(typeof VuePackage.CopilotChatToolCallsView).toBe("object");
    expect(typeof VuePackage.CopilotChatInput).toBe("object");
    expect(typeof VuePackage.CopilotChatAssistantMessage).toBe("object");
    expect(typeof VuePackage.CopilotChatUserMessage).toBe("object");
    expect(typeof VuePackage.CopilotChatSuggestionPill).toBe("object");
    expect(typeof VuePackage.CopilotChatSuggestionView).toBe("object");
    expect(typeof VuePackage.CopilotChatView).toBe("object");
    expect(typeof VuePackage.CopilotPopupView).toBe("object");
    expect(typeof VuePackage.CopilotPopupView.WelcomeScreen).toBe("object");
    expect(typeof VuePackage.CopilotPopup).toBe("object");
    expect(typeof VuePackage.CopilotSidebar).toBe("object");
    expect(VuePackage.MCPAppsActivityType).toBe("mcp-apps");
    expect(typeof VuePackage.MCPAppsActivityRenderer).toBe("object");
  });

  it("exports the vue stylesheet entrypoint", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports?: Record<string, unknown>;
    };

    expect(packageJson.exports?.["./styles.css"]).toBe("./dist/styles.css");
  });
});
