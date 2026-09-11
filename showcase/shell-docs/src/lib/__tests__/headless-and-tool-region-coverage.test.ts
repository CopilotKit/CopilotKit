import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function renderGuide(loadSlug: string, framework: string): string {
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

test("headless guides resolve the Microsoft Agent Framework hook setup", () => {
  for (const framework of ["ms-agent-harness-dotnet", "ms-agent-python"]) {
    const output = renderGuide("custom-look-and-feel/headless-ui", framework);
    expect(output, framework).toContain("useAgent");
    expect(output, framework).toContain("useCopilotKit");
    expect(output, framework).not.toContain(
      `region 'use-agent-simple' missing in ${framework}::headless-simple`,
    );
  }
});

test("tool-rendering guides resolve their native weather backend", () => {
  for (const framework of ["ms-agent-harness-dotnet", "strands-typescript"]) {
    const output = renderGuide("generative-ui/tool-rendering", framework);
    expect(output, framework).toContain("get_weather");
    expect(output, framework).not.toContain(
      `region 'weather-tool-backend' missing in ${framework}::tool-rendering`,
    );
  }
});
