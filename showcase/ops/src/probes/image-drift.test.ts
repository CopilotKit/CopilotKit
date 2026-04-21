import { describe, it, expect } from "vitest";
import { imageDriftProbe } from "./image-drift.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };

describe("image-drift probe", () => {
  it("returns green when all digests match", async () => {
    const r = await imageDriftProbe.run(
      {
        deployed: [{ service: "a", digest: "sha256:1" }],
        fetchLatestDigest: async () => "sha256:1",
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.staleServices).toEqual([]);
    expect(r.signal.errored).toEqual([]);
    expect(r.signal.erroredCount).toBe(0);
  });

  it("returns red with stale services listed", async () => {
    const r = await imageDriftProbe.run(
      {
        deployed: [
          { service: "a", digest: "sha256:1" },
          { service: "b", digest: "sha256:2" },
        ],
        fetchLatestDigest: async (s) => (s === "a" ? "sha256:NEW" : "sha256:2"),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.staleServices).toEqual(["a"]);
    expect(r.signal.triggered).toEqual(["a"]);
    expect(r.signal.triggeredCount).toBe(1);
    expect(r.signal.rebuildNoun).toBe("rebuild");
  });

  it("pluralizes rebuildNoun with multiple stale services", async () => {
    const r = await imageDriftProbe.run(
      {
        deployed: [
          { service: "a", digest: "sha256:1" },
          { service: "b", digest: "sha256:2" },
        ],
        fetchLatestDigest: async () => "sha256:NEW",
      },
      ctx,
    );
    expect(r.signal.rebuildNoun).toBe("rebuilds");
  });

  it("returns red with errored bucket when GHCR returns null (no silent green)", async () => {
    const r = await imageDriftProbe.run(
      {
        deployed: [
          { service: "a", digest: "sha256:1" },
          { service: "b", digest: "sha256:2" },
        ],
        fetchLatestDigest: async (s) => (s === "a" ? null : "sha256:2"),
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.staleServices).toEqual([]);
    expect(r.signal.errored).toEqual(["a"]);
    expect(r.signal.erroredCount).toBe(1);
    expect(r.signal.triggered).toEqual(["a"]);
    expect(r.signal.triggeredCount).toBe(1);
  });

  it("combines stale + errored buckets when both are non-empty", async () => {
    const r = await imageDriftProbe.run(
      {
        deployed: [
          { service: "a", digest: "sha256:1" },
          { service: "b", digest: "sha256:2" },
          { service: "c", digest: "sha256:3" },
        ],
        fetchLatestDigest: async (s) => {
          if (s === "a") return null;
          if (s === "b") return "sha256:NEW";
          return "sha256:3";
        },
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.staleServices).toEqual(["b"]);
    expect(r.signal.errored).toEqual(["a"]);
    // Contract: triggered is stale-first, errored-last (each sorted within).
    // Operators read the list as "rebuild these (b), and failed lookups (a)".
    expect(r.signal.triggered).toEqual(["b", "a"]);
    expect(r.signal.triggeredCount).toBe(2);
    expect(r.signal.rebuildNoun).toBe("rebuilds");
  });

  it("dedupes duplicate (service, digest) input entries", async () => {
    // Regression: duplicates in input.deployed could previously cause the same
    // service to appear in BOTH stale and errored buckets if fetchLatestDigest
    // returned different values across calls. First occurrence wins.
    let call = 0;
    const r = await imageDriftProbe.run(
      {
        deployed: [
          { service: "a", digest: "sha256:1" },
          { service: "a", digest: "sha256:1" },
          { service: "a", digest: "sha256:1" },
        ],
        fetchLatestDigest: async () => {
          call++;
          return call === 1 ? "sha256:1" : null;
        },
      },
      ctx,
    );
    expect(call).toBe(1);
    expect(r.state).toBe("green");
    expect(r.signal.staleServices).toEqual([]);
    expect(r.signal.errored).toEqual([]);
    expect(r.signal.triggered).toEqual([]);
  });
});
