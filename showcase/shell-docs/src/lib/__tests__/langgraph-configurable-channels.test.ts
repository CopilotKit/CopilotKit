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
    const routePrefix = `/${prefix}${framework}`;
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
      expect(output).toContain("merge browser-supplied");
      expect(output).toContain("forwardedProps.config");
      expect(output).toMatch(/remain browser-controlled and\s+untrusted/);
      expect(output).toContain(
        "untrusted, even when a LangGraph config schema accepts",
      );
      expect(output).toContain("Authorization");
      expect(output).toContain("LangGraphAGUIAgent");
      expect(output).toContain('"configurable": {"tenant_id": tenant_id}');
      expect(output).toContain('"recursion_limit": 50');
      expect(output).toContain("context: { tenantId: verifiedTenantId }");
      expect(output).toContain("recursionLimit: 50");
      expect(output).not.toContain("forwardedProps: {");
      expect(output).not.toContain("authToken");
      expect(output).not.toContain("example-token");
    }

    expect(llmText).toContain(`[Agent Config](${routePrefix}/agent-config)`);
    expect(llmText).toContain(
      `[Agent Config guide](${routePrefix}/agent-config)`,
    );
    expect(llmText).toContain(`[Authentication](${routePrefix}/auth)`);
    expect(llmText).toContain(`[Authentication guide](${routePrefix}/auth)`);

    if (frontend === "angular") {
      expect(llmText).toContain("connectAgentContext");
      expect(llmText).not.toContain("useAgentContext");
    } else {
      expect(llmText).toContain("useAgentContext");
      expect(llmText).not.toContain("connectAgentContext");
    }
  },
);
