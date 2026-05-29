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
});
