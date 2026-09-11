import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function renderReasoningGuide(framework: string): string {
  const loadSlug = "custom-look-and-feel/reasoning-messages";
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

test("the default reasoning guide resolves its no-slot-override source", () => {
  for (const framework of ["ms-agent-harness-dotnet", "ms-agent-python"]) {
    const output = renderReasoningGuide(framework);
    expect(output, framework).toContain("function Chat()");
    expect(output, framework).toContain("<CopilotChat");
    expect(output, framework).not.toContain(
      `region 'default-reasoning-zero-config' missing in ${framework}::reasoning-default`,
    );
  }
});
