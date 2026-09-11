import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function renderStreamingGuide(framework: string): string {
  const loadSlug = "shared-state/streaming";
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

test("the streaming guide resolves each supported backend mapping", () => {
  const expectedSource = {
    "crewai-crews": "copilotkit_predict_state",
    "langgraph-fastapi": "StateStreamingMiddleware",
    mastra: "updateWorkingMemory",
    "ms-agent-dotnet": "FunctionMiddleware",
    "ms-agent-python": "PREDICT_STATE_CONFIG",
  } as const;

  for (const [framework, expected] of Object.entries(expectedSource)) {
    const output = renderStreamingGuide(framework);
    expect(output, framework).toContain(expected);
    expect(output, framework).not.toContain(
      `region 'state-streaming-middleware' missing in ${framework}::shared-state-streaming`,
    );
  }
});
