import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

const routes = [
  "generative-ui/tool-rendering",
  "generative-ui/state-rendering",
  "frontend-tools",
  "auth",
  "human-in-the-loop",
  "quickstart",
  "shared-state/in-app-agent-read",
  "shared-state/in-app-agent-write",
];

test.each(routes)(
  "renders the stable Microsoft Agent Python API on %s",
  (route) => {
    const page = getAllLlmPages().find(
      (candidate) => candidate.url === `ms-agent-python/${route}`,
    );
    expect(page).toBeDefined();

    const doc = loadDoc(page!.loadSlug);
    expect(doc).not.toBeNull();

    const output = renderPageToLlmText(
      {
        ...page!,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
      },
      { framework: "ms-agent-python" },
    );

    expect(output).toContain(
      "from agent_framework.openai import OpenAIChatClient",
    );
    expect(output).toContain(
      "from azure.identity import DefaultAzureCredential",
    );
    expect(output).toContain("model=");
    expect(output).toContain("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME");
    expect(output).toContain(
      'azure_api_key = os.getenv("AZURE_OPENAI_API_KEY")',
    );
    expect(output).toContain("api_key=azure_api_key");
    expect(output).toContain(
      "credential=None if azure_api_key else DefaultAzureCredential()",
    );
    expect(output).toContain(
      'azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")',
    );
    expect(output).not.toContain("from agent_framework.azure");
    expect(output).not.toContain("AzureOpenAIChatClient");
    expect(output).not.toContain("model_id=");
  },
);

test("renders request-local app context forwarding for Microsoft Agent Python", () => {
  const page = getAllLlmPages().find(
    (candidate) => candidate.url === "ms-agent-python/agent-app-context",
  );
  expect(page).toBeDefined();

  const doc = loadDoc(page!.loadSlug);
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      ...page!,
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
    },
    { framework: "ms-agent-python" },
  );

  expect(output).toContain(
    "from agent_framework_ag_ui import AgentFrameworkAgent",
  );
  expect(output).toContain("class ContextAwareAgent(AgentFrameworkAgent)");
  expect(output).toContain("request_input = dict(input_data)");
  expect(output).toContain('request_input["messages"]');
  expect(output).toContain('message["id"].endswith("-app-context")');
  expect(output).toContain("json.dumps(value, ensure_ascii=False, indent=2)");
  expect(output).toContain("or str(uuid4())");
  expect(output).toContain('"role": "system"');
  expect(output).toContain("async for event in super().run(input_data)");
  expect(output).not.toContain("get('runId', 'request')");
  expect(output).not.toContain("frontend context is forwarded automatically");
  expect(output).not.toContain('default_options["instructions"]');
});
