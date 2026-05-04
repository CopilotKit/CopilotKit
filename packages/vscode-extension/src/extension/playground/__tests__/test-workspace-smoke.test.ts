import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { scanPlayground } from "../scanner";

describe("test-workspace/playground smoke scan", () => {
  // Scan from the test-workspace root so the scanner picks up hooks
  // wherever they live (the v2 weather demo keeps them under
  // `hooks/`, separate from the `playground/` provider tree).
  const workspace = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "test-workspace",
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

  it("discovers every hook the v2 weather demo registers", () => {
    const result = scanPlayground(workspace);
    const found = new Set(result.hookSites.map((s) => s.hook));

    // The test-workspace was trimmed to a weather-only v2 demo; this
    // smoke test now verifies the scanner sees the v2 hook surface
    // exercised by that demo. (Broader coverage of every hook in
    // HOOK_REGISTRY is enforced by the scanner's own unit tests.)
    const expected = [
      "useFrontendTool",
      "useDefaultRenderTool",
      "useDefaultTool",
      "useHumanInTheLoop",
      "useInterrupt",
      "useRenderActivityMessage",
      "useRenderCustomMessages",
    ];

    const missing = expected.filter((h) => !found.has(h));
    expect(missing).toEqual([]);
  });

  it("has zero warnings (every hook is inside a component)", () => {
    const result = scanPlayground(workspace);
    expect(result.warnings).toEqual([]);
  });
});
