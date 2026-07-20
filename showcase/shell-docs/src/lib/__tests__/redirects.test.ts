import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("legacy Bots SDK redirects", () => {
  it("permanently redirects Bots SDK routes to Channels SDK routes", async () => {
    expect(nextConfig.redirects).toBeTypeOf("function");

    const redirects = await nextConfig.redirects!();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/bots",
          destination: "/channels",
          permanent: true,
        },
        {
          source: "/bots/:path*",
          destination: "/channels/:path*",
          permanent: true,
        },
        {
          source: "/reference/bot",
          destination: "/reference/channels",
          permanent: true,
        },
        {
          source: "/reference/bot/:path*",
          destination: "/reference/channels/:path*",
          permanent: true,
        },
      ]),
    );
  });
});
