import { describe, it, expect } from "vitest";
import { classifyScope, type ScopeResult } from "./scope.js";

const ALL_SLUGS = [
  "langgraph-python",
  "langgraph-typescript",
  "langgraph-fastapi",
  "google-adk",
  "mastra",
  "crewai-crews",
  "pydantic-ai",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "agno",
  "ag2",
  "llamaindex",
  "strands",
  "langroid",
  "ms-agent-python",
  "ms-agent-dotnet",
  "spring-ai",
];

describe("classifyScope", () => {
  // ---- Platform-wide patterns => mode: "all" ----

  it('returns "all" for packages/runtime/** changes', () => {
    const result = classifyScope(
      ["packages/runtime/src/lib/foo.ts"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
    expect(result.reason).toContain("packages/runtime");
  });

  it('returns "all" for packages/sdk-js/** changes', () => {
    const result = classifyScope(["packages/sdk-js/src/index.ts"], ALL_SLUGS);
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  it('returns "all" for packages/react-core/** changes', () => {
    const result = classifyScope(
      ["packages/react-core/src/hooks.ts"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  it('returns "all" for showcase/shared/** changes', () => {
    const result = classifyScope(
      ["showcase/shared/some-config.json"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  it('returns "all" for showcase/aimock/** changes', () => {
    const result = classifyScope(
      ["showcase/aimock/fixtures/foo.json"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  it('returns "all" for showcase/docker-compose.local.yml changes', () => {
    const result = classifyScope(
      ["showcase/docker-compose.local.yml"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  it('returns "all" for pnpm-lock.yaml changes', () => {
    const result = classifyScope(["pnpm-lock.yaml"], ALL_SLUGS);
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  it('returns "all" for showcase/tests/** changes', () => {
    const result = classifyScope(
      ["showcase/tests/e2e/smoke.spec.ts"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });

  // ---- Per-integration pattern => mode: "per-integration" ----

  it('returns "per-integration" for showcase/integrations/mastra/** changes', () => {
    const result = classifyScope(
      ["showcase/integrations/mastra/src/app.ts"],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("per-integration");
    expect(result.slugs).toEqual(["mastra"]);
    expect(result.reason).toContain("mastra");
  });

  it('returns "per-integration" for multiple integration changes and deduplicates', () => {
    const result = classifyScope(
      [
        "showcase/integrations/mastra/src/a.ts",
        "showcase/integrations/mastra/src/b.ts",
        "showcase/integrations/crewai-crews/Dockerfile",
        "showcase/integrations/agno/package.json",
      ],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("per-integration");
    expect(result.slugs).toEqual(
      expect.arrayContaining(["mastra", "crewai-crews", "agno"]),
    );
    expect(result.slugs).toHaveLength(3);
  });

  // ---- Unrelated ----

  it('returns "unrelated" for docs/** changes', () => {
    const result = classifyScope(["docs/pages/getting-started.mdx"], ALL_SLUGS);
    expect(result.mode).toBe("unrelated");
    expect(result.slugs).toEqual([]);
  });

  it('returns "unrelated" for empty file list', () => {
    const result = classifyScope([], ALL_SLUGS);
    expect(result.mode).toBe("unrelated");
    expect(result.slugs).toEqual([]);
  });

  // ---- Precedence ----

  it("platform-wide takes precedence over per-integration when both present", () => {
    const result = classifyScope(
      [
        "showcase/integrations/mastra/src/app.ts",
        "packages/runtime/src/lib/foo.ts",
      ],
      ALL_SLUGS,
    );
    expect(result.mode).toBe("all");
    expect(result.slugs).toEqual(ALL_SLUGS);
  });
});
