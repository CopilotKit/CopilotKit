import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));

describe("next.config redirects", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rewrites the public well-known capability URL to its route", async () => {
    const nextConfig = (await import("../../../next.config")).default;
    const rewrites = await nextConfig.rewrites?.();

    expect(rewrites).toMatchObject({
      beforeFiles: expect.arrayContaining([
        {
          source: "/.well-known/copilotkit-capabilities/v1.json",
          destination: "/well-known/copilotkit-capabilities/v1.json",
        },
      ]),
    });
  });

  it("sets an absolute Turbopack root that contains the shared AEO contract", async () => {
    const nextConfig = (await import("../../../next.config")).default;
    const turbopackRoot = nextConfig.turbopack?.root;

    expect(turbopackRoot).toBe(resolve(TEST_DIRECTORY, "../../../.."));
    expect(isAbsolute(turbopackRoot ?? "")).toBe(true);
    expect(
      existsSync(
        resolve(
          turbopackRoot ?? "",
          "shared/aeo/public-surface-contract.v1.json",
        ),
      ),
    ).toBe(true);
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
