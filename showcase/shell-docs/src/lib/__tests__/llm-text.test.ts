import { expect, test } from "vitest";

import { loadDoc } from "../docs-render";
import { getAllLlmPages, renderPageToLlmText } from "../llm-text";

test("publishes canonical Angular URLs instead of source-tree URLs", () => {
  const urls = getAllLlmPages().map((page) => page.url);

  expect(urls).toEqual(
    expect.arrayContaining([
      "angular",
      "angular/features",
      "angular/guides/chat-ui",
      "angular/guides/frontend-tools-generative-ui",
      "angular/guides/a2ui",
      "angular/guides/voice-multimodal",
      "angular/guides/human-in-the-loop",
      "angular/guides/shared-state",
      "angular/guides/threads-memory-attachments-headless",
      "angular/guides/troubleshooting",
      "angular/using-these-docs",
    ]),
  );
  expect(urls.some((url) => url.startsWith("frontends/angular"))).toBe(false);
});

test("swaps only frontend-specific Runtime code in LLM output", () => {
  const doc = loadDoc("backend/copilot-runtime");
  expect(doc).not.toBeNull();
  const page = {
    url: "angular/backend/copilot-runtime",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "backend/copilot-runtime",
  };

  const angular = renderPageToLlmText(page, { frontend: "angular" });
  const react = renderPageToLlmText(page, { frontend: "react" });

  expect(angular).toContain("@copilotkit/angular");
  expect(angular).not.toContain("@copilotkit/react-core");
  expect(react).toContain("@copilotkit/react-core");
  expect(react).not.toContain("@copilotkit/angular");
  expect(angular).not.toContain("<FrontendOnly");
});

test("keeps Angular Markdown links inside the Angular surface", () => {
  const overview = loadDoc("concepts/generative-ui-overview");
  expect(overview).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "angular/concepts/generative-ui-overview",
      title: overview!.fm.title,
      description: overview!.fm.description,
      filePath: overview!.filePath,
      loadSlug: "concepts/generative-ui-overview",
    },
    { frontend: "angular" },
  );

  expect(output).toContain("](/angular/guides/frontend-tools-generative-ui)");
  expect(output).toContain(
    'href="/angular/guides/frontend-tools-generative-ui"',
  );
  expect(output).not.toContain("](/generative-ui/");
  expect(output).not.toContain('href="/generative-ui/');
});

test("keeps cross-backend and root-only Markdown links resolvable", () => {
  const quickstart = loadDoc("frontends/angular");
  expect(quickstart).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "angular/langgraph-python/quickstart",
      title: quickstart!.fm.title,
      description: quickstart!.fm.description,
      filePath: quickstart!.filePath,
      loadSlug: "frontends/angular",
      framework: "langgraph-python",
    },
    { frontend: "angular", framework: "langgraph-python" },
  );

  expect(output).toContain("](/angular/model-selection)");
  expect(output).toContain(
    "](/angular/langgraph-python/backend/copilot-runtime)",
  );
  expect(output).not.toContain("/angular/langgraph-python/angular/");
});

test("keeps only the Angular quickstart branch for the selected backend", () => {
  const quickstart = loadDoc("frontends/angular");
  expect(quickstart).not.toBeNull();
  const page = {
    url: "angular/quickstart",
    title: quickstart!.fm.title,
    description: quickstart!.fm.description,
    filePath: quickstart!.filePath,
    loadSlug: "frontends/angular",
  };

  const standalone = renderPageToLlmText(page, { frontend: "angular" });
  const langGraph = renderPageToLlmText(
    {
      ...page,
      url: "angular/langgraph-python/quickstart",
      framework: "langgraph-python",
    },
    { frontend: "angular", framework: "langgraph-python" },
  );

  expect(standalone).toContain("new BuiltInAgent");
  expect(standalone).not.toContain("<FrameworkSetup");
  expect(langGraph).toContain('<FrameworkSetup concept="agent-setup" />');
  expect(langGraph).not.toContain("new BuiltInAgent");
  expect(`${standalone}\n${langGraph}`).not.toContain("<WhenAngularBackend");
});

test("expands canonical Angular Showcase regions in LLM output", () => {
  const doc = loadDoc("frontends/angular/guides/frontend-tools-generative-ui");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "angular/guides/frontend-tools-generative-ui",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "frontends/angular/guides/frontend-tools-generative-ui",
  });

  expect(output).toContain("features/tools/tool-feature-model.ts");
  expect(output).toContain('name: "change_background"');
  expect(output).not.toContain("<AngularSnippet");
});

test("publishes Angular-native voice, multimodal, and A2UI guidance", () => {
  const voiceDoc = loadDoc("frontends/angular/guides/voice-multimodal");
  const a2uiDoc = loadDoc("frontends/angular/guides/a2ui");
  expect(voiceDoc).not.toBeNull();
  expect(a2uiDoc).not.toBeNull();

  const voice = renderPageToLlmText({
    url: "angular/guides/voice-multimodal",
    title: voiceDoc!.fm.title,
    description: voiceDoc!.fm.description,
    filePath: voiceDoc!.filePath,
    loadSlug: "frontends/angular/guides/voice-multimodal",
  });
  const a2ui = renderPageToLlmText({
    url: "angular/guides/a2ui",
    title: a2uiDoc!.fm.title,
    description: a2uiDoc!.fm.description,
    filePath: a2uiDoc!.filePath,
    loadSlug: "frontends/angular/guides/a2ui",
  });

  expect(voice).toContain("features/media/media-feature.component.ts");
  expect(voice).toContain("maxSize: 10 * 1024 * 1024");
  expect(voice).toContain("features/media/media-model.ts");
  expect(a2ui).toContain("features/a2ui/a2ui-catalogs.ts");
  expect(a2ui).toContain("styles.css");
  expect(a2ui).toContain(
    "The stable Hashbrown Angular package does not support the complete Angular 20 through 22 policy.",
  );
  expect(a2ui).toContain(
    "JSON Renderer does not provide an Angular renderer; use A2UI for declarative Angular interfaces.",
  );
  expect(`${voice}\n${a2ui}`).not.toContain("<AngularSnippet");
  expect(`${voice}\n${a2ui}`).not.toMatch(/\bReact(?:JS)?\b/i);
});

test("keeps shared backend guidance while expanding Angular source regions", () => {
  const agentConfig = loadDoc("agent-config");
  const subagents = loadDoc("multi-agent/subagents");
  expect(agentConfig).not.toBeNull();
  expect(subagents).not.toBeNull();

  const angularAgentConfig = renderPageToLlmText(
    {
      url: "angular/langgraph-python/agent-config",
      title: agentConfig!.fm.title,
      description: agentConfig!.fm.description,
      filePath: agentConfig!.filePath,
      loadSlug: "agent-config",
      framework: "langgraph-python",
    },
    { frontend: "angular", framework: "langgraph-python" },
  );
  const angularSubagents = renderPageToLlmText(
    {
      url: "angular/langgraph-python/multi-agent/subagents",
      title: subagents!.fm.title,
      description: subagents!.fm.description,
      filePath: subagents!.filePath,
      loadSlug: "multi-agent/subagents",
      framework: "langgraph-python",
    },
    { frontend: "angular", framework: "langgraph-python" },
  );

  expect(angularAgentConfig).toContain(
    "connectAgentContext(this.configContext)",
  );
  expect(angularAgentConfig).toContain(
    "The backend half is also a single node.",
  );
  expect(angularAgentConfig).not.toContain("useAgentContext");
  expect(angularSubagents).toContain(
    "readDelegations(this.agentStore().state())",
  );
  expect(angularSubagents).toContain("Exposing sub-agents as tools");
  expect(angularSubagents).not.toContain("useAgent({");
});
