// showcase/integrations/nextjs/src/lib/__tests__/manifests.test.ts
import { describe, it, expect } from "vitest";
import { loadDemoCatalog, type DemoCatalogEntry } from "../manifests";

describe("loadDemoCatalog", () => {
  it("empty for empty list", () => {
    expect(loadDemoCatalog("[]\n")).toEqual([]);
  });

  it("parses one entry", () => {
    const yaml = "- id: agentic-chat\n  name: Agentic Chat\n  description: x\n  tags: [chat-ui]\n  route_template: /demos/{framework}/agentic-chat\n  frontend_highlight:\n    - src/app/demos/[framework]/agentic-chat/page.tsx\n";
    const out: DemoCatalogEntry[] = loadDemoCatalog(yaml);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("agentic-chat");
  });

  it("throws on missing id", () => {
    expect(() => loadDemoCatalog("- name: x\n  description: y\n")).toThrow(/id/);
  });

  it("throws on whitespace-only id", () => {
    const yamlText = `- id: "   "\n  name: x\n  description: y\n  tags: []\n  route_template: /\n  frontend_highlight: []\n`;
    expect(() => loadDemoCatalog(yamlText)).toThrow(/id/);
  });

  it("throws on non-string tag element", () => {
    const yamlText = `- id: x\n  name: y\n  description: z\n  tags: [42]\n  route_template: /\n  frontend_highlight: []\n`;
    expect(() => loadDemoCatalog(yamlText)).toThrow(/tags must be string/);
  });

  it("throws on non-string frontend_highlight element", () => {
    const yamlText = `- id: x\n  name: y\n  description: z\n  tags: []\n  route_template: /\n  frontend_highlight: [true]\n`;
    expect(() => loadDemoCatalog(yamlText)).toThrow(/frontend_highlight must be string/);
  });
});
