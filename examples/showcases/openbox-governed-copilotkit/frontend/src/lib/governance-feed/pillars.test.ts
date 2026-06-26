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
});

describe("pillarLabel", () => {
  it("renders human labels", () => {
    expect(pillarLabel("guardrails")).toBe("Guardrails");
    expect(pillarLabel("policies")).toBe("Policies");
    expect(pillarLabel("behavioral_rules")).toBe("Behavioral rules");
    expect(pillarLabel("unknown")).toBe("Governance");
  });
});
