import { expect, test } from "vitest";

import { inlineSnippets, loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const loadSlug = "integrations/langgraph/configurable";
const frameworks = ["langgraph-python", "langgraph-typescript"] as const;
const frontends = ["react", "angular"] as const;
const doc = loadDoc(loadSlug);

if (!doc) throw new Error(`Missing docs page: ${loadSlug}`);

function expectTrustedChannels(output: string) {
  expect(output).toContain("forwardedProps.config");
  expect(output).toMatch(/browser-controlled and\s+untrusted/);
  expect(output).toContain("Authorization");
  expect(output).toMatch(/LangGraphAGUIAgent[\s\S]*tenant_id/);
  expect(output).toMatch(/recursion_limit[\s\S]*tenantId[\s\S]*recursionLimit/);
  expect(output).not.toMatch(/forwardedProps\s*:\s*{/);
  expect(output).not.toMatch(/authToken|example-token/);
}

test("documents the trust boundary in the source page", () => {
  expectTrustedChannels(inlineSnippets(doc.source, loadSlug));
});

test.each(
  frameworks.flatMap((framework) =>
    frontends.map((frontend) => ({ framework, frontend })),
  ),
)(
  "publishes trusted LangGraph configuration channels for $framework/$frontend",
  ({ framework, frontend }) => {
    const prefix = frontend === "angular" ? "angular/" : "";
    const routePrefix = `/${prefix}${framework}`;
    const llmText = renderPageToLlmText(
      {
        url: `${prefix}${framework}/configurable`,
        title: doc.fm.title,
        description: doc.fm.description,
        filePath: doc.filePath,
        loadSlug,
        framework,
      },
      { framework, frontend },
    );

    expectTrustedChannels(llmText);

    expect(llmText).toContain(`[Agent Config](${routePrefix}/agent-config)`);
    expect(llmText).toContain(
      `[Agent Config guide](${routePrefix}/agent-config)`,
    );
    expect(llmText).toContain(`[Authentication](${routePrefix}/auth)`);
    expect(llmText).toContain(`[Authentication guide](${routePrefix}/auth)`);
    expect(llmText).toContain(
      `[self-hosted authentication guide](${routePrefix}/auth)`,
    );
    expect(llmText).not.toContain("auth#self-hosted-deployment");

    if (frontend === "angular") {
      expect(llmText).toContain("connectAgentContext");
      expect(llmText).not.toContain("useAgentContext");
    } else {
      expect(llmText).toContain("useAgentContext");
      expect(llmText).not.toContain("connectAgentContext");
    }
  },
);

test("marks custom-agent forwarded properties as untrusted", () => {
  const customAgentSlug = "backend/custom-agent";
  const customAgent = loadDoc(customAgentSlug);
  if (!customAgent) throw new Error(`Missing docs page: ${customAgentSlug}`);

  const output = inlineSnippets(customAgent.source, customAgentSlug);
  expect(output).toMatch(/non-secret, browser-controlled preferences/);
  expect(output).toMatch(/backend-owned limits/);
  expect(output).not.toMatch(
    /resolveModel\(props\.model\)|openaiText\(\(props\.model as string\)/,
  );
});
