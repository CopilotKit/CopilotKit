import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  cliFrameworkForDocsSlug,
  FrameworkOverview,
} from "../framework-overview";
import type { FrameworkOverviewData } from "@/data/frameworks/types";

const overviewData: FrameworkOverviewData = {
  slug: "langgraph-python",
  frameworkName: "LangChain",
  iconKey: "langgraph",
  header: "Bring your LangChain agents to your users",
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
    // The Claude Agent SDK overviews pass a framework-scoped init command, so
    // they render the chip branch rather than the shared hero action row. They
    // still have to lead with the prompt, and they still have to keep the
    // command chip: nothing else on the page carries that command.
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
    expect(markup).toContain(initCommand);

    // Prompt first, then Quickstart in the bordered treatment, then the chip.
    expect(markup.indexOf("Copy Prompt")).toBeLessThan(
      markup.indexOf("Quickstart"),
    );
    expect(markup.indexOf("Quickstart")).toBeLessThan(
      markup.indexOf(initCommand),
    );
    expect(markup).toContain("shell-docs-cta-link");
  });

  it("renders the framework identity icon in accent purple", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain(
      "shell-docs-radius-icon flex h-10 w-10 items-center justify-center border border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]",
    );
  });

  it("does not add top padding before the framework hero", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain('class="pb-8 sm:pb-12"');
    expect(markup).not.toContain("pt-2 sm:pt-4");
  });

  it("renders framework feature copy for the selected Angular frontend", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={{
          ...overviewData,
          supportedFeatures: [
            {
              title: "Generative UI",
              description: "Render custom React components from agent output.",
              documentationLink: "/langgraph-python/quickstart",
            },
          ],
        }}
        currentFramework="langgraph-python"
        frontendOverride="angular"
      />,
    );

    expect(markup).toContain("custom Angular components");
    expect(markup).not.toContain("React components");
  });
});
