import { describe, it, expect } from "vitest";
import {
  HOOK_REGISTRY,
  getHookDef,
  isRenderHook,
  RENDER_HOOK_NAMES,
} from "../hook-registry";

describe("hook-registry", () => {
  it("includes all V1 render hooks", () => {
    for (const name of [
      "useCopilotAction",
      "useCopilotAuthenticatedAction_c",
      "useCoAgentStateRender",
      "useLangGraphInterrupt",
    ]) {
      const def = getHookDef(name);
      expect(def?.category).toBe("render");
      expect(def?.importSource).toBe("@copilotkit/react-core");
    }
  });

  it("includes all V2 render hooks", () => {
    for (const name of [
      "useRenderTool",
      "useRenderToolCall",
      "useRenderCustomMessages",
      "useRenderActivityMessage",
    ]) {
      const def = getHookDef(name);
      expect(def?.category).toBe("render");
      expect(def?.importSource).toBe("@copilotkit/react-core/v2");
    }
  });

  it("marks data hooks with category data", () => {
    expect(getHookDef("useCopilotReadable")?.category).toBe("data");
    expect(getHookDef("useCoAgent")?.category).toBe("data");
  });

  it("isRenderHook returns true only for render-category hooks", () => {
    expect(isRenderHook("useCopilotAction")).toBe(true);
    expect(isRenderHook("useCopilotReadable")).toBe(false);
    expect(isRenderHook("notARealHook")).toBe(false);
  });

  it("RENDER_HOOK_NAMES matches entries with category render", () => {
    for (const entry of HOOK_REGISTRY) {
      const inList = RENDER_HOOK_NAMES.has(entry.name);
      expect(inList).toBe(entry.category === "render");
    }
  });
});
