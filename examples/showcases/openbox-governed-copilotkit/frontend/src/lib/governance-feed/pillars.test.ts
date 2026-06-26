import { describe, it, expect } from "vitest";
import { derivePillar, pillarLabel } from "./pillars";

describe("derivePillar", () => {
  it("attributes guardrails when a redaction summary is present", () => {
    expect(
      derivePillar(
        {
          verdict: "constrain",
          redactionSummary: "redacted output.artifact.body",
          hasGuardrailsSignal: false,
        },
        undefined,
      ),
    ).toBe("guardrails");
  });
  it("attributes guardrails when a guardrails signal is present", () => {
    expect(
      derivePillar(
        { verdict: "constrain", hasGuardrailsSignal: true },
        undefined,
      ),
    ).toBe("guardrails");
  });
  it("attributes policies for block/halt without guardrails signals", () => {
    expect(
      derivePillar({ verdict: "block", hasGuardrailsSignal: false }, undefined),
    ).toBe("policies");
    expect(
      derivePillar({ verdict: "halt", hasGuardrailsSignal: false }, undefined),
    ).toBe("policies");
  });
  it("attributes behavioral_rules for approval gates", () => {
    expect(
      derivePillar(
        { verdict: "approval", hasGuardrailsSignal: false },
        undefined,
      ),
    ).toBe("behavioral_rules");
  });
  it("falls back to scenario capability copy when ambiguous", () => {
    // allow with no signals -> use scenario capability text
    expect(
      derivePillar(
        { verdict: "allow", hasGuardrailsSignal: false },
        { capability: "Output guardrails, redaction, audit trail" },
      ),
    ).toBe("guardrails");
    expect(
      derivePillar(
        { verdict: "allow", hasGuardrailsSignal: false },
        { capability: "Internal workflow policy" },
      ),
    ).toBe("policies");
    expect(
      derivePillar(
        { verdict: "allow", hasGuardrailsSignal: false },
        { capability: "Human-in-the-loop approval" },
      ),
    ).toBe("behavioral_rules");
  });
  it("returns unknown when nothing matches", () => {
    expect(
      derivePillar({ verdict: "allow", hasGuardrailsSignal: false }, undefined),
    ).toBe("unknown");
  });

  it("guardrails signal short-circuits BEFORE block→policies check", () => {
    // hasGuardrailsSignal: true must win even when verdict is "block"
    expect(
      derivePillar({ verdict: "block", hasGuardrailsSignal: true }, undefined),
    ).toBe("guardrails");
    // same for verdict: "approval" — guardrails signal still wins
    expect(
      derivePillar(
        { verdict: "approval", hasGuardrailsSignal: true },
        undefined,
      ),
    ).toBe("guardrails");
  });

  it("empty redactionSummary does NOT trigger guardrails", () => {
    // An empty string must NOT satisfy the redactionSummary.length > 0 guard,
    // so the call falls through to the capability/unknown path.
    expect(
      derivePillar(
        { verdict: "allow", redactionSummary: "", hasGuardrailsSignal: false },
        undefined,
      ),
    ).toBe("unknown");
  });

  it("capability containing 'drift' resolves to policies", () => {
    expect(
      derivePillar(
        { verdict: "allow", hasGuardrailsSignal: false },
        { capability: "Drift detection and policy enforcement" },
      ),
    ).toBe("policies");
  });

  it("non-allow verdict falls through to capability branch when no guardrails signal", () => {
    // "constrain" is not approval/block/halt, so the capability branch is reached
    expect(
      derivePillar(
        { verdict: "constrain", hasGuardrailsSignal: false },
        { capability: "Internal workflow policy" },
      ),
    ).toBe("policies");
    // "reviewing" similarly falls through to capability branch
    expect(
      derivePillar(
        { verdict: "reviewing", hasGuardrailsSignal: false },
        { capability: "Human-in-the-loop approval" },
      ),
    ).toBe("behavioral_rules");
  });
});

describe("pillarLabel", () => {
  it("renders human labels", () => {
    expect(pillarLabel("guardrails")).toBe("Guardrails");
    expect(pillarLabel("policies")).toBe("Policies");
    expect(pillarLabel("behavioral_rules")).toBe("Behavioral rules");
    expect(pillarLabel("unknown")).toBe("Governance");
  });
});
