// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
//
// This record serves /strands and /strands-typescript, so the copy stays
// language-neutral. Links carry the `/aws-strands/` docs-folder prefix and are
// rewritten onto the URL slug by `FrameworkOverview`; the showcase embed picks
// the matching cell per slug (see `showcase.integrationBySlug`).
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "strands",
  frameworkName: "AWS Strands",
  iconKey: "awsStrands",
  header: "Build interactive apps with Strands",
  subheader:
    "CopilotKit connects your Strands agents to chat, custom UI, and human input.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/generic-agui-architecture.png",
  guideLink: "/aws-strands/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/aws-strands/feature/agentic_chat",

  lede: "Give your agent’s tools and state a place in your app.",
  supportedFeatures: [
    {
      title: "Generative UI",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
      iconKey: "paintbrush",
      description: "Show tool calls and progress as interactive UI.",
      documentationLink: "/aws-strands/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
      iconKey: "user",
      description: "Let users approve actions through frontend tools.",
      documentationLink: "/aws-strands/human-in-the-loop",
    },
    {
      title: "Shared state",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
      iconKey: "repeat",
      description: "Share state between your agent and your app.",
      documentationLink: "/aws-strands/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Chat surfaces, headless UI, frontend tools and multi-agent flows work with Strands too.",
    linkLabel: "And more",
    href: "/aws-strands/build-with-agents",
  },

  connect: {
    intro: "Connect your Strands AG-UI endpoint to the CopilotKit runtime.",
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
    guideLink: "/aws-strands/quickstart",
  },

  showcase: {
    integration: "strands",
    integrationBySlug: {
      strands: "strands",
      "strands-typescript": "strands-typescript",
    },
    intro:
      "Strands and CopilotKit running together, in the React frontend. Every demo below is the same integration with one capability turned on.",
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
