import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scanWorkspace } from "../hook-scanner";
import { bundleHookSite } from "../hook-bundler";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.resolve(
  __dirname,
  "../../../../test-workspace/hooks",
);

describe("hooks integration", () => {
  it("scans the fixture workspace and finds the expected hook sites", () => {
    const sites = scanWorkspace(fixturesDir);
    const hooks = sites
      .map((s) => ({ hook: s.hook, name: s.name }))
      .sort((a, b) =>
        `${a.hook}:${a.name ?? ""}`.localeCompare(
          `${b.hook}:${b.name ?? ""}`,
        ),
      );
    expect(hooks).toEqual([
      { hook: "useCoAgentStateRender", name: "basic_agent" },
      { hook: "useCopilotAction", name: "addTodo" },
      { hook: "useCopilotAction", name: "removeTodo" },
      { hook: "useLangGraphInterrupt", name: null },
      { hook: "useRenderTool", name: "greetTool" },
    ]);
  });

  it("bundles every fixture file without error", async () => {
    for (const fx of [
      "TodoActions.tsx",
      "BasicAgent.tsx",
      "InterruptDemo.tsx",
      "RenderToolDemo.tsx",
    ]) {
      const result = await bundleHookSite(path.join(fixturesDir, fx));
      expect(result.success, fx).toBe(true);
      expect(result.code, fx).toBeTruthy();
    }
  }, 60_000);
});
