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
  header: "Bring your Open Agent Spec agents to your users",
  subheader:
    "Open Agent Spec describes your agent. CopilotKit gives it a surface your users can see, interrupt and steer.",
  guideLink: "/agent-spec/quickstart",
  initCommand: "npx copilotkit@latest init",
  featuresLink:
    "https://feature-viewer.copilotkit.ai/agent-spec/feature/agentic_chat",

  lede: "Open Agent Spec describes an agent in a form other tools can run. What it does not describe is the surface your users work in. Each capability below builds on what a running spec already emits.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your agent's tool calls arrive as they happen. CopilotKit renders each one as a React component in your own app, instead of leaving the user with a spinner.",
      documentationLink: "/agent-spec/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "A frontend tool registered with useHumanInTheLoop renders your own UI, waits for the user's answer, and hands it back to the agent as the tool result.",
      documentationLink: "/agent-spec/human-in-the-loop",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description:
        "Your agent carries state between turns. CopilotKit mirrors it into your app and back, so a user edit and an agent write land in the same place.",
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
});

export const GET = handler;
export const POST = handler;`,
    guideLink: "/agent-spec/quickstart",
  },

  liveDemos: [],
};

export default data;
