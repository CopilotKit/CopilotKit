import { expect, test } from "vitest";

import { inlineSnippets, loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const loadSlug = "integrations/langgraph/configurable";
const frameworks = ["langgraph-python", "langgraph-typescript"] as const;
const frontends = ["react", "angular"] as const;

test.each(
  frameworks.flatMap((framework) =>
    frontends.map((frontend) => ({ framework, frontend })),
  ),
)(
  "publishes trusted LangGraph configuration channels for $framework/$frontend",
  ({ framework, frontend }) => {
    const doc = loadDoc(loadSlug);
    expect(doc).not.toBeNull();

    const prefix = frontend === "angular" ? "angular/" : "";
    const llmText = renderPageToLlmText(
      {
        url: `${prefix}${framework}/configurable`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug,
        framework,
      },
      { framework, frontend },
    );

    for (const output of [inlineSnippets(doc!.source, loadSlug), llmText]) {
      expect(output).toContain(
        "does not copy arbitrary browser-provided properties",
      );
      expect(output).toContain("useAgentContext");
      expect(output).toContain("/agent-config");
      expect(output).toContain("Authorization");
      expect(output).toContain("/auth");
      expect(output).toContain("LangGraphAGUIAgent");
      expect(output).toContain('"configurable": {"tenant_id": tenant_id}');
      expect(output).toContain('"recursion_limit": 50');
      expect(output).toContain("context: { tenantId: verifiedTenantId }");
      expect(output).toContain("recursionLimit: 50");
      expect(output).not.toContain("forwardedProps");
      expect(output).not.toContain("authToken");
      expect(output).not.toContain("example-token");
    }
  },
);
