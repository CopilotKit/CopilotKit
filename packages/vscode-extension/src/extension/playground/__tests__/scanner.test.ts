import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scanPlayground } from "../scanner";

const workspaceFx = path.join(__dirname, "fixtures", "workspace");

describe("scanPlayground", () => {
  it("returns a well-shaped empty result for an unknown directory", () => {
    const result = scanPlayground("/definitely/not/a/real/path");
    expect(result).toEqual({
      providers: [],
      componentsWithHooks: [],
      hookSites: [],
      warnings: [],
    });
  });

  it("scans a multi-file workspace and assembles the full result", () => {
    const result = scanPlayground(workspaceFx);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].props.runtimeUrl).toBe("/api/copilotkit");
    expect(result.providers[0].props.publicApiKey).toBe("pk_test");

    expect(result.ancestorChain?.map((p) => p.tagName)).toEqual([
      "AuthProvider",
    ]);

    const compNames = result.componentsWithHooks
      .map((c) => c.componentName)
      .sort();
    expect(compNames).toEqual(["MyPage", "Sidebar"]);

    expect(result.hookSites.map((h) => h.hook).sort()).toEqual([
      "useCopilotAction",
      "useCopilotReadable",
    ]);

    expect(result.warnings).toEqual([]);
  });
});
