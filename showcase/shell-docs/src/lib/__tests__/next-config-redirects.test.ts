import { afterEach, describe, expect, it, vi } from "vitest";

describe("next.config redirects", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not redirect authored framework-scoped Generative UI component pages", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3003");
    vi.stubEnv("NEXT_PUBLIC_SHELL_URL", "http://localhost:3000");

    const nextConfig = (await import("../../../next.config")).default;
    const redirects = await nextConfig.redirects?.();

    expect(redirects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/:framework/generative-ui/your-components/display-only",
        }),
        expect.objectContaining({
          source: "/:framework/generative-ui/your-components/interactive",
        }),
      ]),
    );
  });

  it("strips the retired built-in-agent prefix to root URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3003");
    vi.stubEnv("NEXT_PUBLIC_SHELL_URL", "http://localhost:3000");

    const nextConfig = (await import("../../../next.config")).default;
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/built-in-agent",
          destination: "/",
          permanent: true,
        },
        {
          source: "/built-in-agent/ag-ui",
          destination: "/backend/ag-ui",
          permanent: true,
        },
        {
          source: "/built-in-agent/tutorials/:path*",
          destination: "/quickstart",
          permanent: true,
        },
        {
          source: "/built-in-agent/:path*",
          destination: "/:path*",
          permanent: true,
        },
      ]),
    );
  });
});
