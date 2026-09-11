// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. An earlier header credited
// `scripts/extract-framework-overviews.ts`; no such script exists in this
// repository and none ever has, so edit this file directly.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "claude-sdk-typescript",
  frameworkName: "Claude Agent SDK (TypeScript)",
  iconKey: "anthropic",
  header: "Bring your Claude agents to your users",
  subheader:
    "The Claude Agent SDK runs your agent loop. CopilotKit gives it a surface your users can see, interrupt and steer.",
  guideLink: "/claude-sdk-typescript/quickstart",
  initCommand: "npx copilotkit@latest init --framework claude-sdk-typescript",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/claude-sdk-typescript/feature/agentic_chat",

  lede: "The Claude Agent SDK gives you the agent loop: tools, context handling, and a session that keeps its history. What it does not give you is the surface. Somewhere for the conversation to happen, a way to show the run while it is running, and a moment for a person to step in. Each capability below builds on something your agent already does.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your agent calls tools and reports progress as it works. CopilotKit streams those calls to the browser and renders each one as a React component, instead of leaving the user with a spinner.",
      documentationLink: "/claude-sdk-typescript/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "The agent calls an approval tool and waits for its result. CopilotKit resolves that tool from the browser once the user decides, and the same Claude run continues with the answer.",
      documentationLink: "/claude-sdk-typescript/human-in-the-loop",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description:
        "Your session carries state across turns on the server. CopilotKit mirrors it into your app and back, so a user edit and an agent write land in the same place.",
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
