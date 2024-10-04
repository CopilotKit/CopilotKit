import nextra from 'nextra'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  defaultShowCopyCode: true,
})

export default withNextra({
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
        source: "/",
        destination: "/what-is-copilotkit",
        permanent: false,
      }
    ]
  },
  // This is needed for catch-all redirect of non existent rountes to the home page.
  // https://github.com/vercel/next.js/discussions/16749#discussioncomment-2992732
  async rewrites() {
    return {
      afterFiles: [{ source: "/:path*", destination: "/_404/:path*" }],
    };
  },
});
