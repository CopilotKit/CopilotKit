import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInlineDemoBackendUrl } from "../inline-demo-url";

const REMOTE = "https://showcase-google-adk-production.up.railway.app";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("InlineDemo backend URLs", () => {
  it("preserves the generated registry URL unless local mode is explicitly enabled", () => {
    expect(resolveInlineDemoBackendUrl("google-adk", REMOTE, "")).toBe(REMOTE);
  });

  it("uses a valid local override for the selected integration only", () => {
    expect(
      resolveInlineDemoBackendUrl(
        "google-adk",
        REMOTE,
        JSON.stringify({ "google-adk": "http://localhost:3103" }),
      ),
    ).toBe("http://localhost:3103");
    expect(
      resolveInlineDemoBackendUrl(
        "langgraph-python",
        REMOTE,
        JSON.stringify({ "google-adk": "http://localhost:3103" }),
      ),
    ).toBe(REMOTE);
  });

  it("rejects malformed or non-origin overrides and retains the registry URL", () => {
    for (const candidate of [
      "not a URL",
      "ftp://localhost:3103",
      "http://user@localhost:3103",
      "http://localhost:3103/demos",
      "http://localhost:3103?demo=auth",
    ]) {
      expect(
        resolveInlineDemoBackendUrl(
          "google-adk",
          REMOTE,
          JSON.stringify({ "google-adk": candidate }),
        ),
      ).toBe(REMOTE);
    }
  });

  it("keeps the shell-docs Next config remote by default", async () => {
    vi.stubEnv("SHOWCASE_LOCAL", "");
    vi.resetModules();

    const nextConfig = (await import("../../../next.config")).default;
    expect(nextConfig.env?.NEXT_PUBLIC_LOCAL_BACKENDS).toBe("");
  });

  it("derives the validated shared port map through the shell-docs Next config", async () => {
    vi.stubEnv("SHOWCASE_LOCAL", "1");
    vi.resetModules();

    const nextConfig = (await import("../../../next.config")).default;
    const localBackends = JSON.parse(
      String(nextConfig.env?.NEXT_PUBLIC_LOCAL_BACKENDS),
    ) as Record<string, string>;

    const portsPath = path.resolve(
      process.cwd(),
      "..",
      "shared",
      "local-ports.json",
    );
    const ports = JSON.parse(readFileSync(portsPath, "utf8")) as Record<
      string,
      number
    >;
    expect(localBackends).toEqual(
      Object.fromEntries(
        Object.entries(ports).map(([slug, port]) => [
          slug,
          `http://localhost:${port}`,
        ]),
      ),
    );
  });
});
