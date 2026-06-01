import { describe, it, expect } from "vitest";
import { redirectDecommissionProbe } from "./redirect-decommission.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };

describe("redirect-decommission probe", () => {
  it("flags hasCandidates=true when count > 0", async () => {
    const r = await redirectDecommissionProbe.run(
      { body: ":warning: 3 candidates", candidateCount: 3 },
      ctx,
    );
    // Invariant: redirect-decommission always reports green at the
    // state-machine level; the monthly template branches on hasCandidates.
    expect(r.state).toBe("green");
    expect(r.signal.hasCandidates).toBe(true);
    expect(r.signal.body).toBe(":warning: 3 candidates");
  });

  it("flags hasCandidates=false when count == 0", async () => {
    const r = await redirectDecommissionProbe.run(
      { body: "", candidateCount: 0 },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.hasCandidates).toBe(false);
    expect(r.signal.probeErrored).toBe(false);
  });

  it("surfaces probeErrored + probeErrorDesc when upstream audit fails", async () => {
    // Regression: without this flag, the monthly suppression guard
    // (signal.hasCandidates != true) silently swallows a failed audit — a
    // broken SEO audit for N months would produce zero alerts. Templates
    // should render a dedicated "audit failed" branch when this fires.
    const r = await redirectDecommissionProbe.run(
      {
        body: "",
        candidateCount: 0,
        probeErrored: true,
        probeErrorDesc: "serp api 5xx",
      },
      ctx,
    );
    expect(r.signal.probeErrored).toBe(true);
    expect(r.signal.probeErrorDesc).toBe("serp api 5xx");
    expect(r.signal.hasCandidates).toBe(false);
  });

  it("defaults probeErrored/probeErrorDesc to false/empty when caller omits them", async () => {
    const r = await redirectDecommissionProbe.run(
      { body: "", candidateCount: 0 },
      ctx,
    );
    expect(r.signal.probeErrored).toBe(false);
    expect(r.signal.probeErrorDesc).toBe("");
  });
});
