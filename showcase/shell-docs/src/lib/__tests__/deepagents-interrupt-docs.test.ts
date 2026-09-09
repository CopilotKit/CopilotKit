import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

const INTERRUPT_ROUTES = [
  "generative-ui/your-components/interrupt-based",
  "human-in-the-loop/interrupt-flow",
] as const;

function loadInterruptDoc(route: (typeof INTERRUPT_ROUTES)[number]) {
  const loadSlug = `integrations/deepagents/${route}`;
  const doc = loadDoc(loadSlug);
  expect(doc, route).not.toBeNull();
  return { doc: doc!, loadSlug };
}

function normalizeRouteTitle(source: string) {
  return source.replace(/^title:.*$/m, "title: <route-specific>");
}

test("keeps the two Deep Agents interrupt guides in parity", () => {
  const sources = INTERRUPT_ROUTES.map((route) => {
    const { doc } = loadInterruptDoc(route);
    return normalizeRouteTitle(readFileSync(doc.filePath, "utf8"));
  });

  expect(sources[0]).toBe(sources[1]);
});

test.each(INTERRUPT_ROUTES)(
  "publishes executable, state-aware Deep Agents setup on %s",
  (route) => {
    const { doc, loadSlug } = loadInterruptDoc(route);
    const source = readFileSync(doc.filePath, "utf8");
    const llmText = renderPageToLlmText(
      {
        url: `deepagents/${route}`,
        title: doc.fm.title,
        description: doc.fm.description,
        filePath: doc.filePath,
        loadSlug,
        framework: "deepagents",
      },
      { framework: "deepagents" },
    );

    for (const output of [source, doc.source, llmText]) {
      expect(output, `${route}: TypeScript output schema`).toContain(
        "agentName: zodState(z.string().optional())",
      );
      expect(output, `${route}: TypeScript Deep Agent`).toContain(
        "export const agent = createDeepAgent({",
      );
      expect(output, `${route}: TypeScript state exposure`).toMatch(
        /createCopilotkitMiddleware\(\{\s*exposeState: \["agentName"\]/,
      );
      expect(output, `${route}: Python Deep Agent`).toContain(
        "agent = create_deep_agent(",
      );
      expect(output, `${route}: Python state exposure`).toContain(
        'CopilotKitMiddleware(expose_state=["agent_name"])',
      );
      expect(output, `${route}: awareness section`).toContain(
        "## Make your agent aware of interruptions",
      );

      expect(output).not.toContain("agentName: z.string().optional()");
      expect(output).not.toMatch(/\bcreate_agent\(/);
      expect(output).not.toContain("runtime.systemPrompt");
      expect(output).not.toContain("runtime.system_prompt");
      expect(output).not.toContain('agentId: "sample_agent"');
    }
  },
);
