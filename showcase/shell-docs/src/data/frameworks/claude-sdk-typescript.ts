// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "claude-sdk-typescript",
  frameworkName: "Claude Agent SDK (TypeScript)",
  iconKey: "anthropic",
  header: "Build interactive apps with Claude Agent SDK (TypeScript)",
  subheader:
    "CopilotKit connects your Claude Agent SDK (TypeScript) agents to chat, custom UI, and human input.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/generic-agui-architecture.png",
  guideLink: "/claude-sdk-typescript/quickstart",
  initCommand: "npx copilotkit@latest init --framework claude-sdk-typescript",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/claude-sdk-typescript/feature/agentic_chat",

  lede: "Bring your Claude Agent SDK (TypeScript) agent into your product.",
  supportedFeatures: [
    {
      title: "Generative UI",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
      iconKey: "paintbrush",
      description: "Render agent state and tool calls in your app.",
      documentationLink: "/claude-sdk-typescript/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
      iconKey: "user",
      description: "Let users review and approve the next step.",
      documentationLink: "/claude-sdk-typescript/human-in-the-loop",
    },
    {
      title: "Shared state",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
      iconKey: "repeat",
      description: "Keep your agent and interface in sync.",
      documentationLink: "/claude-sdk-typescript/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and multi-agent flows work with the Claude Agent SDK too.",
    linkLabel: "And more",
    href: "/claude-sdk-typescript/build-with-agents",
  },

  connect: {
    intro:
      "Your agent keeps running as its own service, with the AG-UI adapter from @ag-ui/claude-agent-sdk in front of it. CopilotKit reaches that service over HTTP, so nothing inside the agent changes.",
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
    guideLink: "/claude-sdk-typescript/quickstart",
    // Not the generic CLI command: this record's init selects the framework
    // template explicitly, and nothing else on the page carries it.
    initCommand: "npx copilotkit@latest init --framework claude-sdk-typescript",
  },

  showcase: {
    integration: "claude-sdk-typescript",
    intro:
      "The Claude Agent SDK and CopilotKit running together, in the React frontend. Every demo below is the same integration with one capability turned on.",
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
