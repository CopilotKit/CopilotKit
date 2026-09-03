import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const sharedStatePages = [
  "adk/shared-state/in-app-agent-read.mdx",
  "adk/shared-state/in-app-agent-write.mdx",
  "ag2/shared-state/read.mdx",
  "ag2/shared-state/write.mdx",
  "aws-strands/shared-state/in-app-agent-read.mdx",
  "aws-strands/shared-state/in-app-agent-write.mdx",
  "crewai-flows/shared-state/in-app-agent-read.mdx",
  "crewai-flows/shared-state/in-app-agent-write.mdx",
  "llamaindex/shared-state/in-app-agent-read.mdx",
  "llamaindex/shared-state/in-app-agent-write.mdx",
  "mastra/shared-state/in-app-agent-read.mdx",
  "mastra/shared-state/in-app-agent-write.mdx",
  "microsoft-agent-framework/shared-state/in-app-agent-read.mdx",
  "microsoft-agent-framework/shared-state/in-app-agent-write.mdx",
  "pydantic-ai/shared-state/in-app-agent-read.mdx",
  "pydantic-ai/shared-state/in-app-agent-write.mdx",
] as const;

test.each(sharedStatePages)(
  "%s uses the supported v2 state initialization pattern",
  (path) => {
    const source = readFileSync(
      new URL(`../../content/docs/integrations/${path}`, import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\binitialState\s*:/);
    expect(source).toContain("const { agent, isReady } = useAgent({");
    expect(source).toContain(
      "if (!isReady || state.language !== undefined) return;",
    );
    expect(source).toMatch(
      /agent\.setState\(\{ \.\.\.\(agent\.state \?\? \{\}\), language: "(?:english|spanish)" \}\);/,
    );
    if (path.endsWith("read.mdx")) {
      expect(source).not.toContain("render: ({ state })");
    }
  },
);
