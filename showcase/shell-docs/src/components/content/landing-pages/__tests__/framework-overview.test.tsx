import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FrameworkOverview } from "../framework-overview";
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
  it("renders the primary quickstart CTA and optional agent CLI setup action", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain("Quickstart");
    expect(markup).toContain("Start using agents");
    expect(markup).toContain('aria-controls="hero-cli-commands"');
    expect(markup).toContain("border-[var(--accent)]");
    expect(markup).toContain("bg-[var(--accent)]");
    expect(markup).toContain("shell-docs-primary-cta");
    expect(markup).toContain("text-[var(--primary-foreground)]");
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
