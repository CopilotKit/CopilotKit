import { expect, test } from "vitest";

import { resolveFrameworkContent } from "../framework-content-resolution";

test("resolves the same sparse overrides used by framework-scoped HTML", () => {
  expect(
    resolveFrameworkContent("langgraph-python", "auth")?.contentSlugPath,
  ).toBe("auth");
  expect(
    resolveFrameworkContent("built-in-agent", "auth")?.contentSlugPath,
  ).toBe("auth");
  expect(
    resolveFrameworkContent("langgraph-typescript", "quickstart")
      ?.contentSlugPath,
  ).toBe("integrations/langgraph/quickstart");
  expect(
    resolveFrameworkContent("google-adk", "threads-import")?.contentSlugPath,
  ).toBe("integrations/adk/threads-import");
});

test("keeps generated root pages ahead of sparse framework fallbacks", () => {
  expect(
    resolveFrameworkContent("langgraph-python", "agentic-chat-ui")
      ?.contentSlugPath,
  ).toBe("agentic-chat-ui");
});

test("does not synthesize content for unknown framework paths", () => {
  expect(
    resolveFrameworkContent("langgraph-python", "not-a-real-guide"),
  ).toBeNull();
});
