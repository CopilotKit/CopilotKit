import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

const routes = [
  "generative-ui/tool-rendering",
  "generative-ui/state-rendering",
  "frontend-tools",
  "auth",
  "human-in-the-loop",
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
    expect(output).toContain("model=");
    expect(output).toContain("AZURE_OPENAI_CHAT_DEPLOYMENT_NAME");
    expect(output).toContain('api_key=os.getenv("AZURE_OPENAI_API_KEY")');
    expect(output).toContain(
      'azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")',
    );
    expect(output).not.toContain("from agent_framework.azure");
    expect(output).not.toContain("AzureOpenAIChatClient");
    expect(output).not.toContain("model_id=");
  },
);
