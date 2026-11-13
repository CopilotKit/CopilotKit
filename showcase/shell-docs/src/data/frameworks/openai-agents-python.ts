// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. Edit this file directly.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "openai-agents-python",
  frameworkName: "OpenAI Agents SDK",
  iconKey: "openai",
  header: "Bring your OpenAI Agents SDK agents to your users",
  subheader:
    "The Agents SDK runs your agent's loop: the model, its tools and its handoffs. CopilotKit gives that loop a surface your users can see, interrupt and steer.",
  guideLink: "/openai-agents-python/quickstart",
  // No CLI starter exists for this framework yet; the quickstart's
  // "use an existing agent" path is the way in.
  initCommand: "npx copilotkit@latest init",
  // Link to the integration source for its supported features.
  featuresLink:
    "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/integrations/openai-agents-python",

  lede: "The Agents SDK gives you the agent: a model, its tools, guardrails and handoffs, run in a loop. What it does not give you is the surface. Somewhere for the conversation to happen, a way to show the run while it is running, and a moment for a person to step in. Each capability below builds on something your agent already does.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your function tools run on the server, and their calls stream to the browser while the model writes them. CopilotKit renders each one as a React component instead of leaving the user with a spinner.",
      documentationLink: "/openai-agents-python/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "Mark a tool `needs_approval=True` and the SDK pauses before it runs. CopilotKit shows the user the call, and their answer resumes the run with nothing kept on the server in between.",
      documentationLink: "/openai-agents-python/human-in-the-loop",
    },
    {
      title: "Shared state",
      iconKey: "repeat",
      description:
        "The page's state reaches every run, and a tool that changes it streams the new value back before its own result. Your UI and your agent work on the same data.",
      documentationLink: "/openai-agents-python/shared-state",
    },
  ],
  capabilitiesFootnote: {
    text: "Frontend tools, app context, state streaming, reasoning, attachments, A2UI and sub-agents work with the OpenAI Agents SDK too.",
    linkLabel: "And more",
    href: "/openai-agents-python/build-with-agents",
  },

  connect: {
    intro:
      "Your agent keeps running as its own Python service, with the ag-ui-openai-agents adapter in front of it. CopilotKit reaches that service over HTTP, so nothing inside the agent changes.",
    filename: "app/api/copilotkit/route.ts",
    language: "ts",
    code: `import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotKitRuntimeHandler,
} from "@copilotkit/runtime";
import type { NextRequest } from "next/server";

const runtime = new CopilotRuntime({
  agents: {
    openai_agent: new HttpAgent({
      url: process.env.AGENT_URL ?? "http://localhost:8000/agent",
    }),
  },
});

const handler = createCopilotKitRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export const POST = (req: NextRequest) => handler(req);`,
    guideLink: "/openai-agents-python/quickstart",
  },

  liveDemos: [],
};

export default data;
