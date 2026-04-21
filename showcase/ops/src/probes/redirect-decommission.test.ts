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
  });
});
