import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  cliFrameworkForDocsSlug,
  FrameworkOverview,
} from "../framework-overview";
import { MdxFrameworkOverview } from "../mdx-framework-overview";
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
    expect(markup).toContain("Copy onboarding prompt");
    expect(markup).toContain('data-surface="docs_framework_hero"');
    expect(markup).toContain("shell-docs-primary-cta");
    expect(markup).toContain("bg-[var(--accent)]");
    expect(markup).toContain("text-[var(--primary-foreground)]");

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

    expect(markup).toContain("Copy onboarding prompt");
    expect(markup).toContain('data-surface="docs_framework_hero"');
    expect(markup).toContain(initCommand);

    // Prompt first, then Quickstart in the bordered treatment, then the chip.
    expect(markup.indexOf("Copy onboarding prompt")).toBeLessThan(
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

  // `hideOnboardingPrompt` exists so a page that already offers the prompt in
  // its page-tools row (DocsPageView passes the flag exactly when it rendered
  // `OnboardingPromptCopyButton`) does not show the reader the same prompt
  // twice. It must take out that button and nothing else.
  it("drops the hero onboarding button when hideOnboardingPrompt is set", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
        hideOnboardingPrompt
      />,
    );

    expect(markup).not.toContain("Copy onboarding prompt");
    expect(markup).not.toContain('data-surface="docs_framework_hero"');

    // The rest of the hero is untouched.
    expect(markup).toContain("Quickstart");
    expect(markup).toContain("shell-docs-cta-link");
    expect(markup).toContain(overviewData.header);
  });

  it("keeps the hero onboarding button when hideOnboardingPrompt is absent", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain("Copy onboarding prompt");
    expect(markup).toContain('data-surface="docs_framework_hero"');
  });

  it("drops only the prompt on a bespoke-init framework, keeping the command chip", () => {
    // The bespoke-init hero is a second, hand-rolled action row rather than
    // <HeroStartActions>, so it needs its own coverage.
    const initCommand =
      "npx copilotkit@latest init --framework claude-sdk-python";
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={{ ...overviewData, initCommand }}
        currentFramework="claude-sdk-python"
        hideOnboardingPrompt
      />,
    );

    expect(markup).not.toContain("Copy onboarding prompt");
    expect(markup).toContain("Quickstart");
    expect(markup).toContain(initCommand);
  });
});

describe("MdxFrameworkOverview", () => {
  // The MDX-embedded hero is the case the flag was added for: DocsPageView's
  // components map is what injects it, and it reaches the hero only through
  // this adapter.
  it("forwards hideOnboardingPrompt to the hero", () => {
    const withFlag = renderToStaticMarkup(
      <MdxFrameworkOverview
        frameworkName="Mastra"
        header="Bring your Mastra agents to your users"
        guideLink="/mastra/quickstart"
        currentFramework="mastra"
        hideOnboardingPrompt
      />,
    );
    const withoutFlag = renderToStaticMarkup(
      <MdxFrameworkOverview
        frameworkName="Mastra"
        header="Bring your Mastra agents to your users"
        guideLink="/mastra/quickstart"
        currentFramework="mastra"
      />,
    );

    expect(withFlag).not.toContain("Copy onboarding prompt");
    expect(withoutFlag).toContain("Copy onboarding prompt");
  });
});
