export default {
  async rewrites() {
    if (!process.env.RICH_THREADS_RUNTIME_URL)
      throw new Error("RICH_THREADS_RUNTIME_URL is required");
    return [
      {
        source: "/api/rich-threads/:path*",
        destination: `${process.env.RICH_THREADS_RUNTIME_URL}/api/rich-threads/:path*`,
      },
    ];
  },
};
