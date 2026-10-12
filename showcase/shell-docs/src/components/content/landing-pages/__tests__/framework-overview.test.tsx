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
  it.each([
    ["strands", "aws-strands-py"],
    ["strands-typescript", "aws-strands-ts"],
  ])(
    "uses the verified CLI framework id for the %s overview",
    (currentFramework, cliFramework) => {
      expect(cliFrameworkForDocsSlug(currentFramework)).toBe(cliFramework);
    },
  );

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
});
