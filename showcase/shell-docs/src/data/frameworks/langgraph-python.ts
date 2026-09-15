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
  header: "Bring your LangGraph agents to your users",
  subheader:
    "LangGraph runs your graph. CopilotKit gives it a surface your users can see, interrupt and steer.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  guideLink: "/langgraph/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/langgraph/feature/agentic_chat",

  lede: "LangGraph gives you the graph: nodes, edges, one state object, and interrupts that stop a run mid-node. What it does not give you is the surface. Somewhere for the conversation to happen, a way to show the run while it is running, and a moment for a person to step in. Each capability below builds on something your graph already does.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your nodes return state updates and tool calls as they run. CopilotKit streams both to the browser by default and renders them as React components your users watch update while the graph works.",
      documentationLink: "/langgraph/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "A node calls interrupt() and stops mid-execution. CopilotKit catches that event, renders your own UI for the decision, and resumes the graph with the answer.",
      documentationLink: "/langgraph/human-in-the-loop/interrupt-flow",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description:
        "Your graph carries one state object from node to node. CopilotKit mirrors it into your app and back, so a user edit and a node write land in the same place.",
      documentationLink: "/langgraph/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and subagent flows work with LangGraph too.",
    linkLabel: "And more",
    href: "/langgraph/build-with-agents",
  },

  connect: {
    intro:
      "Your graph stays where it runs today: LangGraph Platform, LangSmith, or your own FastAPI service. CopilotKit reaches it over AG-UI, so nothing inside the graph changes.",
    filename: "app/api/copilotkit/route.ts",
    language: "ts",
    code: `import { CopilotRuntime } from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new LangGraphAgent({
      deploymentUrl: process.env.LANGGRAPH_DEPLOYMENT_URL!,
      graphId: "sample_agent",
      langsmithApiKey: process.env.LANGSMITH_API_KEY!,
    }),
  },
});`,
    guideLink: "/langgraph/quickstart",
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

  // Legacy fields below. `architectureImage`, `liveDemos`, `tutorialLink` and
  // `cta` are only read by the pre-capability layout, which this record no
  // longer uses; they stay until every partner page has moved over and the old
  // branch comes out of the template in one piece.
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/coagents-highlevel-overview.png",
  liveDemos: [],
  tutorialLink: "/langgraph/tutorials/ai-travel-app",
};

export default data;
