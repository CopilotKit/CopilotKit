// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
//
// Open Agent Spec has no showcase integration of its own, so this record
// carries no `showcase` block and the page ends after "Connect your agent".
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "agent-spec",
  frameworkName: "Open Agent Spec",
  iconKey: "agentspecMark",
  header: "Build interactive apps with Open Agent Spec",
  subheader:
    "CopilotKit connects your Open Agent Spec agents to chat, custom UI, and human input.",
  bannerVideo:
    "https://cdn.copilotkit.ai/blog/oracle/demo-oracle-spec-dojo.mp4",
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/agent-spec/agent-spec-ag-ui-arch.png",
  guideLink: "/agent-spec/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/agent-spec/feature/agentic_chat",

  lede: "Bring your Open Agent Spec agent into your product.",
  supportedFeatures: [
    {
      title: "Generative UI",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
      iconKey: "paintbrush",
      description: "Render agent state and tool calls in your app.",
      documentationLink: "/agent-spec/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
      iconKey: "user",
      description: "Let users review and approve the next step.",
      documentationLink: "/agent-spec/human-in-the-loop",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description: "Keep your agent and interface in sync.",
      documentationLink: "/agent-spec/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and multi-agent flows work with Open Agent Spec too.",
    linkLabel: "And more",
    href: "/agent-spec/build-with-agents",
  },

  connect: {
    intro:
      "Your agent keeps running where it runs today, behind an AG-UI endpoint. CopilotKit reaches it over HTTP, so nothing inside the agent changes.",
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
    guideLink: "/agent-spec/quickstart",
  },

  liveDemos: [],
};

export default data;
