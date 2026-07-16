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

  it("renders the framework identity with the shared themed icon hook", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain(
      "shell-docs-framework-icon shell-docs-radius-icon flex h-10 w-10 items-center justify-center border",
    );
  });

  it("does not add top padding before the framework hero", () => {
    const markup = renderToStaticMarkup(
      <FrameworkOverview
        data={overviewData}
        currentFramework="langgraph-python"
      />,
    );

    expect(markup).toContain(
      'class="shell-docs-framework-hero border-b border-[var(--border)] pb-8 sm:pb-10"',
    );
    expect(markup).not.toContain("pt-2 sm:pt-4");
  });
});
