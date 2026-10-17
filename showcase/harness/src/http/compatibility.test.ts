import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { logger } from "../logger.js";
import type { PbClient } from "../storage/pb-client.js";
import { canonicalPayload, computeSignature } from "./hmac.js";
import { registerCompatibilityRoutes } from "./compatibility.js";

const NOW = 1_700_000_000;
const AT = new Date(NOW * 1000).toISOString();
const SECRET = "audit-secret";
const PATH = "/api/compatibility";
const snapshot = {
  date: "November 14, 2023",
  assessedAt: AT,
  methodology: "https://example.com/rubric",
  rows: [
    {
      slug: "example",
      language: "python",
      currentScore: null,
      status: "not_verified",
      packages: [
        {
          name: "example",
          role: "framework",
          drivesCompatibility: true,
          compatibilityScore: null,
          setsVariantScore: false,
          runningVersion: null,
          latest: "1.2.3",
          sourceUrl: "https://pypi.org/project/example/",
        },
      ],
    },
  ],
};
function fixture(
  initial: Record<string, unknown> | null = null,
  expectedLibraries: Record<string, string[]> = { example: ["example"] },
) {
  let record = initial;
  const write = vi.fn(async (_collection, _field, _key, patch) => {
    record = { ...record, ...patch };
    return record;
  });
  const pb = {
    getFirst: vi.fn(async () => record),
    upsertByField: write,
  } as unknown as PbClient;
  const app = new Hono();
  registerCompatibilityRoutes(app, {
    pb,
    logger,
    secrets: [SECRET],
    environmentId: "prod-id",
    nowSec: () => NOW,
    expectedLibraries,
  });
  async function publish(value: Record<string, unknown>, secret = SECRET) {
    const body = JSON.stringify(value);
    return app.request(PATH, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "X-Ops-Timestamp": String(NOW),
        "X-Ops-Signature":
          "sha256=" +
          computeSignature(
            secret,
            canonicalPayload("POST", PATH, String(NOW), body),
          ),
      },
    });
  }
  return {
    app,
    publish,
    write,
    get record() {
      return record;
    },
  };
}
const success = {
  environmentId: "prod-id",
  attemptedAt: AT,
  status: "success",
  snapshot,
  sourceCommits: { example: "a".repeat(40) },
  runUrl: "https://github.com/CopilotKit/CopilotKit/actions/runs/123",
};

describe("saved compatibility publication", () => {
  it("publishes complete results including unresolved versions and allows public reads", async () => {
    const f = fixture();
    expect((await f.publish(success)).status).toBe(200);
    const response = await f.app.request(PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      snapshot,
      lastAttemptStatus: "success",
      environmentId: "prod-id",
    });
  });
  it("preserves the successful snapshot and date when a later audit fails", async () => {
    const f = fixture();
    await f.publish(success);
    const later = new Date((NOW + 60) * 1000).toISOString();
    expect(
      (
        await f.publish({
          environmentId: "prod-id",
          attemptedAt: later,
          status: "failed",
          error: "Registry unavailable",
          runUrl: success.runUrl,
        })
      ).status,
    ).toBe(200);
    expect(f.record).toMatchObject({
      snapshot,
      last_attempt_at: later,
      last_attempt_status: "failed",
    });
  });
  it("rejects unsigned or wrongly signed writes", async () => {
    const f = fixture();
    expect(
      (
        await f.app.request(PATH, {
          method: "POST",
          body: JSON.stringify(success),
        })
      ).status,
    ).toBe(401);
    expect((await f.publish(success, "wrong-secret")).status).toBe(401);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("rejects results for the other environment", async () => {
    const f = fixture();
    expect(
      (await f.publish({ ...success, environmentId: "staging-id" })).status,
    ).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("does not replace a newer assessment with a delayed older publication", async () => {
    const f = fixture({
      snapshot,
      last_attempt_at: new Date((NOW + 60) * 1000).toISOString(),
    });
    expect((await f.publish(success)).status).toBe(409);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("rejects incomplete snapshots rather than publishing partial rows", async () => {
    const f = fixture();
    expect(
      (await f.publish({ ...success, snapshot: { ...snapshot, rows: [{}] } }))
        .status,
    ).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("returns an explicit empty state before the first published audit", async () => {
    const f = fixture();
    expect(await (await f.app.request(PATH)).json()).toMatchObject({
      snapshot: null,
      lastAttemptStatus: null,
    });
  });
  it("rejects a missing framework instead of shrinking the dashboard", async () => {
    const f = fixture(null, { example: ["example"], missing: ["missing"] });
    expect((await f.publish(success)).status).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("rejects duplicate rows and missing required library entries", async () => {
    const f = fixture();
    expect(
      (
        await f.publish({
          ...success,
          snapshot: { ...snapshot, rows: [snapshot.rows[0], snapshot.rows[0]] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.publish({
          ...success,
          snapshot: {
            ...snapshot,
            rows: [{ ...snapshot.rows[0], packages: [] }],
          },
        })
      ).status,
    ).toBe(400);
    expect(f.write).not.toHaveBeenCalled();
  });
  it("requires source provenance for every published framework", async () => {
    const f = fixture();
    expect((await f.publish({ ...success, sourceCommits: {} })).status).toBe(
      400,
    );
    expect(f.write).not.toHaveBeenCalled();
  });
  it("serializes overlapping publications so a delayed older write cannot replace newer results", async () => {
    const f = fixture();
    const write = f.write.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.write.mockImplementationOnce(async (...args) => {
      await gate;
      return write(...args);
    });
    const olderAt = new Date((NOW - 60) * 1000).toISOString();
    const older = f.publish({
      ...success,
      attemptedAt: olderAt,
      snapshot: { ...snapshot, assessedAt: olderAt },
    });
    await vi.waitFor(() => expect(f.write).toHaveBeenCalledTimes(1));
    const newer = f.publish(success);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([older, newer]);
    expect(f.record).toMatchObject({ snapshot, last_attempt_at: AT });
  });
});
