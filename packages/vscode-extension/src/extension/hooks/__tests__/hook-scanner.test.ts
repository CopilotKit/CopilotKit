import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { scanFile } from "../hook-scanner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fx = (name: string) => path.join(__dirname, "fixtures", name);

describe("hook-scanner scanFile", () => {
  it("detects a direct import + hook call", () => {
    const sites = scanFile(fx("direct-import.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      hook: "useCopilotAction",
      name: "addTodo",
      category: "render",
    });
    expect(sites[0].loc.line).toBeGreaterThan(0);
  });

  it("detects aliased imports", () => {
    const sites = scanFile(fx("aliased-import.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0].hook).toBe("useCopilotAction");
    expect(sites[0].name).toBe("aliasedAction");
  });

  it("detects /v2 imports", () => {
    const sites = scanFile(fx("v2-import.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0].hook).toBe("useRenderTool");
    expect(sites[0].name).toBe("v2tool");
  });

  it("detects multiple hooks per file", () => {
    const sites = scanFile(fx("multiple-hooks.tsx"));
    expect(sites).toHaveLength(3);
    const names = sites.map((s) => `${s.hook}:${s.name ?? "-"}`).sort();
    expect(names).toEqual([
      "useCopilotAction:a",
      "useCopilotAction:b",
      "useCopilotReadable:-",
    ]);
  });

  it("marks dynamic names as null", () => {
    const sites = scanFile(fx("dynamic-name.tsx"));
    expect(sites).toHaveLength(1);
    expect(sites[0].name).toBeNull();
  });

  it("returns empty for files without CopilotKit imports", () => {
    expect(scanFile(fx("not-copilotkit.tsx"))).toEqual([]);
  });

  it("returns empty for nonexistent files without throwing", () => {
    expect(scanFile(fx("does-not-exist.tsx"))).toEqual([]);
  });
});
