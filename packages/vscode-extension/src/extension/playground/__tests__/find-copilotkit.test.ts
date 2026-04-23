import * as path from "node:path";
import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { findCopilotKitNodes } from "../find-copilotkit";

const fx = (name: string) => path.join(__dirname, "fixtures", name);
const read = (name: string) => fs.readFileSync(fx(name), "utf-8");

describe("findCopilotKitNodes", () => {
  it("finds a single <CopilotKit> and returns its location", () => {
    const src = read("simple-provider.tsx");
    const nodes = findCopilotKitNodes(fx("simple-provider.tsx"), src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].filePath).toBe(fx("simple-provider.tsx"));
    expect(nodes[0].loc.line).toBeGreaterThan(0);
  });

  it("finds multiple providers in the same file", () => {
    const src = read("multiple-providers.tsx");
    const nodes = findCopilotKitNodes(fx("multiple-providers.tsx"), src);
    expect(nodes).toHaveLength(2);
  });

  it("returns empty when there is no CopilotKit import", () => {
    const src = read("no-provider.tsx");
    const nodes = findCopilotKitNodes(fx("no-provider.tsx"), src);
    expect(nodes).toEqual([]);
  });

  it("follows aliased imports", () => {
    const src = read("aliased-provider.tsx");
    const nodes = findCopilotKitNodes(fx("aliased-provider.tsx"), src);
    expect(nodes).toHaveLength(1);
  });

  it("detects v2 CopilotKitProvider from @copilotkit/react-core/v2", () => {
    const src = read("v2-provider.tsx");
    const nodes = findCopilotKitNodes(fx("v2-provider.tsx"), src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].importedName).toBe("CopilotKitProvider");
    expect(nodes[0].importSource).toBe("@copilotkit/react-core/v2");
  });

  it("detects backward-compat CopilotKit from @copilotkit/react-core/v2", () => {
    const src = read("v2-backcompat-provider.tsx");
    const nodes = findCopilotKitNodes(fx("v2-backcompat-provider.tsx"), src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].importedName).toBe("CopilotKit");
    expect(nodes[0].importSource).toBe("@copilotkit/react-core/v2");
  });

  it("records v1 importSource for the simple-provider fixture", () => {
    const src = read("simple-provider.tsx");
    const nodes = findCopilotKitNodes(fx("simple-provider.tsx"), src);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].importedName).toBe("CopilotKit");
    expect(nodes[0].importSource).toBe("@copilotkit/react-core");
  });
});
