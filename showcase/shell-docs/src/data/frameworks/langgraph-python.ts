// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
//
// This record serves three URLs — /langgraph-python, /langgraph-typescript and
// /langgraph-fastapi — so the copy stays language-neutral and the snippet below
// shows the shape all three share. Links carry the `/langgraph/` prefix and are
// rewritten to the URL-active variant by `FrameworkOverview`.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "langgraph-python",
  // Was "LangChain", which nothing else in the repository agrees with: the
  // registry names these integrations "LangGraph Python" and "LangGraph
  // (TypeScript)", the icon key is `langgraph`, the docs folder is
  // `integrations/langgraph/`, and every page inside it says LangGraph.
  frameworkName: "LangGraph",
  iconKey: "langgraph",
  header: "Build interactive apps with LangGraph",
  subheader:
    "CopilotKit connects your LangGraph agents to chat, custom UI, and human input.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  guideLink: "/langgraph/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/langgraph/feature/agentic_chat",

  lede: "Make your graph’s state, tools, and interrupts part of your product.",
  supportedFeatures: [
    {
      title: "Generative UI",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
      iconKey: "paintbrush",
      description: "Render graph state and tool calls in your app.",
      documentationLink: "/langgraph/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
      iconKey: "user",
      description: "Turn graph interrupts into decisions users can make.",
      documentationLink: "/langgraph/human-in-the-loop/interrupt-flow",
    },
    {
      title: "Shared state",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
      iconKey: "repeat",
      description: "Keep graph state and your interface in sync.",
      documentationLink: "/langgraph/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and subagent flows work with LangGraph too.",
    linkLabel: "And more",
    href: "/langgraph/build-with-agents",
  },

  connect: {
    intro: "Connect a deployed LangGraph agent to your CopilotKit runtime.",
    filename: "app/api/copilotkit/route.ts",
    language: "ts",
    code: `import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
      graphId: "sample_agent",
      langsmithApiKey: process.env.LANGSMITH_API_KEY!,
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export const POST = handler;`,
    guideLink: "/langgraph/quickstart",
  },

  connectBySlug: {
    "langgraph-fastapi": {
      intro: "Connect your LangGraph FastAPI endpoint to CopilotKit.",
      filename: "app/api/copilotkit/route.ts",
      language: "ts",
      code: `import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new LangGraphHttpAgent({
      url: process.env.LANGGRAPH_DEPLOYMENT_URL ?? "http://localhost:8123",
    }),
  },
});

export const POST = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});`,
      guideLink: "/langgraph/quickstart",
    },
  },

  showcase: {
    integration: "langgraph-python",
    // Each variant has its own running cell, so /langgraph-typescript embeds
    // the TypeScript one rather than the Python one it shares this record with.
    integrationBySlug: {
      "langgraph-python": "langgraph-python",
      "langgraph-typescript": "langgraph-typescript",
      "langgraph-fastapi": "langgraph-fastapi",
    },
    intro:
      "LangGraph and CopilotKit running together, in the React frontend. Every demo below is the same integration with one capability turned on.",
    // Titles are the showcase's own labels for these cells, so a reader who
    // clicks through finds the same name on the page they land on.
    demos: [
      { slug: "agentic-chat", title: "Pre-Built: CopilotChat" },
      { slug: "hitl-in-chat", title: "Human In the Loop: In-chat" },
      { slug: "shared-state-read-write", title: "Shared State: Read + Write" },
      { slug: "gen-ui-agent", title: "Generative UI: Agent State" },
    ],
  },

  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/coagents-highlevel-overview.png",
  liveDemos: [],
  tutorialLink: "/langgraph/tutorials/ai-travel-app",
};

export default data;
