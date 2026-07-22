import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const ROUTES = [
  "examples/integrations/a2a-middleware/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/adk/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/agno/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/claude-sdk-python/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/claude-sdk-typescript/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/crewai-flows/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/langgraph-fastapi/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/langgraph-js/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/langgraph-python/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/llamaindex/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/mastra/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/mcp-apps/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/ms-agent-framework-dotnet/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/ms-agent-framework-python/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/pydantic-ai/src/app/api/copilotkit/[[...slug]]/route.ts",
  "examples/integrations/strands-python/src/app/api/copilotkit/[[...slug]]/route.ts",
] as const;

/** Read one integration route from the repository root. */
function readRoute(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test.each(ROUTES)(
  "%s keeps the no-key starter path on the in-memory runner",
  (route) => {
    const source = readRoute(route);

    expect(source).toContain("InMemoryAgentRunner");
    expect(source).toContain("process.env.CPK_INTELLIGENCE_API_KEY?.trim()");
    expect(source).toMatch(/intelligenceApiKey\s*\?\s*\{/);
    expect(source).toMatch(
      /:\s*\{\s*runner:\s*new InMemoryAgentRunner\(\)\s*\}/s,
    );
    expect(source).not.toContain(
      'apiKey: process.env.CPK_INTELLIGENCE_API_KEY ?? ""',
    );
  },
);
