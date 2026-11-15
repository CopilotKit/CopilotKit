import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRedeploy } from "../redeploy-env";
import { SERVICES } from "../railway-envs";

// A.4: per-service JSON summary contract.
//
// Shape (cross-workstream contract, consumed by showcase_deploy.yml's
// `enforce-redeploy-gate` job in A.7):
//   Array<{ service: string; status: "ok" | "error"; error?: string }>
//
// When REDEPLOY_SUMMARY_JSON env var is set, runRedeploy MUST write the
// records array to that path atomically (stage to .tmp, rename). When
// unset, no JSON is written.
//
// Any failed image/deployment verification must block the CI deployment lane,
// including staging and starter-only pushes. Summary write failures remain
// best-effort and do not change the deployment result.
// The JSON write happens BEFORE the exit-code computation; it never
// changes exit semantics on disk hiccups (write failures are warn-only).
describe("redeploy-env per-service JSON summary", () => {
  let dir: string;
  let summaryPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "redeploy-summary-"));
    summaryPath = join(dir, "summary.json");
    process.env.REDEPLOY_SUMMARY_JSON = summaryPath;
  });

  afterEach(() => {
    delete process.env.REDEPLOY_SUMMARY_JSON;
    rmSync(dir, { recursive: true, force: true });
  });

  it("atomically persists all skipped proof records without successes or failures, including image consumers", async () => {
    const proof = {
      ok: false as const,
      skipped: true as const,
      reason: "superseded" as const,
      supersededBy: "e".repeat(40),
      supersedingImageDigest: `sha256:${"e".repeat(64)}`,
    };
    const summary = await runRedeploy({
      env: "staging",
      services: ["harness"],
      appendSummary: () => {},
      redeploy: async () => proof,
    });
    expect(summary).toMatchObject({
      exitCode: 0,
      attempted: 2,
      succeeded: 0,
      failed: 0,
      skipped: 2,
    });
    const { ok: _ok, skipped: _skipped, ...metadata } = proof;
    expect(JSON.parse(readFileSync(summaryPath, "utf8"))).toEqual(
      ["harness", "harness-workers"].map((service) => ({
        service,
        status: "skipped",
        ...metadata,
      })),
    );
    expect(readdirSync(dir)).not.toContain("summary.json.tmp");
  });

  it("writes one JSON record per attempted service with status", async () => {
    const ag2ServiceId = SERVICES["showcase-ag2"].serviceId;
    const summary = await runRedeploy({
      env: "staging",
      services: ["showcase-mastra", "showcase-ag2"],
      appendSummary: () => {},
      redeploy: async (serviceId) => {
        if (serviceId === ag2ServiceId) {
          return { ok: false, error: "boom" };
        }
        return { ok: true };
      },
    });
    expect(summary.exitCode).toBe(1); // failed deployment must block CI
    const records = JSON.parse(readFileSync(summaryPath, "utf8")) as Array<{
      service: string;
      status: "ok" | "error";
      error?: string;
    }>;
    expect(records).toEqual(
      expect.arrayContaining([
        { service: "showcase-ag2", status: "error", error: "boom" },
        { service: "showcase-mastra", status: "ok" },
      ]),
    );
    expect(records).toHaveLength(2);
  });

  it("does NOT write JSON when REDEPLOY_SUMMARY_JSON is unset", async () => {
    delete process.env.REDEPLOY_SUMMARY_JSON;
    await runRedeploy({
      env: "staging",
      services: ["showcase-mastra"],
      appendSummary: () => {},
      redeploy: async () => ({ ok: true }),
    });
    // The temp dir we created is empty — assert nothing was written.
    // (No path was given; the function had nowhere to write.)
    expect(readdirSync(dir)).toEqual([]);
  });

  it("fails staging while retaining every receipt when all deployments fail", async () => {
    const summary = await runRedeploy({
      env: "staging",
      services: ["showcase-mastra", "showcase-ag2"],
      appendSummary: () => {},
      redeploy: async () => ({ ok: false, error: "boom" }),
    });
    expect(summary.exitCode).toBe(1);
    expect(summary.failed).toBe(2);
    const records = JSON.parse(readFileSync(summaryPath, "utf8")) as Array<{
      service: string;
      status: "ok" | "error";
      error?: string;
    }>;
    expect(records.every((r) => r.status === "error")).toBe(true);
    expect(records).toHaveLength(2);
  });

  it("preserves PR #5093 contract: prod exits 1 on any per-service failure", async () => {
    const summary = await runRedeploy({
      env: "prod",
      services: ["showcase-mastra"],
      appendSummary: () => {},
      redeploy: async () => ({ ok: false, error: "boom" }),
    });
    expect(summary.exitCode).toBe(1);
    const records = JSON.parse(readFileSync(summaryPath, "utf8")) as Array<{
      service: string;
      status: "ok" | "error";
      error?: string;
    }>;
    expect(records).toEqual([
      { service: "showcase-mastra", status: "error", error: "boom" },
    ]);
  });

  it("records caught throws as status:error with the thrown message", async () => {
    const summary = await runRedeploy({
      env: "staging",
      services: ["showcase-mastra"],
      appendSummary: () => {},
      redeploy: async () => {
        throw new Error("kaboom");
      },
    });
    expect(summary.exitCode).toBe(1);
    expect(summary.failed).toBe(1);
    const records = JSON.parse(readFileSync(summaryPath, "utf8")) as Array<{
      service: string;
      status: "ok" | "error";
      error?: string;
    }>;
    expect(records).toEqual([
      { service: "showcase-mastra", status: "error", error: "kaboom" },
    ]);
  });
});
