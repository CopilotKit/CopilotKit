import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const docsRoot = process.cwd();
const hitlDocPath = path.join(
  docsRoot,
  "src/content/docs/integrations/microsoft-agent-framework/human-in-the-loop.mdx",
);
const manifestPath = path.resolve(
  docsRoot,
  "../integrations/ms-agent-python/manifest.yaml",
);

describe("Microsoft Agent Framework Python HITL example", () => {
  it("shows a runnable CopilotKit showcase example with its core agent files", () => {
    const hitlDoc = fs.readFileSync(hitlDocPath, "utf8");
    const manifest = fs.readFileSync(manifestPath, "utf8");
    const hitlDemo = manifest.match(
      /  - id: hitl-in-chat\n(?<definition>[\s\S]*?)(?=\n  - id: )/,
    );

    expect(hitlDoc).toContain(
      '<InlineDemo integration="ms-agent-python" demo="hitl-in-chat" />',
    );
    expect(hitlDoc).not.toContain(
      "microsoft-agent-framework-python/feature/human_in_the_loop",
    );
    expect(hitlDemo?.groups?.definition).toContain(
      "src/agents/hitl_in_chat_agent.py",
    );
    expect(hitlDemo?.groups?.definition).toContain("src/agent_server.py");
    expect(hitlDemo?.groups?.definition).toContain(
      "src/app/demos/hitl-in-chat/page.tsx",
    );
    expect(hitlDemo?.groups?.definition).toContain(
      "src/app/demos/hitl-in-chat/time-picker-card.tsx",
    );
    expect(hitlDemo?.groups?.definition).toContain(
      "src/app/api/copilotkit/route.ts",
    );
  });
});
