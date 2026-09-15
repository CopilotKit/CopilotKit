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
  header: "Build interactive apps with Google ADK",
  subheader:
    "CopilotKit connects your ADK agents to chat, custom UI, and human input.",
  // Was "/adk/quickstart/adk", which the link rewriter turns into
  // /google-adk/quickstart/adk — a 404. The quickstart lives one level up.
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/generic-agui-architecture.png",
  guideLink: "/adk/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink: "https://feature-viewer.copilotkit.ai/adk/feature/agentic_chat",

  lede: "Bring ADK tools and session state into your product.",
  supportedFeatures: [
    {
      title: "Generative UI",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
      iconKey: "paintbrush",
      description: "Render tool calls and session state in your app.",
      documentationLink: "/adk/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
      iconKey: "user",
      description: "Let users review and respond to frontend tools.",
      documentationLink: "/adk/human-in-the-loop",
    },
    {
      title: "Shared state",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
      iconKey: "repeat",
      description: "Keep ADK session state and your app in sync.",
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
      "Expose your Python agent with ag_ui_adk, then connect its AG-UI endpoint.",
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
  mode: "single-route",
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
