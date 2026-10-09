import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_ID_BY_NAME, SERVICES } from "./railway-envs";

const SCRIPT = resolve(__dirname, "prepare-docs-release-pin.ts");
const DIGEST_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const GIT_SHA = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const VERIFIED_AT = "2026-09-17T12:00:00.000Z";

describe("prepare-docs-release-pin CLI", () => {
  let workDir: string;
  let pinPath: string;
  let githubOutput: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "docs-pin-"));
    pinPath = join(workDir, "docs-prod.json");
    githubOutput = join(workDir, "github_output");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("authenticates both live digest queries without override flags", () => {
    const fetchStub = join(workDir, "railway-fetch.mjs");
    const requestsPath = join(workDir, "requests.jsonl");
    // Intercept only the network boundary in a real CLI subprocess. In
    // particular, do not mock token resolution or the digest fetcher.
    writeFileSync(
      fetchStub,
      `
      import { appendFileSync } from "node:fs";
      globalThis.fetch = async (url, options) => {
        if (url !== "https://backboard.railway.app/graphql/v2") {
          throw new Error("Unexpected network request: " + url);
        }
        if (options.headers.Authorization !== "Bearer docs-pin-test-token") {
          return new Response("unauthorized", { status: 401 });
        }
        const { variables } = JSON.parse(options.body);
        appendFileSync(${JSON.stringify(requestsPath)}, JSON.stringify(variables) + "\\n");
        const digest = variables.environmentId === ${JSON.stringify(ENV_ID_BY_NAME.staging)}
          ? ${JSON.stringify(DIGEST_A)} : ${JSON.stringify(DIGEST_B)};
        return Response.json({ data: { deployments: { edges: [{ node: {
          id: "test-deployment", status: "SUCCESS", createdAt: "2026-09-17T12:00:00Z",
          meta: { imageDigest: digest }
        } }] } } });
      };
    `,
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--import",
        fetchStub,
        SCRIPT,
        `--pin-path=${pinPath}`,
        `--git-sha=${GIT_SHA}`,
        `--verified-at=${VERIFIED_AT}`,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          RAILWAY_TOKEN: "docs-pin-test-token",
          GITHUB_OUTPUT: githubOutput,
        },
      },
    );
    expect(JSON.parse(readFileSync(pinPath, "utf8")).digest).toBe(DIGEST_A);
    const requests = readFileSync(requestsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(requests).toEqual([
      {
        serviceId: SERVICES.docs.serviceId,
        environmentId: ENV_ID_BY_NAME.staging,
      },
      {
        serviceId: SERVICES.docs.serviceId,
        environmentId: ENV_ID_BY_NAME.prod,
      },
    ]);
    expect(readFileSync(githubOutput, "utf8")).toContain("skip=false");
  });

  it("writes the pin and sets skip=false when staging differs", () => {
    const out = execFileSync(
      "npx",
      [
        "tsx",
        SCRIPT,
        `--pin-path=${pinPath}`,
        `--staging-digest=${DIGEST_A}`,
        `--verified-staging-digest=${DIGEST_A}`,
        `--prod-digest=${DIGEST_B}`,
        `--git-sha=${GIT_SHA}`,
        `--verified-at=${VERIFIED_AT}`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
        // Windows: npx is npx.cmd; execFileSync cannot spawn .cmd without a shell.
        shell: process.platform === "win32",
      },
    );
    const pin = JSON.parse(readFileSync(pinPath, "utf8")) as {
      digest: string;
      image: string;
      service: string;
    };
    expect(pin).toEqual({
      schema_version: 1,
      service: "docs",
      image: `ghcr.io/copilotkit/showcase-shell-docs@${DIGEST_A}`,
      digest: DIGEST_A,
      git_sha: GIT_SHA,
      staging_url: "https://docs.staging.copilotkit.ai",
      verified_at: VERIFIED_AT,
    });
    expect(readFileSync(githubOutput, "utf8")).toMatch(/skip=false/);
    expect(out).toMatch(/staging digest differs from prod and pin/);
  });

  it.each([DIGEST_B, ""])(
    "does not pin staging that changed after the probe: %s",
    (stagingDigest) => {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          SCRIPT,
          `--pin-path=${pinPath}`,
          `--git-sha=${GIT_SHA}`,
          `--verified-staging-digest=${DIGEST_A}`,
          `--staging-digest=${stagingDigest}`,
          `--prod-digest=${DIGEST_A}`,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, GITHUB_OUTPUT: githubOutput },
        },
      );
      expect(() => readFileSync(pinPath, "utf8")).toThrow();
      expect(readFileSync(githubOutput, "utf8")).toContain("skip=true");
      expect(readFileSync(githubOutput, "utf8")).toContain(
        "staging digest changed during verification",
      );
    },
  );

  it("does not write when staging equals prod", () => {
    execFileSync(
      "npx",
      [
        "tsx",
        SCRIPT,
        `--pin-path=${pinPath}`,
        `--staging-digest=${DIGEST_A}`,
        `--prod-digest=${DIGEST_A}`,
        `--git-sha=${GIT_SHA}`,
        `--verified-at=${VERIFIED_AT}`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
        // Windows: npx is npx.cmd; execFileSync cannot spawn .cmd without a shell.
        shell: process.platform === "win32",
      },
    );
    expect(() => readFileSync(pinPath, "utf8")).toThrow();
    expect(readFileSync(githubOutput, "utf8")).toMatch(/skip=true/);
  });

  it("does not write when staging equals the pin already on disk", () => {
    writeFileSync(
      pinPath,
      `${JSON.stringify(
        {
          schema_version: 1,
          service: "docs",
          image: `ghcr.io/copilotkit/showcase-shell-docs@${DIGEST_A}`,
          digest: DIGEST_A,
          git_sha: GIT_SHA,
          staging_url: "https://docs.staging.copilotkit.ai",
          verified_at: VERIFIED_AT,
        },
        null,
        2,
      )}\n`,
    );
    execFileSync(
      "npx",
      [
        "tsx",
        SCRIPT,
        `--pin-path=${pinPath}`,
        `--staging-digest=${DIGEST_A}`,
        `--prod-digest=${DIGEST_B}`,
        `--git-sha=${GIT_SHA}`,
        `--verified-at=${VERIFIED_AT}`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
        // Windows: npx is npx.cmd; execFileSync cannot spawn .cmd without a shell.
        shell: process.platform === "win32",
      },
    );
    expect(readFileSync(githubOutput, "utf8")).toMatch(/skip=true/);
  });
});
