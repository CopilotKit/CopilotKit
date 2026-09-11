import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localBackendsEnv } from "../../../../shell/src/lib/local-backends-env";
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

  it("derives the local map from the shared validated port registry", () => {
    vi.stubEnv("SHOWCASE_LOCAL", "1");
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
    const localBackends = JSON.parse(localBackendsEnv(portsPath)) as Record<
      string,
      string
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
