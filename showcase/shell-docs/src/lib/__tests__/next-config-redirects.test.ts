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

  it("hands the retired /ag-ui mirror to docs.ag-ui.com", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3003");
    vi.stubEnv("NEXT_PUBLIC_SHELL_URL", "http://localhost:3000");

    const nextConfig = (await import("../../../next.config")).default;
    const redirects = (await nextConfig.redirects?.()) ?? [];

    expect(redirects).toEqual(
      expect.arrayContaining([
        // Bulk of the mirror keeps its slug upstream.
        {
          source: "/ag-ui/:path*",
          destination: "https://docs.ag-ui.com/:path*",
          statusCode: 301,
        },
        // Upstream serves `.md` but not `.mdx`, so both collapse onto `.md`.
        {
          source: "/ag-ui/:path*.md",
          destination: "https://docs.ag-ui.com/:path*.md",
          statusCode: 301,
        },
        {
          source: "/ag-ui/:path*.mdx",
          destination: "https://docs.ag-ui.com/:path*.md",
          statusCode: 301,
        },
        // Mirror root rendered the upstream introduction page.
        {
          source: "/ag-ui",
          destination: "https://docs.ag-ui.com/introduction",
          statusCode: 301,
        },
        // Paths with no upstream equivalent land on the nearest live page.
        {
          source: "/ag-ui/drafts/interrupts",
          destination: "https://docs.ag-ui.com/concepts/interrupts",
          statusCode: 301,
        },
        {
          source: "/ag-ui/drafts/multimodal-messages",
          destination: "https://docs.ag-ui.com/concepts/messages",
          statusCode: 301,
        },
        {
          source: "/ag-ui/sdk/dart/client/overview",
          destination: "https://docs.ag-ui.com/sdk/dart/overview",
          statusCode: 301,
        },
        {
          source: "/ag-ui/sdk/rust/core/types",
          destination: "https://docs.ag-ui.com/sdk/rust/overview",
          statusCode: 301,
        },
      ]),
    );
  });

  it("orders every /ag-ui exception ahead of the catch-all", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3003");
    vi.stubEnv("NEXT_PUBLIC_SHELL_URL", "http://localhost:3000");

    const nextConfig = (await import("../../../next.config")).default;
    const redirects = (await nextConfig.redirects?.()) ?? [];

    const catchAll = redirects.findIndex(
      (redirect) => redirect.source === "/ag-ui/:path*",
    );
    expect(catchAll).toBeGreaterThan(-1);

    const exceptions = redirects.filter(
      (redirect) =>
        typeof redirect.destination === "string" &&
        redirect.destination.startsWith("https://docs.ag-ui.com") &&
        !redirect.source.includes(":path*"),
    );
    // 9 retired paths with no upstream equivalent + the mirror root, each
    // emitted bare, `.md` and `.mdx`.
    expect(exceptions).toHaveLength(30);
    for (const exception of exceptions) {
      expect(redirects.indexOf(exception)).toBeLessThan(catchAll);
      expect(exception).toMatchObject({ statusCode: 301 });
      expect(exception).not.toHaveProperty("permanent");
    }
  });
});
