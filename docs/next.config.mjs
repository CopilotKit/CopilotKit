import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  env: {
    RB2B_ID: process.env.RB2B_ID,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    SCARF_PIXEL_ID: process.env.SCARF_PIXEL_ID,
    CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY || "pk_live_Y2xlcmsuY29waWxvdGtpdC5haSQ",
  },

  async redirects() {
    return [
      {
        source: '/coagents/tutorials/ai-travel-app/overview',
        destination: '/coagents/tutorials/ai-travel-app',
        permanent: true,
      },
      {
        source: '/coagents/chat-ui/hitl/json-hitl',
        destination: '/coagents/chat-ui/hitl',
        permanent: true,
      },
      {
        source: '/coagents/react-ui/frontend-functions',
        destination: '/coagents/react-ui/hitl',
        permanent: true,
      }
    ];
  },
};

export default withMDX(config);
