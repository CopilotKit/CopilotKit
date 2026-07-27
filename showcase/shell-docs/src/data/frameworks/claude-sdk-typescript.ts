import type { FrameworkOverviewData } from "./types";

const data: FrameworkOverviewData = {
  slug: "claude-sdk-typescript",
  frameworkName: "Claude Agent SDK (TypeScript)",
  iconKey: "anthropic",
  header: "Bring your Claude agents to your users",
  subheader:
    "Connect Claude Agent SDK TypeScript agents to CopilotKit with AG-UI so users can chat, call frontend tools, share state, and render agent output inside your app.",
  bannerVideo:
    "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/overview.mp4",
  guideLink: "/claude-sdk-typescript/quickstart",
  initCommand: "npx copilotkit@latest init --framework claude-sdk-typescript",
  featuresLink:
    "https://showcase.copilotkit.ai/integrations/claude-sdk-typescript",
  supportedFeatures: [
    {
      title: "Frontend tools",
      description:
        "Let Claude call tools that run in the user's browser, then stream the result back through the AG-UI run.",
      documentationLink: "/claude-sdk-typescript/quickstart",
      demoLink:
        "https://showcase.copilotkit.ai/integrations/claude-sdk-typescript/demos/frontend-tools",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/haiku.mp4",
    },
    {
      title: "Generative UI",
      description:
        "Render Claude tool calls and agent state as custom React components without forcing users to read raw JSON.",
      documentationLink: "/claude-sdk-typescript/quickstart",
      demoLink:
        "https://showcase.copilotkit.ai/integrations/claude-sdk-typescript/demos/tool-rendering",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/human-in-the-loop-example.mp4",
    },
    {
      title: "Shared state",
      description:
        "Give your Claude agent read and write access to application state so the UI and agent stay in sync.",
      documentationLink: "/claude-sdk-typescript/quickstart",
      demoLink:
        "https://showcase.copilotkit.ai/integrations/claude-sdk-typescript/demos/shared-state-read-write",
      videoUrl:
        "https://cdn.copilotkit.ai/docs/copilotkit/videos/coagents/shared-state.mp4",
    },
  ],
  architectureImage:
    "https://cdn.copilotkit.ai/docs/copilotkit/images/generic-agui-architecture.png",
  liveDemos: [
    {
      type: "showcase",
      title: "Claude Agent SDK TypeScript Showcase",
      description:
        "Browse the live Claude Agent SDK TypeScript demos for chat, tools, shared state, generative UI, and subagents.",
      iframeUrl:
        "https://showcase.copilotkit.ai/integrations/claude-sdk-typescript",
    },
  ],
};

export default data;
