import { describe, expect, it } from "vitest";

import { resolveFeatureComponentKey } from "./app.routes";

describe("Angular showcase feature routing", () => {
  it.each([
    ["prebuilt-popup", "popup"],
    ["prebuilt-sidebar", "sidebar"],
    ["chat-slots", "chat-slots"],
    ["chat-customization-css", "chat-css"],
    ["headless-simple", "headless-simple"],
    ["headless-complete", "headless-complete"],
    ["gen-ui-tool-based", "tools"],
    ["tool-rendering-default-catchall", "tools"],
    ["tool-rendering-custom-catchall", "tools"],
    ["tool-rendering", "tools"],
    ["tool-rendering-reasoning-chain", "tools"],
    ["frontend-tools", "tools"],
    ["frontend-tools-async", "tools"],
    ["threadid-frontend-tool-roundtrip", "tools"],
    ["hitl-in-chat", "tools"],
    ["hitl-in-app", "tools"],
    ["gen-ui-interrupt", "interrupt"],
    ["interrupt-headless", "interrupt"],
    ["declarative-gen-ui", "a2ui"],
    ["a2ui-fixed-schema", "a2ui"],
    ["a2ui-recovery", "a2ui"],
    ["mcp-apps", "mcp-apps"],
    ["open-gen-ui", "generated-ui"],
    ["open-gen-ui-advanced", "generated-ui"],
    ["declarative-hashbrown", "hashbrown"],
    ["agentic-chat", "chat"],
  ])("maps %s to the %s implementation", (feature, expected) => {
    expect(resolveFeatureComponentKey(feature)).toBe(expected);
  });
});
