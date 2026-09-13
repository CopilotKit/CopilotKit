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
  expect(rendered("integrations/agno/frontend-tools")).toContain(
    "](/reference/hooks/useFrontendTool)",
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

test("uses the AG2 runtime header and server gate for authentication", () => {
  const guide = source("integrations/ag2/auth");
  expect(guide).toContain('region="auth-request-headers"');
  expect(guide).toContain('region="auth-runtime-transport"');
  expect(guide).toContain('region="auth-on-request-gate"');
  expect(guide).not.toContain("properties={{");
  expect(guide).not.toContain("LangGraph Platform equivalent");

  const output = rendered("integrations/ag2/auth");
  expect(output).toContain("headers={headers}");
  expect(output).toContain('request.headers.get("authorization")');
  expect(output).toContain("onRequest");
});

test("keeps audited quickstart install commands on current package-manager defaults", () => {
  const claude = source("integrations/claude-sdk-typescript/quickstart");
  expect(claude).toContain("@anthropic-ai/claude-agent-sdk @anthropic-ai/sdk");
  expect(claude).not.toContain("@anthropic-ai/claude-agent-sdk@^");

  const crewai = source("integrations/crewai-flows/quickstart");
  expect(crewai).toContain(
    "pip install -U crewai ag-ui-crewai fastapi uvicorn",
  );
  expect(crewai).not.toContain("crewai>=");
});

test("uses the CrewAI Showcase flow and browser tool for HITL", () => {
  const guide = source("integrations/crewai-flows/human-in-the-loop/flow");
  expect(guide).toContain('framework="crewai-crews"');
  expect(guide).toContain('cell="hitl-in-chat"');
  expect(guide).toContain('region="hitl-hook"');
  expect(guide).toContain('region="hitl-flow"');
  expect(guide).not.toContain("renderAndWaitForResponse");
  expect(guide).not.toContain('available: "remote"');

  const output = rendered("integrations/crewai-flows/human-in-the-loop/flow");
  expect(output).toContain("useHumanInTheLoop({");
  expect(output).toContain('name: "book_call"');
  expect(output).toContain("tools=self.state.copilotkit.actions or None");
  expect(output).toContain(
    "self.state.messages.append(response.choices[0].message)",
  );
  expect(output).not.toContain("SampleAgentFlow");
});

test("selects the active Microsoft Agent Framework interactive example", () => {
  const guide = source(
    "integrations/microsoft-agent-framework/generative-ui/your-components/interactive",
  );
  expect(guide).toContain("framework={props.framework}");
  expect(guide).not.toContain('framework="microsoft-agent-framework-dotnet"');
});

test("uses the distinct Microsoft Agent Framework A2UI policies", () => {
  const guide = source(
    "integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema",
  );
  expect(guide).toContain("snippet_cell: declarative-gen-ui");
  expect(guide).toContain('framework="ms-agent-dotnet"');
  expect(guide).toContain('framework="ms-agent-python"');
  expect(guide).toContain('region="a2ui-runtime-policy"');
  expect(guide).toContain('region="dynamic-a2ui-agent"');

  const output = rendered(
    "integrations/microsoft-agent-framework/generative-ui/a2ui/dynamic-schema",
  );
  expect(output).toContain("injectA2UITool: false");
  expect(output).toContain("injectA2UITool: true");
  expect(output).toContain('Name = "generate_a2ui"');
  expect(output).toContain("The agent has no tools");
});

test("uses the Microsoft Agent Framework steps publisher and public route key", () => {
  const guide = source(
    "integrations/microsoft-agent-framework/generative-ui/state-rendering",
  );
  expect(guide).toContain("snippet_cell: gen-ui-agent");
  expect(guide).toContain('region="state-rendering-runtime"');
  expect(guide).toContain('region="state-rendering-publisher"');
  expect(guide).toContain('region="state-rendering-subscription"');
  expect(guide).not.toContain("IframeSwitcher");
  expect(guide).not.toContain("search_agent");

  const output = rendered(
    "integrations/microsoft-agent-framework/generative-ui/state-rendering",
  );
  expect(output).toContain('agents["gen-ui-agent"] = createGenUiAgent()');
  expect(output).toContain("def set_steps(");
  expect(output).toContain('state={"steps": steps}');
  expect(output).toContain('agentId: "gen-ui-agent"');
});

test("does not present an unavailable Pydantic state-rendering demo as runnable", () => {
  const guide = source(
    "integrations/pydantic-ai/generative-ui/state-rendering",
  );
  expect(guide).toContain("This Showcase example is not ready");
  expect(guide).toContain("not a limitation of\nPydantic AI");
  expect(guide).toContain("/pydantic-ai/shared-state");
  expect(guide).not.toContain("IframeSwitcher");
  expect(guide).not.toContain("useAgent({");

  const output = rendered(
    "integrations/pydantic-ai/generative-ui/state-rendering",
  );
  expect(output).toContain("This Showcase example is not ready");
  expect(output).toContain("frontend expects `steps`");
  expect(output).toContain("backend currently exposes `todos`");
  expect(output).toContain("](/pydantic-ai/shared-state)");
  expect(output).not.toContain("my_agent");
});
