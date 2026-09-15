import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MdxFrameworkOverview } from "../mdx-framework-overview";
import type { MdxFrameworkOverviewProps } from "../mdx-framework-overview";

// The adapter assembles `FrameworkOverviewData` field by field instead of
// spreading, so a prop that authored MDX sets but the adapter does not name
// is dropped in silence — no type error, no runtime warning, just a missing
// section on a live page. That is exactly what happened to `afterFeatures`
// and `cta`: `integrations/microsoft-agent-framework/index.mdx` and
// `integrations/langgraph/index.mdx` both pass an Intelligence CTA through
// `afterFeatures`, and none of it reached the rendered page.
//
// These tests pin the forwarding of every slot that renders content, so the
// next field added to the interface cannot be forgotten in `synthData`
// without a red test.

const baseProps: MdxFrameworkOverviewProps = {
  frameworkName: "Microsoft Agent Framework",
  header: "Bring your Agent Framework agents to your users",
  subheader: "Give your agents real user-interactivity.",
  guideLink: "/ms-agent-dotnet/quickstart",
  supportedFeatures: [],
  liveDemos: [],
  lede: "Connect your agent to your app.",
};

const render = (props: Partial<MdxFrameworkOverviewProps> = {}) =>
  renderToStaticMarkup(<MdxFrameworkOverview {...baseProps} {...props} />);

describe("MdxFrameworkOverview", () => {
  it("forwards the afterFeatures slot to the rendered page", () => {
    const markup = render({
      afterFeatures: <p data-testid="after-features">Add persistent threads</p>,
    });

    expect(markup).toContain('data-testid="after-features"');
    expect(markup).toContain("Add persistent threads");
  });

  it("forwards the structured cta when no afterFeatures node is given", () => {
    const markup = render({
      cta: {
        variant: "card",
        title: "Bring your Agent Framework agents to production",
        body: "Add persistent threads and the inspector with CopilotKit Intelligence.",
        ctaLabel: "Explore Intelligence",
        surface: "docs_ms_agent_overview",
      },
    });

    expect(markup).toContain("Bring your Agent Framework agents to production");
    expect(markup).toContain("CopilotKit Intelligence");
  });

  // Mirrors FrameworkOverview's own contract:
  // `afterFeatures ?? (cta ? <OpsPlatformCTA/> : null)`.
  it("lets afterFeatures win over cta when both are supplied", () => {
    const markup = render({
      afterFeatures: <p data-testid="explicit-slot">explicit slot</p>,
      cta: {
        variant: "card",
        title: "Structured fallback title",
        body: "Structured fallback body.",
        ctaLabel: "Fallback",
        surface: "docs_fallback",
      },
    });

    expect(markup).toContain("explicit slot");
    expect(markup).not.toContain("Structured fallback title");
  });

  it("renders no custom slot when the authored file supplies none", () => {
    const markup = render();

    expect(markup).not.toContain("data-testid");
    expect(markup).not.toContain("docs_fallback");
  });
});

describe("overview media and scoped links", () => {
  it("keeps videos, architecture, tutorial and explicit content alongside a lede", () => {
    const markup = render({
      bannerVideo: "https://example.com/overview.mp4",
      architectureVideo: "https://example.com/architecture.mp4",
      tutorialLink: "/ms-agent-dotnet/tutorial",
      afterFeatures: <p>Authored content</p>,
    });
    expect(markup).toContain("https://example.com/overview.mp4");
    expect(markup).toContain("https://example.com/architecture.mp4");
    expect(markup).toContain('href="/ms-agent-dotnet/tutorial"');
    expect(markup).toContain("Authored content");
  });
  it("keeps Intelligence guides in the selected backend", () => {
    const markup = render();
    expect(markup).toContain('href="/ms-agent-dotnet/threads"');
    expect(markup).toContain('href="/ms-agent-dotnet/learning"');
    expect(markup).toContain('href="/ms-agent-dotnet/intelligence/memories"');
  });
  it("uses the selected frontend for the live showcase", () => {
    const markup = render({
      frontendOverride: "angular",
      showcase: {
        integration: "ms-agent-dotnet",
        intro: "Demo",
        demos: [{ slug: "agentic-chat", title: "Chat" }],
      },
    });
    expect(markup).toContain(
      "https://showcase.copilotkit.ai/angular/ms-agent-dotnet/agentic-chat",
    );
    expect(markup).not.toContain("railway.app");
  });
});
