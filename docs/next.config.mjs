import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    RB2B_ID: process.env.RB2B_ID,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    SCARF_PIXEL_ID: process.env.SCARF_PIXEL_ID,
  },

  images: {
    domains: [
      "github-production-user-asset-6210df.s3.amazonaws.com",
      "fonts.gstatic.com",
      "docs.copilotkit.ai",
    ],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },

  skipTrailingSlashRedirect: true,
  skipMiddlewareUrlNormalize: true,

  optimizeFonts: false,

  experimental: {
    turbo: true,
  },

  async redirects() {
    return [
      {
        source: "/coagents",
        destination: "/coagents-hub",
        permanent: true,
      },
      {
        source: "/coagents/tutorials/ai-travel-app/overview",
        destination: "/langgraph/tutorials/ai-travel-app",
        permanent: true,
      },
      {
        source: "/coagents/chat-ui/hitl/json-hitl",
        destination: "/langgraph/chat-ui/hitl",
        permanent: true,
      },
      {
        source: "/coagents/react-ui/frontend-functions",
        destination: "/langgraph/react-ui/hitl",
        permanent: true,
      },
      {
        source: "/coagents/chat-ui/render-agent-state",
        destination: "/langgraph/generative-ui/agentic",
        permanent: true,
      },
      {
        source: "/coagents/chat-ui/hitl",
        destination: "/langgraph/human-in-the-loop/node-flow",
        permanent: true,
      },
      {
        source: "/coagents/chat-ui/hitl/interrupt-flow",
        destination: "/langgraph/human-in-the-loop/interrupt-flow",
        permanent: true,
      },
      {
        source: "/coagents/chat-ui/loading-message-history",
        destination: "/langgraph/persistence/loading-message-history",
        permanent: true,
      },
      {
        source: "/coagents/react-ui/in-app-agent-read",
        destination: "/langgraph/shared-state/in-app-agent-read",
        permanent: true,
      },
      {
        source: "/coagents/react-ui/in-app-agent-write",
        destination: "/langgraph/shared-state/in-app-agent-write",
        permanent: true,
      },
      {
        source: "/coagents/react-ui/hitl",
        destination: "/langgraph/human-in-the-loop/node-flow",
        permanent: true,
      },
      {
        source: "/coagents/advanced/router-mode-agent-lock",
        destination: "/langgraph/multi-agent-flows",
        permanent: true,
      },
      {
        source: "/coagents/advanced/intermediate-state-streaming",
        destination: "/langgraph/shared-state/predictive-state-updates",
        permanent: true,
      },
      {
        source: "/coagents/advanced/manually-emitting-messages",
        destination: "/langgraph/advanced/emit-messages",
        permanent: true,
      },
      {
        source: "/coagents/advanced/state-streaming",
        destination: "/langgraph/shared-state",
        permanent: true,
      },
      {
        source: "/coagents/advanced/copilotkit-state",
        destination: "/langgraph/frontend-actions",
        permanent: true,
      },
      {
        source: "/coagents/advanced/message-persistence",
        destination: "/langgraph/persistence/message-persistence",
        permanent: true,
      },
      {
        source: "/coagents/advanced/loading-message-history",
        destination: "/langgraph/persistence/loading-message-history",
        permanent: true,
      },
      {
        source: "/coagents/advanced/loading-agent-state",
        destination: "/langgraph/persistence/loading-agent-state",
        permanent: true,
      },
      {
        source: "/coagents/concepts/state",
        destination: "/langgraph/shared-state",
        permanent: true,
      },
      {
        source: "/coagents/concepts/human-in-the-loop",
        destination: "/langgraph/human-in-the-loop",
        permanent: true,
      },
      {
        source: "/coagents/concepts/multi-agent-flows",
        destination: "/langgraph/multi-agent-flows",
        permanent: true,
      },
      {
        source: "/coagents/quickstart/langgraph",
        destination: "/langgraph/quickstart",
        permanent: true,
      },
      {
        source: "/crewai-crews/quickstart/crewai",
        destination: "/crewai-crews/quickstart",
        permanent: true,
      },
      {
        source: "/crewai-flows/quickstart/crewai",
        destination: "/crewai-flows/quickstart",
        permanent: true,
      },
      {
        source: "/mastra/quickstart/mastra",
        destination: "/mastra/quickstart",
        permanent: true,
      },
      {
        source: "/ag2/quickstart/ag2",
        destination: "/ag2/quickstart",
        permanent: true,
      },
      {
        source: "/coagents/:path*",
        destination: "/langgraph/:path*",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
