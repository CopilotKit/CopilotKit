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

function readHitlDoc(): string {
  return fs.readFileSync(hitlDocPath, "utf8");
}

describe("Microsoft Agent Framework Python HITL example", () => {
  it("shows a runnable CopilotKit showcase example with its core agent files", () => {
    const hitlDoc = readHitlDoc();
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

  it("highlights how AgentFrameworkAgent adds frontend tools to each LLM run", () => {
    const hitlDoc = readHitlDoc();

    expect(hitlDoc).toContain(
      "Frontend tool definitions arrive in `RunAgentInput.tools`",
    );
    expect(hitlDoc).toContain(
      "passes the merged list to `Agent.run(..., tools=...)`",
    );
    expect(hitlDoc).toContain(
      "from agent_framework.ag_ui import AgentFrameworkAgent  # [!code highlight]",
    );
    expect(hitlDoc).toContain(
      "# [!code highlight:9]\n            base_agent = Agent(",
    );
    expect(hitlDoc).toContain("tools=[],");
    expect(hitlDoc).toContain("agent = AgentFrameworkAgent(agent=base_agent)");
    expect(hitlDoc).toContain(
      "The adapter merges `RunAgentInput.tools` with `base_agent.tools` for each LLM run.",
    );
    expect(hitlDoc).not.toContain('title="Per-run Python tool flow"');
    expect(hitlDoc).not.toContain(
      "from agent_framework.ag_ui import add_agent_framework_fastapi_endpoint  # [!code highlight]",
    );
    expect(hitlDoc).not.toContain(
      "add_agent_framework_fastapi_endpoint(  # [!code highlight:5]",
    );
  });
});
