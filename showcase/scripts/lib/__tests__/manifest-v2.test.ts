import { describe, it, expect } from "vitest";
import { parseManifestV2 } from "../manifest-v2.js";

describe("parseManifestV2", () => {
  it("parses minimal valid manifest", () => {
    const yaml = "name: Strands\nslug: strands\nlanguage: python\ndescription: t\nbackend_url: http://x\ndeployed: true\ndemos:\n  - id: agentic-chat\n    backend_highlight: [src/agents/agentic_chat.py]\n";
    const r = parseManifestV2(yaml);
    if (r.kind !== "ok") throw new Error(`expected ok, got ${r.kind}`);
    expect(r.manifest.slug).toBe("strands");
    expect(r.manifest.demos).toHaveLength(1);
  });

  it("malformed on missing slug", () => {
    const yaml = "name: X\nlanguage: python\ndescription: Y\nbackend_url: http://x\ndeployed: true\ndemos: []\n";
    expect(parseManifestV2(yaml).kind).toBe("malformed");
  });

  it("malformed on demo without id", () => {
    const yaml = "name: X\nslug: x\nlanguage: python\ndescription: Y\nbackend_url: http://x\ndeployed: true\ndemos:\n  - backend_highlight: [src/x.py]\n";
    expect(parseManifestV2(yaml).kind).toBe("malformed");
  });
});
