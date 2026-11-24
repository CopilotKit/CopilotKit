import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "../../shell-dojo/src/lib/runtime-config";

vi.mock("next/cache", () => ({ unstable_noStore: vi.fn() }));

const STAGING_BACKEND_HOST_PATTERN = "showcase-{slug}-staging.up.railway.app";

describe("Dojo preview integration configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the configured slugs in staging", () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    vi.stubEnv("SHOWCASE_BACKEND_HOST_PATTERN", STAGING_BACKEND_HOST_PATTERN);
    vi.stubEnv(
      "SHOWCASE_DOJO_PREVIEW_INTEGRATIONS",
      " omnara, , another-demo ",
    );

    expect(
      getRuntimeConfig({ noStore: false }).previewIntegrationSlugs,
    ).toEqual(["omnara", "another-demo"]);
  });

  it.each(["production", undefined])(
    "hides preview integrations when the environment is %s",
    (environment) => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", environment);
      vi.stubEnv("SHOWCASE_BACKEND_HOST_PATTERN", STAGING_BACKEND_HOST_PATTERN);
      vi.stubEnv("SHOWCASE_DOJO_PREVIEW_INTEGRATIONS", "omnara");

      expect(
        getRuntimeConfig({ noStore: false }).previewIntegrationSlugs,
      ).toEqual([]);
    },
  );

  it("hides preview integrations when staging has no configured slugs", () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    vi.stubEnv("SHOWCASE_BACKEND_HOST_PATTERN", STAGING_BACKEND_HOST_PATTERN);
    vi.stubEnv("SHOWCASE_DOJO_PREVIEW_INTEGRATIONS", undefined);

    expect(
      getRuntimeConfig({ noStore: false }).previewIntegrationSlugs,
    ).toEqual([]);
  });

  it("hides staging previews when the backend falls back to production", () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    vi.stubEnv("SHOWCASE_BACKEND_HOST_PATTERN", undefined);
    vi.stubEnv("NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN", undefined);
    vi.stubEnv("SHOWCASE_DOJO_PREVIEW_INTEGRATIONS", "omnara");

    expect(
      getRuntimeConfig({ noStore: false }).previewIntegrationSlugs,
    ).toEqual([]);
  });
});
