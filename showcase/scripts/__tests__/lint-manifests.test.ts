import { describe, it, expect } from "vitest";
import { lintManifestSet } from "../lint-manifests.js";
import path from "path";
import os from "os";
import fs from "fs";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lint-test-"));
}
function write(dir: string, rel: string, content: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("lintManifestSet", () => {
  it("clean when factories match manifest and catalog covers demos", () => {
    const root = tmpDir();
    write(root, "agents/strands/manifest.yaml",
      "name: Strands\nslug: strands\nlanguage: python\ndescription: x\nbackend_url: http://x\ndeployed: true\ndemos:\n  - id: agentic-chat\n    backend_highlight: [src/agents/agentic_chat.py]\n");
    write(root, "agents/strands/src/agent_server.py",
      'AGENT_FACTORIES = {\n    "agentic-chat": build_agentic_chat_agent,\n}\n');
    write(root, "agents/strands/src/agents/agentic_chat.py", "");
    write(root, "nextjs/demos.yaml",
      "- id: agentic-chat\n  name: Agentic Chat\n  description: x\n  tags: [chat-ui]\n  route_template: /demos/{framework}/agentic-chat\n  frontend_highlight: [src/app/demos/[framework]/agentic-chat/page.tsx]\n");
    write(root, "nextjs/src/app/demos/[framework]/agentic-chat/page.tsx", "");
    expect(lintManifestSet(root)).toEqual([]);
  });

  it("reports drift when manifest demo missing from AGENT_FACTORIES", () => {
    const root = tmpDir();
    write(root, "agents/strands/manifest.yaml",
      "name: Strands\nslug: strands\nlanguage: python\ndescription: x\nbackend_url: http://x\ndeployed: true\ndemos:\n  - id: agentic-chat\n    backend_highlight: [src/agents/agentic_chat.py]\n  - id: byoc-hashbrown\n    backend_highlight: [src/agents/byoc_hashbrown.py]\n");
    write(root, "agents/strands/src/agent_server.py",
      'AGENT_FACTORIES = {\n    "agentic-chat": build_agentic_chat_agent,\n}\n');
    write(root, "agents/strands/src/agents/agentic_chat.py", "");
    write(root, "agents/strands/src/agents/byoc_hashbrown.py", "");
    write(root, "nextjs/demos.yaml",
      "- id: agentic-chat\n  name: Agentic Chat\n  description: x\n  tags: [chat-ui]\n  route_template: /\n  frontend_highlight: [src/app/demos/[framework]/agentic-chat/page.tsx]\n- id: byoc-hashbrown\n  name: BYOC\n  description: x\n  tags: [generative-ui]\n  route_template: /\n  frontend_highlight: [src/app/demos/[framework]/byoc-hashbrown/page.tsx]\n");
    write(root, "nextjs/src/app/demos/[framework]/agentic-chat/page.tsx", "");
    write(root, "nextjs/src/app/demos/[framework]/byoc-hashbrown/page.tsx", "");
    const findings = lintManifestSet(root);
    expect(findings.some(f => f.rule === "factories-sync" && f.message.includes("byoc-hashbrown"))).toBe(true);
  });
});
