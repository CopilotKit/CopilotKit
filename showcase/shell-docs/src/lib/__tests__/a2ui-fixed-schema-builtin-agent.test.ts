import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

test("the Built-in Agent fixed-schema guide resolves its inline schema source", () => {
  const loadSlug = "generative-ui/a2ui/fixed-schema";
  const doc = loadDoc(loadSlug);
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: `built-in-agent/${loadSlug}`,
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug,
      framework: "built-in-agent",
    },
    { framework: "built-in-agent" },
  );

  expect(output).toContain("Schema-inline");
  expect(output).toContain("built-in-agent");
  expect(output).toContain("const FLIGHT_SCHEMA: unknown[]");
  expect(output).toContain("updateComponentsOp(SURFACE_ID, FLIGHT_SCHEMA)");
  expect(output).not.toContain("snippet skipped:");
  expect(output).not.toContain("Missing snippet");
  expect(output).not.toContain("<Snippet");
});
