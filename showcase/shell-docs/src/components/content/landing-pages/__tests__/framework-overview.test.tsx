import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  cliFrameworkForDocsSlug,
  FrameworkOverview,
} from "../framework-overview";
import type { FrameworkOverviewData } from "@/data/frameworks/types";

const overviewData: FrameworkOverviewData = {
  slug: "langgraph-python",
  frameworkName: "LangGraph",
  iconKey: "langgraph",
  header: "Bring your LangGraph agents to your users",
  subheader: "Build rich, interactive, agent-powered applications.",
  guideLink: "/langgraph-python/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink: "/langgraph-python",
  supportedFeatures: [],
  liveDemos: [],
};

describe("FrameworkOverview", () => {
  it.each(["react", "angular"] as const)(
    "can prepend authored content without losing the %s Intelligence CTA attribution",
    (frontend) => {
      const markup = renderToStaticMarkup(
        <FrameworkOverview
          data={{
            ...overviewData,
            preserveCtaWithAfterFeatures: true,
            cta: {
              variant: "card",
              title: "Keep the existing Intelligence action",
              body: "Connect your app to Intelligence.",
              ctaLabel: "Create a free account",
              surface: "docs_history_cta",
            },
          }}
          currentFramework="langgraph-python"
          frontendOverride={frontend}
          afterFeatures={<p>Existing conversation history</p>}
        />,
      );
      const ctaHref = [...markup.matchAll(/href="([^"]+)"/g)]
        .map((match) => match[1].replaceAll("&amp;", "&"))
        .find((href) => href.includes("utm_content=docs_history_cta"));

      expect(ctaHref).toBeDefined();
      const params = new URL(ctaHref!).searchParams;
      expect(params.get("utm_frontend")).toBe(frontend);
      expect(params.get("utm_backend")).toBe("langgraph-python");
      expect(markup.indexOf("Existing conversation history")).toBeLessThan(
        markup.indexOf("Keep the existing Intelligence action"),
      );
    },
  );

  it.each([
    ["strands", "aws-strands-py"],
    ["strands-typescript", "aws-strands-ts"],
  ])(
    "uses the verified CLI framework id for the %s overview",
    (currentFramework, cliFramework) => {
      expect(cliFrameworkForDocsSlug(currentFramework)).toBe(cliFramework);
    },
  );

  it("makes the coding-agent prompt the primary hero action and Quickstart secondary", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    // The prompt button carries the accent treatment...
    expect(markup).toContain("Copy Prompt");
    expect(markup).toContain('data-surface="docs_framework_hero"');
    expect(markup).toContain("prompt-pill-dock");
    expect(markup).toContain("Open in Claude Code");
    expect(markup).toContain("Open in Codex");

    // ...and Quickstart keeps its place beside it in the bordered treatment.
    expect(markup).toContain("Quickstart");
    expect(markup).toContain("shell-docs-cta-link");
    expect(markup).toContain("bg-[var(--bg-surface)]");

    // The removed CLI command menu must not come back through this surface.
    expect(markup).not.toContain("Start using agents");
    expect(markup).not.toContain("hero-cli-commands");
    expect(markup).not.toContain("npx copilotkit@latest create");
  });

  it("leads with the prompt on a framework whose init command is bespoke", () => {
    const initCommand =
      "npx copilotkit@latest init --framework claude-sdk-python";
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={{ ...overviewData, initCommand }}
        currentFramework="claude-sdk-python"
      />,
    );

    expect(markup).toContain("Copy Prompt");
    expect(markup).toContain('data-surface="docs_framework_hero"');
    expect(markup).not.toContain(initCommand);

    // Keep the primary setup actions without an extra terminal section.
    expect(markup.indexOf("Copy Prompt")).toBeLessThan(
      markup.indexOf("Quickstart"),
    );
    expect(markup).toContain("shell-docs-cta-link");
  });

  it("adapts the main landing positioning to the selected partner", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );
    expect(markup).toContain("Bring your LangGraph agents");
    expect(markup).toContain("into any app");
    expect(markup).toContain("open-source framework");
    expect(markup).toContain(
      "Give your agents chat, generative UI, human-in-the-loop, Threads, Learning and more.",
    );
    expect(markup).toContain("Start building");
    expect(markup).not.toContain("Watch product walkthroughs");
    expect(markup).not.toContain("How CopilotKit connects to");
  });

  it("keeps the selected partner’s showcase destination and hero quickstart", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-typescript"
        showcaseDemos={[
          {
            id: "agentic-chat",
            embedHref:
              "https://showcase-langgraph-typescript-production.up.railway.app/demos/agentic-chat",
            title: "Chat",
            description: "Try chat",
            href: "https://showcase.copilotkit.ai/react/langgraph-typescript/agentic-chat",
          },
        ]}
      />,
    );
    expect(markup).toContain(
      'src="https://showcase-langgraph-typescript-production.up.railway.app/demos/agentic-chat"',
    );
    expect(markup).toContain('href="/langgraph-typescript/quickstart"');
    expect(markup).not.toContain("examples-coagents");
  });

  it("replaces duplicate demo cards and tutorial links with one feature explorer", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );
    expect(markup).toContain("Threads");
    expect(markup).toContain("Learning");
    expect(markup).not.toContain("Build on your integration");
    expect(markup).not.toContain("partner-tutorial");
    expect(markup).not.toContain("Try LangGraph in action");
  });

  it("renders authored capabilities and connection content", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={{
          ...overviewData,
          lede: "Capability-specific copy.",
          supportedFeatures: [
            {
              title: "Generative UI",
              description: "Render agent output in the app.",
              documentationLink: "/langgraph-python/generative-ui",
            },
          ],
          capabilitiesFootnote: {
            text: "More capabilities are available.",
            linkLabel: "See them all",
            href: "/langgraph-python/build-with-agents",
          },
          connect: {
            intro: "Run the agent in your own service.",
            filename: "app/api/copilotkit/route.ts",
            code: "export const runtime = {};",
            guideLink: "/langgraph-python/quickstart",
          },
          showcase: {
            integration: "langgraph-python",
            intro: "Explore the running integration.",
            demos: [],
          },
        }}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain("Capability-specific copy.");
    expect(markup).toContain("Run the agent in your own service.");
    expect(markup).toContain("export const runtime = {};");
    expect(markup).toContain("Explore the running integration.");
  });
});
