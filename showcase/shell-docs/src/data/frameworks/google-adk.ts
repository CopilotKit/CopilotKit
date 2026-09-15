// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
//
// Links carry the `/adk/` prefix because that is the docs folder this
// framework's pages live in; `FrameworkOverview` rewrites them onto the URL
// slug (`google-adk`).
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "google-adk",
  frameworkName: "ADK",
  iconKey: "adk",
  header: "Bring your ADK agents to your users",
  subheader:
    "ADK runs your agents. CopilotKit gives them a surface your users can see, interrupt and steer.",
  // Was "/adk/quickstart/adk", which the link rewriter turns into
  // /google-adk/quickstart/adk — a 404. The quickstart lives one level up.
  guideLink: "/adk/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink: "https://feature-viewer.copilotkit.ai/adk/feature/agentic_chat",

  lede: "ADK gives you the agent: tools, sessions and a runner that serves them. What it does not give you is the surface. Somewhere for the conversation to happen, a way to show the run while it is running, and a moment for a person to step in. Each capability below builds on something your agent already does.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your agent calls tools and updates session state as it runs. CopilotKit streams both to the browser and renders them as React components your users watch update while the agent works.",
      documentationLink: "/adk/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "AGUIToolset() puts frontend tools in reach of your agent. CopilotKit renders the one that asks for a decision, waits for the user's answer, and hands it back as the tool result.",
      documentationLink: "/adk/human-in-the-loop",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description:
        "ADK sessions keep state between turns on the server. CopilotKit mirrors it into your app and back, so a user edit and an agent write land in the same place.",
      documentationLink: "/adk/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and multi-agent flows work with ADK too.",
    linkLabel: "And more",
    href: "/adk/build-with-agents",
  },

  connect: {
    intro:
      "Your agent keeps running as its own Python service, with the AG-UI bridge from ag_ui_adk in front of it. CopilotKit reaches that service over HTTP, so nothing inside the agent changes.",
    filename: "app/api/copilotkit/route.ts",
    language: "ts",
    code: `import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    my_agent: new HttpAgent({ url: process.env.AGENT_URL! }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;`,
    guideLink: "/adk/quickstart",
  },

  showcase: {
    integration: "google-adk",
    intro:
      "ADK and CopilotKit running together, in the React frontend. Every demo below is the same integration with one capability turned on.",
    demos: [
      { slug: "agentic-chat", title: "Pre-Built: CopilotChat" },
      { slug: "hitl-in-chat", title: "Human In the Loop: In-chat" },
      { slug: "shared-state-read-write", title: "Shared State: Read + Write" },
      { slug: "gen-ui-agent", title: "Generative UI: Agent State" },
    ],
  },

  liveDemos: [],
};

export default data;
