import { describe, it, expect } from "vitest";
import { parseDemoCatalog } from "../demos-yaml.js";

describe("parseDemoCatalog", () => {
  it("empty array", () => {
    const r = parseDemoCatalog("[]");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.entries).toEqual([]);
  });

  it("parses entry", () => {
    const yaml = "- id: agentic-chat\n  name: Agentic Chat\n  description: x\n  tags: [chat-ui]\n  route_template: /demos/{framework}/agentic-chat\n  frontend_highlight:\n    - src/app/demos/[framework]/agentic-chat/page.tsx\n";
    const r = parseDemoCatalog(yaml);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].id).toBe("agentic-chat");
  });

  it("malformed on missing id", () => {
    expect(parseDemoCatalog("- name: x\n  description: y\n  tags: []\n  route_template: /\n  frontend_highlight: []\n").kind).toBe("malformed");
  });
});
