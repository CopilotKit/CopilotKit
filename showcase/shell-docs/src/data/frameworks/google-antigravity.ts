// Hand-maintained landing-page content for this framework's `/<slug>` route,
// read through `frameworkOverviews`. Edit this file directly.
import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "google-antigravity",
  frameworkName: "Google Antigravity",
  // Placeholder: no Antigravity mark exists in the icon registry yet, so this
  // reuses the ADK icon — the same placeholder treatment PARITY_NOTES.md
  // records for `shell/public/logos/google-antigravity.svg` (a copy of
  // `google-adk.svg` until a real, permissively-licensed mark is available).
  iconKey: "adk",
  header: "Bring your Google Antigravity agents to your users",
  subheader:
    "Antigravity runs your agent in its own harness. CopilotKit gives it a surface your users can see, interrupt and steer.",
  guideLink: "/google-antigravity/quickstart",
  initCommand: "npx copilotkit@latest init --framework antigravity",
  // The showcase package is not deployed yet (`deployed: false` in its
  // manifest), so this points at the source until the showcase URL exists;
  // switch it (and add a `showcase` section) at deploy time.
  featuresLink:
    "https://github.com/CopilotKit/CopilotKit/tree/main/showcase/integrations/google-antigravity",

  lede: "Antigravity gives you the agent: a harness that runs the model, its tools and its sessions. What it does not give you is the surface. Somewhere for the conversation to happen, a way to show the run while it is running, and a moment for a person to step in. Each capability below builds on something your agent already does.",
  supportedFeatures: [
    {
      title: "Generative UI",
      iconKey: "paintbrush",
      description:
        "Your Python tools run inside the adapter, and their calls and results stream to the browser as they happen. CopilotKit renders each one as a React component instead of leaving the user with a spinner.",
      documentationLink: "/google-antigravity/generative-ui",
    },
    {
      title: "Human-in-the-loop",
      iconKey: "user",
      description:
        "Antigravity awaits a tool with no timeout, so a frontend tool that asks the user just parks the run. CopilotKit resolves it from the browser once the user decides, and the same turn continues with the answer.",
      documentationLink: "/google-antigravity/human-in-the-loop",
    },
    {
      title: "Frontend tools",
      iconKey: "wrench",
      description:
        "Every tool your app registers becomes a real Antigravity tool. The model calls it like any other, and the value your handler returns is the result it sees.",
      documentationLink: "/google-antigravity/frontend-tools",
    },
  ],
  capabilitiesFootnote: {
    text: "Shared state and app context (experimental), attachments, reasoning, A2UI and multi-agent flows work with Google Antigravity too.",
    linkLabel: "And more",
    href: "/google-antigravity/build-with-agents",
  },

  connect: {
    intro:
      "Your agent keeps running as its own Python service, with the ag-ui-antigravity adapter in front of it. CopilotKit reaches that service over HTTP, so nothing inside the agent changes.",
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
    antigravity_agent: new HttpAgent({
      url: process.env.AGENT_URL ?? "http://localhost:8000",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
  mode: "single-route",
});

export const POST = (req: NextRequest) => handler(req);`,
    guideLink: "/google-antigravity/quickstart",
    initCommand: "npx copilotkit@latest init --framework antigravity",
  },

  liveDemos: [],
};

export default data;
