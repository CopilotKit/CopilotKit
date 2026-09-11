import { expect, test } from "vitest";
import { loadDoc } from "../docs-render";
import { renderPageToLlmText } from "../llm-text";

function source(slug: string): string {
  const doc = loadDoc(slug);
  if (!doc) throw new Error(`Missing guide: ${slug}`);
  return doc.source;
}

function rendered(slug: string): string {
  const doc = loadDoc(slug);
  if (!doc) throw new Error(`Missing guide: ${slug}`);
  return renderPageToLlmText({
    url: slug,
    title: doc.fm.title,
    description: doc.fm.description,
    filePath: doc.filePath,
    loadSlug: slug,
  });
}

test("keeps AG2, Agno, and Mastra frontend-tool guidance on the v2 reference", () => {
  for (const slug of [
    "integrations/ag2/frontend-tools",
    "integrations/agno/frontend-tools",
    "integrations/mastra/frontend-tools",
  ]) {
    const guide = source(slug);
    expect(guide).toContain("/reference/hooks/useFrontendTool");
    expect(guide).not.toContain("/reference/v1/hooks/useFrontendTool");
  }

  const ag2 = source("integrations/ag2/frontend-tools");
  expect(ag2).toContain('framework="ag2"');
  expect(ag2).toContain('cell="frontend-tools"');
  expect(ag2).toContain('region="frontend-tool-registration"');
  expect(ag2).not.toContain('available: "remote"');
  expect(rendered("integrations/ag2/frontend-tools")).toContain(
    'name: "change_background"',
  );
});

test("uses the Showcase-owned named-renderer example in the AG2 guide", () => {
  const tool = source("integrations/ag2/generative-ui/tool-rendering");
  expect(tool).toContain('cell="tool-rendering"');
  expect(tool).toContain('region="render-weather-tool"');
  expect(tool).not.toContain("args.location");
  const renderedTool = rendered(
    "integrations/ag2/generative-ui/tool-rendering",
  );
  expect(renderedTool).toContain("parameters: z.object({");
  expect(renderedTool).toContain("parameters?.location");
  expect(renderedTool).toContain("[],");
});

test("uses the running AG2 state publisher and stream setup", () => {
  const guide = source("integrations/ag2/generative-ui/state-rendering");
  expect(guide).toContain('cell="gen-ui-agent"');
  expect(guide).toContain('region="gen-ui-agent-steps-tool"');
  expect(guide).toContain('region="gen-ui-agent-runtime"');
  expect(guide).not.toContain("StateSnapshotEvent");
  expect(guide).not.toContain('name="assistant"');

  const output = rendered("integrations/ag2/generative-ui/state-rendering");
  expect(output).toContain("async def set_steps(");
  expect(output).toContain('context_variables.update({"steps": cleaned})');
  expect(output).toContain('name="gen_ui_agent"');
  expect(output).toContain("gen_ui_agent_app.mount");
  expect(output).toContain('agentId: "gen-ui-agent"');
});
