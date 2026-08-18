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
