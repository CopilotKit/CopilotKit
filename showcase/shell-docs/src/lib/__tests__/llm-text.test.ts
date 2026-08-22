import { expect, test } from "vitest";

import {
  CHANNEL_FRONTENDS,
  CHANNEL_GUIDE_ROUTES,
  channelConnectHref,
  channelGuideHref,
} from "../channel-guide-routes";
import { loadDoc } from "../docs-render";
import {
  getAllLlmPages,
  renderPageToLlmText,
  rewriteScopedDocsLinks,
} from "../llm-text";
import { getDocsMode, getIntegrations, ROOT_FRAMEWORK } from "../registry";

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

test("publishes channel connection guides at canonical URLs with the default agent", () => {
  const pages = getAllLlmPages({ channelGuideVariants: "all" });

  expect(pages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        url: "slack/connect",
        loadSlug: "frontends/slack",
        framework: "built-in-agent",
      }),
      expect.objectContaining({
        url: "teams/connect",
        loadSlug: "frontends/teams",
        framework: "built-in-agent",
      }),
    ]),
  );
  expect(
    pages.some(
      (page) =>
        page.url === "frontends/slack" || page.url === "frontends/teams",
    ),
  ).toBe(false);
});

test.each(["all", "content-unique"] as const)(
  "publishes the exact visible framework root set in %s mode",
  (channelGuideVariants) => {
    const pages = getAllLlmPages({ channelGuideVariants });
    const visibleFrameworkRoots = getIntegrations()
      .filter(
        (integration) =>
          integration.slug !== ROOT_FRAMEWORK &&
          getDocsMode(integration.slug) !== "hidden",
      )
      .map((integration) => integration.slug)
      .sort();
    const integrationSlugs = new Set(
      getIntegrations().map((integration) => integration.slug),
    );
    const actualRoots = pages
      .filter((page) => integrationSlugs.has(page.url))
      .map((page) => page.url)
      .sort();

    expect(actualRoots).toEqual(visibleFrameworkRoots);
    for (const slug of [
      "google-adk",
      "claude-sdk-python",
      "claude-sdk-typescript",
    ]) {
      expect(pages).toContainEqual(
        expect.objectContaining({
          url: slug,
          loadSlug: expect.stringMatching(/^integrations\/[^/]+\/quickstart$/),
          framework: slug,
        }),
      );
    }
  },
);

test("publishes the complete canonical channel discovery matrix", () => {
  const pages = getAllLlmPages({ channelGuideVariants: "all" });
  const urls = pages.map((page) => page.url);
  const visibleFrameworks = getIntegrations().filter(
    (integration) => getDocsMode(integration.slug) !== "hidden",
  );

  expect(urls).toEqual(
    expect.arrayContaining([
      "slack/tools",
      "slack/mastra/tools",
      "teams/langgraph-fastapi/interactive",
    ]),
  );
  expect(new Set(urls).size).toBe(urls.length);
  expect(urls.filter((url) => url.startsWith("channels/"))).toEqual([]);
  expect(urls).not.toContain("channels");
  expect(urls).toContain("reference/channels");

  for (const frontend of CHANNEL_FRONTENDS) {
    for (const integration of visibleFrameworks) {
      const connectUrl = channelConnectHref(frontend, integration.slug).slice(
        1,
      );
      expect(urls).toContain(connectUrl);

      for (const guide of CHANNEL_GUIDE_ROUTES) {
        const guideUrl = channelGuideHref(
          frontend,
          integration.slug,
          guide.slug,
        ).slice(1);
        const page = pages.find((candidate) => candidate.url === guideUrl);
        expect(page).toEqual(
          expect.objectContaining({
            frontend,
            framework: integration.slug,
            loadSlug: guide.sourceSlug,
          }),
        );
      }
    }
  }

  for (const page of pages.filter(
    (candidate) =>
      candidate.url === "slack" ||
      candidate.url.startsWith("slack/") ||
      candidate.url === "teams" ||
      candidate.url.startsWith("teams/"),
  )) {
    expect(page.frontend).toMatch(/^(slack|teams)$/);
    expect(page.framework).toBeTruthy();
  }
});

test("keeps only content-unique channel guide bodies in the compact corpus", () => {
  const pages = getAllLlmPages({ channelGuideVariants: "content-unique" });
  const visibleFrameworks = getIntegrations().filter(
    (integration) => getDocsMode(integration.slug) !== "hidden",
  );

  for (const frontend of CHANNEL_FRONTENDS) {
    const scopedPages = pages.filter(
      (page) => page.url === frontend || page.url.startsWith(`${frontend}/`),
    );
    const connectionGuides = scopedPages.filter((page) =>
      visibleFrameworks.some(
        (integration) =>
          page.url === channelConnectHref(frontend, integration.slug).slice(1),
      ),
    );
    const guides = scopedPages.filter((page) =>
      CHANNEL_GUIDE_ROUTES.some((guide) => page.loadSlug === guide.sourceSlug),
    );

    expect(connectionGuides).toHaveLength(visibleFrameworks.length);
    expect(guides).toHaveLength(CHANNEL_GUIDE_ROUTES.length);
    expect(guides.every((page) => page.framework === "built-in-agent")).toBe(
      true,
    );
  }
});

test("renders selected channel guide axes and scopes prose links", () => {
  const doc = loadDoc("channels/tools");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText({
    url: "teams/mastra/tools",
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: "channels/tools",
    frontend: "teams",
    framework: "mastra",
  });

  expect(output).toContain("](/teams/mastra/interactive)");
  expect(output).toContain("](/reference/channels/classes/Channel)");
  expect(output).toMatch(/native origin \(`"slack"` or\s+`"teams"`\)/i);
  expect(output).toContain("Microsoft Teams Adaptive Card");
  expect(output).not.toContain("Slack Block Kit");
  expect(output).not.toContain('provider: "teams"');
  expect(output).not.toContain('provider: "slack"');
});

test("rewrites scoped prose links without changing backtick or tilde fences", () => {
  const tripleFence = [
    '```ts title="triple"',
    'const href = "/channels/tools";',
    "```",
  ].join("\n");
  const longFence = [
    '````md title="long"',
    "[leave this](/channels/tools)",
    "````",
  ].join("\n");
  const tildeFence = [
    '~~~tsx title="tilde"',
    '<a href="/channels/tools">leave this</a>',
    "~~~",
  ].join("\n");
  const body = [
    "[rewrite this](/channels/tools)",
    tripleFence,
    longFence,
    tildeFence,
    '<a href="/reference/channels/classes/Thread">leave this global</a>',
  ].join("\n");

  const output = rewriteScopedDocsLinks(body, {
    url: "slack/mastra/tools",
    title: "Tools",
    filePath: "/tmp/tools.mdx",
    loadSlug: "channels/tools",
    frontend: "slack",
    framework: "mastra",
  });

  expect(output).toContain("[rewrite this](/slack/mastra/tools)");
  expect(output).toContain(
    '<a href="/reference/channels/classes/Thread">leave this global</a>',
  );
  expect(output).toContain(tripleFence);
  expect(output).toContain(longFence);
  expect(output).toContain(tildeFence);
});

test("expands the selected agent setup in channel Markdown output", () => {
  const doc = loadDoc("frontends/slack");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "slack/mastra",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "frontends/slack",
      framework: "mastra",
    },
    { frontend: "slack", framework: "mastra" },
  );

  expect(output).toContain("/api/copilotkit/agent/myAgent/run");
  expect(output).not.toContain("<FrameworkSetup");
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
  expect(langGraph).toContain("CopilotKitMiddleware");
  expect(langGraph).not.toContain("<FrameworkSetup");
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
    "The stable Hashbrown Angular package does not support the Angular 22 policy.",
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
  expect(angularAgentConfig).not.toContain("useAgentContext({");
  expect(angularSubagents).toContain(
    "readDelegations(this.agentStore().state())",
  );
  expect(angularSubagents).toContain("Exposing sub-agents as tools");
  expect(angularSubagents).not.toContain("useAgent({");
});

test.each([
  "langgraph-python",
  "google-adk",
  "strands",
  "claude-sdk-python",
  "claude-sdk-typescript",
])("renders a complete programmatic-control example for %s", (framework) => {
  const doc = loadDoc("programmatic-control");
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: `${framework}/programmatic-control`,
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug: "programmatic-control",
      framework,
    },
    { framework },
  );

  expect(output).toContain(
    'import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";',
  );
  expect(output).toContain("agent.addMessage({");
  expect(output).toContain("copilotkit.runAgent({ agent })");
  expect(output).toContain("copilotkit.stopAgent({ agent })");
  expect(output).toContain("if (agent.isRunning) return;");
  expect(output).toContain(
    'console.error("CopilotKit runAgent failed:", error);',
  );
  expect(output).toContain("disabled={agent.isRunning}");
  expect(output).toContain("disabled={!agent.isRunning}");

  for (const chatShellHelper of [
    "useAttachmentsConfig",
    "useAutoScroll",
    "consumeAttachments",
    "buildContent",
  ]) {
    expect(output).not.toContain(chatShellHelper);
  }

  if (framework === "google-adk") {
    expect(output).toContain("AGUIToolset()");
  }

  if (framework.startsWith("claude-sdk-")) {
    expect(output).not.toContain("createMessageId");
    expect(output).not.toContain("chat.tsx - useAgent run control");
    expect(output).not.toContain('agentId: "headless-simple"');
  }
});

test.each(["langgraph-python", "strands", "strands-typescript", "google-adk"])(
  "renders a lifecycle-safe shared-state initializer for %s",
  (framework) => {
    const loadSlug = "shared-state/rendering-in-app";
    const doc = loadDoc(loadSlug);
    expect(doc).not.toBeNull();

    const output = renderPageToLlmText(
      {
        url: `${framework}/${loadSlug}`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug,
        framework,
      },
      { framework },
    );

    expect(output).toContain('import { useEffect } from "react";');
    expect(output).toContain("const INITIAL_CANVAS_STATE: CanvasState = {");
    expect(output).toContain('title: "Project launch"');
    expect(output).toContain('label: "Research user needs"');
    expect(output).toContain("const { agent, isReady } = useAgent();");
    expect(output).toContain("if (!isReady) return;");
    expect(output).toContain("const current = (agent.state ?? {})");
    expect(output).toContain("if (current.title === undefined)");
    expect(output).toContain("if (current.items === undefined)");
    expect(output).toContain(
      "agent.setState({ ...(agent.state ?? {}), ...updates });",
    );
    expect(output).toContain("[agent, isReady, state.title, state.items]");
    expect(output).toContain("UI-owned initial state");
    expect(output).toMatch(/backend owns the initial\s+state/);
    expect(output).not.toContain("<TabItem");
    expect(output).not.toContain("from langgraph");
    expect(output).not.toContain("from strands");
    expect(output).not.toContain("from google.adk");
  },
);

test("publishes both canonical Strands starter commands in LLM text", () => {
  const loadSlug = "integrations/aws-strands/quickstart";
  const doc = loadDoc(loadSlug);
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "strands/quickstart",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug,
      framework: "strands",
    },
    { framework: "strands" },
  );

  expect(output).toContain(
    "npx copilotkit@latest create --framework aws-strands-py",
  );
  expect(output).toContain(
    "npx copilotkit@latest create --framework aws-strands-ts",
  );
  expect(output).toContain("Python 3.12+ (Python agents only)");
  expect(output).not.toContain(
    "npm install @ag-ui/aws-strands @strands-agents/sdk express cors",
  );
  expect(output).not.toContain("@types/cors");
});

test.each([
  ["claude-sdk-python", "programmatic-control"],
  ["claude-sdk-python", "headless"],
  ["claude-sdk-python", "human-in-the-loop/headless"],
  ["claude-sdk-typescript", "programmatic-control"],
  ["claude-sdk-typescript", "headless"],
  ["claude-sdk-typescript", "human-in-the-loop/headless"],
])(
  "keeps the shared Claude setup context-neutral for %s/%s",
  (framework, loadSlug) => {
    const doc = loadDoc(loadSlug);
    expect(doc).not.toBeNull();

    const output = renderPageToLlmText(
      {
        url: `${framework}/${loadSlug}`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug,
        framework,
      },
      { framework },
    );

    expect(output).not.toContain("complete frontend example below");
    expect(output).not.toContain("chat.tsx - useAgent run control");
  },
);

test("renders the Claude TypeScript SDK/MCP fixed-schema wiring only for that framework", () => {
  const doc = loadDoc("generative-ui/a2ui/fixed-schema");
  expect(doc).not.toBeNull();

  const render = (framework: string) =>
    renderPageToLlmText(
      {
        url: `${framework}/generative-ui/a2ui/fixed-schema`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug: "generative-ui/a2ui/fixed-schema",
        framework,
      },
      { framework },
    );

  const claudeTypeScript = render("claude-sdk-typescript");

  expect(claudeTypeScript).toContain('if (toolName === "display_flight")');
  expect(claudeTypeScript).toContain("shouldUseClaudeAgentSdk({");
  expect(claudeTypeScript).toContain("runWithClaudeAgentSdk({");
  expect(claudeTypeScript).toContain("new ClaudeAgentAdapter({");
  expect(claudeTypeScript).toContain("createSdkMcpServer({");
  expect(claudeTypeScript).toContain("mcp__copilotkit__display_flight");
  expect(claudeTypeScript).toContain(
    "toolSchemas: [DISPLAY_FLIGHT_TOOL_SCHEMA] as Anthropic.Tool[]",
  );
  expect(claudeTypeScript).not.toContain("no MCP server");
  expect(claudeTypeScript).not.toContain("<FrameworkSetup");

  const otherPublicFrameworks = getIntegrations()
    .filter((integration) => getDocsMode(integration.slug) !== "hidden")
    .map((integration) => integration.slug)
    .filter((framework) => framework !== "claude-sdk-typescript");
  for (const framework of otherPublicFrameworks) {
    const output = render(framework);
    expect(output, framework).not.toContain(
      'if (toolName === "display_flight")',
    );
    expect(output, framework).not.toContain("new ClaudeAgentAdapter({");
    expect(output, framework).not.toContain("createSdkMcpServer({");
    expect(output, framework).not.toContain(
      "toolSchemas: [DISPLAY_FLIGHT_TOOL_SCHEMA] as Anthropic.Tool[]",
    );
    expect(output, framework).not.toContain("<FrameworkSetup");
  }
});

test("renders executable Claude SDK tool wiring on both tool-rendering routes", () => {
  const doc = loadDoc("generative-ui/tool-rendering");
  expect(doc).not.toBeNull();

  const render = (framework: string) =>
    renderPageToLlmText(
      {
        url: `${framework}/generative-ui/tool-rendering`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug: "generative-ui/tool-rendering",
        framework,
      },
      { framework },
    );

  const python = render("claude-sdk-python");
  expect(python).toContain("create_sdk_mcp_server(");
  expect(python).toContain('options["mcp_servers"]');
  expect(python).toContain('options["allowed_tools"]');
  expect(python).toContain("ClaudeAgentAdapter(");
  expect(python).toContain("sdk_tool_handler");
  expect(python).toContain(
    "register this schema as an executable backend tool",
  );
  expect(python).not.toContain("<FrameworkSetup");

  const typeScript = render("claude-sdk-typescript");
  expect(typeScript).toContain("createSdkMcpServer({");
  expect(typeScript).toContain("mcpServers: backendToolServer.mcpServers");
  expect(typeScript).toContain("allowedTools: backendToolServer.allowedTools");
  expect(typeScript).toContain("new ClaudeAgentAdapter({");
  expect(typeScript).toContain("sdkTool(");
  expect(typeScript).toContain(
    "register this schema as an executable backend tool",
  );
  expect(typeScript).not.toContain("<FrameworkSetup");

  const control = render("langgraph-typescript");
  expect(control).not.toContain("createSdkMcpServer({");
  expect(control).not.toContain("create_sdk_mcp_server(");
  expect(control).not.toContain("ClaudeAgentAdapter");
  expect(control).not.toContain(
    "register this schema as an executable backend tool",
  );
  expect(control).not.toContain("<FrameworkSetup");
});

test.each(["google-adk", "langgraph-python", "mastra"])(
  "renders one dependency-complete canonical tool-rendering example for %s",
  (framework) => {
    const doc = loadDoc("generative-ui/tool-rendering");
    expect(doc).not.toBeNull();

    const output = renderPageToLlmText(
      {
        url: `${framework}/generative-ui/tool-rendering`,
        title: doc!.fm.title,
        description: doc!.fm.description,
        filePath: doc!.filePath,
        loadSlug: "generative-ui/tool-rendering",
        framework,
      },
      { framework },
    );

    for (const dependency of [
      'import { WeatherCard } from "../components/weather-card";',
      'import { FlightListCard, type Flight } from "../components/flight-list-card";',
      'import { parseJsonResult } from "../lib/parse-json-result";',
      'import { ToolRenderers } from "./tool-renderers";',
      "interface WeatherResult",
      "interface FlightSearchResult",
      "export function WeatherCard",
      "export function FlightListCard",
      "export function parseJsonResult",
      "export default function Page",
      '<CopilotKit runtimeUrl="/api/copilotkit" agent="tool-rendering">',
      "<ToolRenderers />",
      '<CopilotChat agentId="tool-rendering" />',
    ]) {
      expect(output, `${framework}: ${dependency}`).toContain(dependency);
    }

    expect(
      output.match(/const parsed = parseJsonResult<WeatherResult>\(result\);/g),
    ).toHaveLength(1);
    expect(
      output.match(
        /const parsed = parseJsonResult<FlightSearchResult>\(result\);/g,
      ),
    ).toHaveLength(1);
    expect(output).not.toContain("snippet skipped");

    if (framework === "google-adk") {
      expect(output).toContain("from google.adk.tools import ToolContext");
      expect(output).not.toContain("from langchain.tools import tool");
    } else if (framework === "langgraph-python") {
      expect(output).toContain("from langchain.tools import tool");
      expect(output).not.toContain("from google.adk.tools import ToolContext");
    } else {
      expect(output).toContain(
        'import { createTool } from "@mastra/core/tools";',
      );
      expect(output).not.toContain("from google.adk.tools import ToolContext");
    }
  },
);

test("renders executable Deep Agents state streaming in both languages", () => {
  const loadSlug = "integrations/deepagents/generative-ui/state-rendering";
  const doc = loadDoc(loadSlug);
  expect(doc).not.toBeNull();

  const output = renderPageToLlmText(
    {
      url: "deepagents/generative-ui/state-rendering",
      title: doc!.fm.title,
      description: doc!.fm.description,
      filePath: doc!.filePath,
      loadSlug,
      framework: "deepagents",
    },
    { framework: "deepagents" },
  );

  expect(output).toContain("class SearchesStateMiddleware(");
  expect(output).toContain("AgentMiddleware[AgentState, Any, Any]");
  expect(output).toContain("state_schema = AgentState");
  expect(output).toContain("def report_research_progress(");
  expect(output).toContain("runtime: ToolRuntime");
  expect(output).toContain("Command(");
  expect(output).toContain("tool_call_id=runtime.tool_call_id");
  expect(output).toContain("tools=[report_research_progress]");
  expect(output).toContain("SearchesStateMiddleware()");
  expect(output).toContain("CopilotKitMiddleware()");
  expect(output).toMatch(
    /StateItem\(\s*state_key="searches",\s*tool="report_research_progress",\s*tool_argument="searches"/,
  );

  expect(output).toContain(
    "const searchesStateMiddleware = createMiddleware({",
  );
  expect(output).toContain("const reportResearchProgress = tool(");
  expect(output).toContain("runtime: ToolRuntime<typeof SearchesStateSchema>");
  expect(output).toContain("new Command({");
  expect(output).toContain("tool_call_id: runtime.toolCallId");
  expect(output).toContain("tools: [reportResearchProgress]");
  expect(output).toContain("copilotkitMiddleware");
  expect(output).toMatch(
    /stateItem\(\{\s*stateKey: "searches",\s*tool: "report_research_progress",\s*toolArgument: "searches"/,
  );

  expect(output).not.toContain("emit_research_progress");
  expect(output).not.toContain("copilotkit_emit_state");
  expect(output).not.toContain("copilotkitEmitState");
  expect(output).not.toContain("chatNode");
});

test("raw Markdown keeps only the active framework's <WhenFrameworkHas> branch", () => {
  const slug = "generative-ui/a2ui/fixed-schema";
  const doc = loadDoc(slug);
  expect(doc).not.toBeNull();

  const page = {
    url: `langgraph-python/${slug}`,
    title: doc!.fm.title,
    description: doc!.fm.description,
    filePath: doc!.filePath,
    loadSlug: slug,
    framework: "langgraph-python",
  };
  const langgraph = renderPageToLlmText(page);

  // The gating tags themselves must never reach a Markdown consumer.
  expect(langgraph).not.toContain("WhenFrameworkHas");

  // langgraph-python is `a2ui_pattern: schema-loading`, so only that branch
  // survives. Emitting all three used to put the `schema-inline` prose ("the
  // host language doesn't ship a `load_schema` JSON loader") directly above a
  // snippet that calls `a2ui.load_schema`, and the `llm-driven` prose above
  // the very same fixed-schema code.
  expect(langgraph).toContain("Load the schema JSON at startup");
  expect(langgraph).not.toContain("Define the schema inline");
  expect(langgraph).not.toContain("Generate the schema dynamically");

  // A framework on a different pattern gets its own branch, not langgraph's.
  const mastra = renderPageToLlmText(
    { ...page, url: `mastra/${slug}`, framework: "mastra" },
    { framework: "mastra" },
  );
  expect(mastra).toContain("Generate the schema dynamically");
  expect(mastra).not.toContain("Load the schema JSON at startup");
  expect(mastra).not.toContain("Define the schema inline");
});
