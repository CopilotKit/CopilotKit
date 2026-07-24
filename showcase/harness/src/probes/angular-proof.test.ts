import { describe, expect, it } from "vitest";

import {
  ANGULAR_PROOF_FEATURES,
  evaluateRuntimeReadiness,
} from "./angular-proof.js";

describe("Angular proof contracts", () => {
  it("keeps the checkpoint proof set explicit and bounded", () => {
    expect(ANGULAR_PROOF_FEATURES).toEqual([
      "agentic-chat",
      "frontend-tools",
      "gen-ui-tool-based",
      "tool-rendering",
      "shared-state-read-write",
      "gen-ui-interrupt",
      "hitl-in-chat",
      "prebuilt-popup",
      "prebuilt-sidebar",
      "declarative-gen-ui",
      "a2ui-recovery",
      "mcp-apps",
      "open-gen-ui",
      "threadid-frontend-tool-roundtrip",
      "headless-complete",
    ]);
  });

  it("accepts ten runtime-ready samples within the two-second budget", () => {
    expect(evaluateRuntimeReadiness(Array(10).fill(1_999))).toEqual({
      sampleCount: 10,
      maximumMs: 1_999,
      p95Ms: 1_999,
      passed: true,
    });
  });

  it("rejects missing samples and any sample over the budget", () => {
    expect(() => evaluateRuntimeReadiness([500])).toThrow(/exactly 10/i);
    expect(evaluateRuntimeReadiness([...Array(9).fill(500), 2_001])).toEqual({
      sampleCount: 10,
      maximumMs: 2_001,
      p95Ms: 2_001,
      passed: false,
    });
  });
});
