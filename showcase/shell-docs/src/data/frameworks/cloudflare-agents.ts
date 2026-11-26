// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. Edit this file directly.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "cloudflare-agents",
  // The landing writes "Bring your <frameworkName> agents into any app".
  frameworkName: "Cloudflare Agents SDK",
  iconKey: "cloudflare",
  header: "Bring your Cloudflare Agents to your users",
  subheader:
    "The Agents SDK runs your agent on Workers, with a Durable Object for every conversation. CopilotKit gives it a surface your users can see, interrupt and steer.",
  guideLink: "/cloudflare-agents/quickstart",
  // No CLI starter exists for this framework yet. The type requires a
  // command, and the landing shows the generic one, as it did for other
  // frameworks before their starter shipped; the quickstart's manual path is
  // the way in.
  initCommand: "npx copilotkit@latest init",
  // Link to the integration source for its supported features.
  featuresLink:
    "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/integrations/cloudflare-agents",

  lede: "The Agents SDK gives you the agent: a class on Workers with a Durable Object for each conversation, where its state lives, and the AI SDK doing the model work. What it does not give you is the surface. Somewhere for the conversation to happen, a way to show the run while it is running, and a moment for a person to step in. Each capability below builds on something your agent already does.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your AI SDK tools run in the Worker, and their calls stream to the browser while the model writes them. CopilotKit renders each one as a React component instead of leaving the user with a spinner.",
      documentationLink: "/cloudflare-agents/generative-ui/tool-rendering",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "Put a tool under the AI SDK's tool approval (`toolApproval`, or `needsApproval` on AI SDK v6) and the run pauses before the tool runs. CopilotKit shows the user the call, and the Durable Object makes sure an approved call runs once.",
      documentationLink: "/cloudflare-agents/human-in-the-loop",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description:
        "The agent's state is the thread's state, kept in its Durable Object. Every `this.setState()` streams to the page, and the page's edits are saved back. Your UI and your agent work on the same data.",
      documentationLink: "/cloudflare-agents/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Frontend tools, app context, state streaming, reasoning, attachments, A2UI and sub-agents work with the Agents SDK too.",
    linkLabel: "And more",
    href: "/cloudflare-agents/build-with-agents",
  },

  connect: {
    intro:
      "Your agent keeps running in its own Worker, with withAGUI from @ag-ui/cloudflare-agents on the agent class. CopilotKit reaches it over HTTP, and the Worker sends each thread to its own Durable Object.",
    filename: "app/api/copilotkit/route.ts",
    language: "ts",
    code: `import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { NextRequest } from "next/server";

const runtime = new CopilotRuntime({
  agents: {
    assistant: new HttpAgent({
      url: process.env.AGENT_URL ?? "http://localhost:8000/agents/assistant",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export const POST = (req: NextRequest) => handler(req);`,
    guideLink: "/cloudflare-agents/quickstart",
  },

  liveDemos: [],
};

export default data;
