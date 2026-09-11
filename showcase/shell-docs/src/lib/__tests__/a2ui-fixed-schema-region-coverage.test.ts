import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function renderFixedSchemaGuide(framework: string): string {
  const loadSlug = "generative-ui/a2ui/fixed-schema";
  const doc = loadDoc(loadSlug);
  if (!doc) throw new Error(`missing ${loadSlug}`);

  return renderPageToLlmText(
    {
      url: `${framework}/${loadSlug}`,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug,
      framework,
    },
    { framework },
  );
}

test("the fixed-schema guide resolves each framework's native backend step", () => {
  const schemaLoadingFrameworks = ["ag2", "agno"];

  for (const framework of schemaLoadingFrameworks) {
    const output = renderFixedSchemaGuide(framework);
    expect(output, framework).toContain("def _load_schema");
    expect(output, framework).toContain("FLIGHT_SCHEMA");
    expect(output, framework).toContain("updateComponents");
    expect(output, framework).not.toContain(
      `region 'backend-schema-json-load' missing in ${framework}::a2ui-fixed-schema`,
    );
    expect(output, framework).not.toContain(
      `region 'backend-render-operations' missing in ${framework}::a2ui-fixed-schema`,
    );
  }

  const strandsTypeScript = renderFixedSchemaGuide("strands-typescript");
  expect(strandsTypeScript).toContain('name: "display_flight"');
  expect(strandsTypeScript).toContain("updateComponents");
  expect(strandsTypeScript).not.toContain(
    "region 'backend-render-operations' missing in strands-typescript::a2ui-fixed-schema",
  );
});
