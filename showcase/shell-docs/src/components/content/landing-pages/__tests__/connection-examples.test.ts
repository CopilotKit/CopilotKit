import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frameworkOverviews } from "@/data/frameworks";

const authored = [
  "ag2",
  "agno",
  "crewai-flows",
  "deepagents",
  "llamaindex",
  "mastra",
  "microsoft-agent-framework",
  "pydantic-ai",
];
const examples = [
  ...Object.entries(frameworkOverviews).flatMap(([slug, data]) =>
    [data.connect, ...Object.values(data.connectBySlug ?? {})].flatMap(
      (connect) =>
        connect?.filename === "app/api/copilotkit/route.ts" && connect.code
          ? [{ slug, code: connect.code }]
          : [],
    ),
  ),
  ...authored.flatMap((slug) => {
    const mdx = readFileSync(
      path.resolve(`src/content/docs/integrations/${slug}/index.mdx`),
      "utf8",
    );
    return [
      ...mdx.matchAll(
        /```(?:ts|tsx) title="app\/api\/copilotkit\/route.ts"\n([\s\S]*?)```/g,
      ),
    ].map((match) => ({ slug, code: match[1] }));
  }),
];

describe("copyable Next.js connection examples", () => {
  it("covers both authored and data-driven landing pages", () =>
    expect(new Set(examples.map((e) => e.slug)).size).toBeGreaterThanOrEqual(
      11,
    ));
  it.each(examples)(
    "$slug exports a single-route POST handler with valid syntax",
    ({ code }) => {
      expect(code).toMatch(/mode:\s*["']single-route["']/);
      expect(code).toMatch(/export const POST\s*=/);
      expect(code).toContain("createCopilotRuntimeHandler");
      expect(code).not.toContain("userIdFrom(request)");
      const result = ts.transpileModule(code, {
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      });
      expect(
        result.diagnostics?.filter(
          (d) => d.category === ts.DiagnosticCategory.Error,
        ),
      ).toEqual([]);
    },
  );
  it("uses the HTTP adapter for the FastAPI variant", () => {
    const code =
      frameworkOverviews["langgraph-fastapi"].connectBySlug?.[
        "langgraph-fastapi"
      ].code;
    expect(code).toContain("new LangGraphHttpAgent");
    expect(code).not.toContain("new LangGraphAgent");
  });
});
