import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { versionDriftDriver } from "./version-drift.js";
import { logger } from "../../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../../test/fixtures/version-drift",
);

async function readFixture(name: string): Promise<string> {
  return fs.readFile(path.join(FIXTURE_ROOT, name), "utf8");
}

const BASE_CTX = {
  now: () => new Date("2026-04-20T00:00:00Z"),
  logger,
  env: {},
};

/**
 * Build a stubbed `fetch` that returns a fixed fixture-backed Response.
 * Wrapping Response from the fixture JSON exercises the same `.json()`
 * / `.ok` / `.status` path as production.
 */
function fakeFetch(status: number, body?: string): typeof fetch {
  return (async () =>
    new Response(body ?? "", {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

describe("versionDriftDriver", () => {
  it("exposes kind === 'version_drift'", () => {
    expect(versionDriftDriver.kind).toBe("version_drift");
  });

  describe("inputSchema", () => {
    it("accepts a fully-formed input", () => {
      const parsed = versionDriftDriver.inputSchema.safeParse({
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "18.2.0",
        ecosystem: "npm",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects missing key / name / pinnedVersion", () => {
      expect(
        versionDriftDriver.inputSchema.safeParse({
          name: "x",
          pinnedVersion: "1",
          ecosystem: "npm",
        }).success,
      ).toBe(false);
      expect(
        versionDriftDriver.inputSchema.safeParse({
          key: "x",
          pinnedVersion: "1",
          ecosystem: "npm",
        }).success,
      ).toBe(false);
      expect(
        versionDriftDriver.inputSchema.safeParse({
          key: "x",
          name: "x",
          ecosystem: "npm",
        }).success,
      ).toBe(false);
    });

    it("rejects unknown ecosystem", () => {
      const parsed = versionDriftDriver.inputSchema.safeParse({
        key: "x",
        name: "x",
        pinnedVersion: "1",
        ecosystem: "cargo",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("npm", () => {
    it("stable: pinned matches dist-tags.latest → green, drift=false", async () => {
      const body = await readFixture("npm-response-stable.json");
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(200, body),
      });
      expect(result.state).toBe("green");
      expect(result.signal).toMatchObject({
        name: "react",
        pinned: "19.0.0",
        latest: "19.0.0",
        drift: false,
      });
    });

    it("drift: pinned older than latest → red, drift=true", async () => {
      const body = await readFixture("npm-response-drift.json");
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "18.2.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(200, body),
      });
      expect(result.state).toBe("red");
      expect(result.signal).toMatchObject({
        name: "react",
        pinned: "18.2.0",
        latest: "19.0.0",
        drift: true,
      });
    });

    it("404 → red with errorDesc 'package not found'", async () => {
      const body = await readFixture("npm-response-404.json");
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:no-such-pkg",
        name: "no-such-pkg-zzz",
        pinnedVersion: "1.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(404, body),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("package not found");
      expect(result.signal.drift).toBe(false);
      expect(result.signal.latest).toBeNull();
    });

    it("429 → red with errorDesc 'rate-limited'", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(429, "rate limit exceeded"),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("rate-limited");
    });

    it("500 → red with errorDesc carrying status code", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(500, "internal server error"),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("registry returned 500");
    });

    it("malformed JSON response → red with parse errorDesc", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(200, "not valid json {{{"),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toMatch(/response parse failed/);
    });

    it("response missing dist-tags.latest → red with 'missing latest' errorDesc", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(200, JSON.stringify({ name: "react" })),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toMatch(/missing latest/);
    });

    it("response where dist-tags is not an object → red", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(200, JSON.stringify({ "dist-tags": "nope" })),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toMatch(/missing latest/);
    });

    it("response where dist-tags.latest is empty string → red", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(
          200,
          JSON.stringify({ "dist-tags": { latest: "" } }),
        ),
      });
      expect(result.state).toBe("red");
    });

    it("response that is not an object → red", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl: fakeFetch(200, JSON.stringify("just a string")),
      });
      expect(result.state).toBe("red");
    });

    it("fetch throws → red with thrown errorDesc", async () => {
      const fetchImpl = (async () => {
        throw new Error("econnrefused");
      }) as unknown as typeof fetch;
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl,
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("econnrefused");
    });

    it("fetch throws a non-Error → red with stringified errorDesc", async () => {
      const fetchImpl = (async () => {
        throw "string-error"; // eslint-disable-line no-throw-literal
      }) as unknown as typeof fetch;
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:react",
        name: "react",
        pinnedVersion: "19.0.0",
        ecosystem: "npm",
        fetchImpl,
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("string-error");
    });

    it("builds the registry URL via encodeURIComponent so scoped names work", async () => {
      let capturedUrl = "";
      const fetchImpl = (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({ "dist-tags": { latest: "1.0.0" } }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:pkg",
        name: "@copilotkit/runtime",
        pinnedVersion: "1.0.0",
        ecosystem: "npm",
        fetchImpl,
      });
      expect(capturedUrl).toBe(
        "https://registry.npmjs.org/%40copilotkit%2Fruntime",
      );
    });
  });

  describe("pypi", () => {
    it("stable: pinned matches info.version → green, drift=false", async () => {
      const body = await readFixture("pypi-response-stable.json");
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:fastapi",
        name: "fastapi",
        pinnedVersion: "0.115.0",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(200, body),
      });
      expect(result.state).toBe("green");
      expect(result.signal.latest).toBe("0.115.0");
      expect(result.signal.drift).toBe(false);
    });

    it("drift: pinned older than info.version → red, drift=true", async () => {
      const body = await readFixture("pypi-response-drift.json");
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:fastapi",
        name: "fastapi",
        pinnedVersion: "0.100.0",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(200, body),
      });
      expect(result.state).toBe("red");
      expect(result.signal.drift).toBe(true);
    });

    it("404 → red with 'package not found'", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:x",
        name: "no-such-pypi-pkg-zz",
        pinnedVersion: "1",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(404, ""),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("package not found");
    });

    it("429 → red with 'rate-limited'", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:x",
        name: "fastapi",
        pinnedVersion: "0.100.0",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(429, ""),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("rate-limited");
    });

    it("response missing info.version → red with 'missing latest'", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:x",
        name: "fastapi",
        pinnedVersion: "0.100.0",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(200, JSON.stringify({ info: { name: "x" } })),
      });
      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toMatch(/missing latest/);
    });

    it("response where info is not an object → red", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:x",
        name: "fastapi",
        pinnedVersion: "0.100.0",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(200, JSON.stringify({ info: "missing" })),
      });
      expect(result.state).toBe("red");
    });

    it("response with empty info.version → red", async () => {
      const result = await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:x",
        name: "fastapi",
        pinnedVersion: "0.100.0",
        ecosystem: "pypi",
        fetchImpl: fakeFetch(200, JSON.stringify({ info: { version: "" } })),
      });
      expect(result.state).toBe("red");
    });

    it("builds pypi URL with /pypi/<name>/json suffix", async () => {
      let capturedUrl = "";
      const fetchImpl = (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({ info: { version: "0.115.0" } }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      await versionDriftDriver.run(BASE_CTX, {
        key: "version_drift:fastapi",
        name: "fastapi",
        pinnedVersion: "0.115.0",
        ecosystem: "pypi",
        fetchImpl,
      });
      expect(capturedUrl).toBe("https://pypi.org/pypi/fastapi/json");
    });
  });

  it("falls back to ctx.fetchImpl when input has none", async () => {
    const fetchImpl = fakeFetch(
      200,
      JSON.stringify({ "dist-tags": { latest: "1.0.0" } }),
    );
    const ctx = { ...BASE_CTX, fetchImpl };
    const result = await versionDriftDriver.run(ctx, {
      key: "version_drift:x",
      name: "x",
      pinnedVersion: "1.0.0",
      ecosystem: "npm",
    });
    expect(result.state).toBe("green");
  });

  it("observedAt is set from ctx.now()", async () => {
    const fetchImpl = fakeFetch(
      200,
      JSON.stringify({ "dist-tags": { latest: "1.0.0" } }),
    );
    const result = await versionDriftDriver.run(BASE_CTX, {
      key: "version_drift:x",
      name: "x",
      pinnedVersion: "1.0.0",
      ecosystem: "npm",
      fetchImpl,
    });
    expect(result.observedAt).toBe("2026-04-20T00:00:00.000Z");
  });
});
