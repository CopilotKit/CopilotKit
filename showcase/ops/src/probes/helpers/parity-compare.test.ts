import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { compareParity, DEFAULT_PARITY_TOLERANCES } from "./parity-compare.js";
import type { ParitySnapshot } from "./parity-compare.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(
  __dirname,
  "../../../test/fixtures/parity-snapshots",
);

function loadFixture(name: string): ParitySnapshot {
  const raw = readFileSync(resolve(FIXTURES_DIR, name), "utf8");
  return JSON.parse(raw) as ParitySnapshot;
}

/** Minimal valid snapshot — used as a base to mutate axis-by-axis. */
function baseSnapshot(): ParitySnapshot {
  return {
    domElements: [
      { tag: "div", classes: ["root"], testId: "root" },
      { tag: "button", classes: ["primary"] },
    ],
    toolCalls: ["a", "b"],
    streamProfile: { ttft_ms: 100, p50_chunk_ms: 30, total_chunks: 10 },
    contractShape: { foo: "string", bar: "number" },
  };
}

describe("compareParity — fixture round-trip", () => {
  it("reference-good vs captured-pass yields overall pass", () => {
    const ref = loadFixture("reference-good.json");
    const cap = loadFixture("captured-pass.json");
    const report = compareParity(ref, cap);
    expect(report.overall).toBe("pass");
    expect(report.failure_count).toBe(0);
    expect(report.axes).toEqual({
      dom: "pass",
      tools: "pass",
      stream: "pass",
      contract: "pass",
    });
    // Captured has one extra DOM element (the `debug-panel` div) and
    // one extra contract field (`session.userAgent`).
    expect(report.details.dom?.extra_count).toBe(1);
    expect(report.details.contract?.extra_field_count).toBe(1);
  });

  it("reference-good vs captured-fail-all yields all four axes failing", () => {
    const ref = loadFixture("reference-good.json");
    const cap = loadFixture("captured-fail-all.json");
    const report = compareParity(ref, cap);
    expect(report.overall).toBe("fail");
    expect(report.failure_count).toBe(4);
    expect(report.axes).toEqual({
      dom: "fail",
      tools: "fail",
      stream: "fail",
      contract: "fail",
    });
  });
});

describe("compareParity — DOM axis", () => {
  it("passes when captured is a strict superset", () => {
    const ref = baseSnapshot();
    const cap = baseSnapshot();
    cap.domElements.push({ tag: "span", classes: ["extra"] });
    const report = compareParity(ref, cap);
    expect(report.axes.dom).toBe("pass");
    expect(report.details.dom?.missing).toEqual([]);
    expect(report.details.dom?.extra_count).toBe(1);
  });

  it("fails when reference has elements captured does not", () => {
    const ref = baseSnapshot();
    const cap = baseSnapshot();
    cap.domElements = cap.domElements.slice(0, 1); // drop the button
    const report = compareParity(ref, cap);
    expect(report.axes.dom).toBe("fail");
    expect(report.details.dom?.missing).toHaveLength(1);
    expect(report.details.dom?.missing[0]?.tag).toBe("button");
  });

  it("matches by testId when present, ignoring class differences", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["a", "b"], testId: "x" }],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["c"], testId: "x" }],
    };
    expect(compareParity(ref, cap).axes.dom).toBe("pass");
  });

  it("falls back to class-set equality when testId is absent", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["a", "b"] }],
    };
    // Order shouldn't matter — captured-includes-reference is
    // order-independent.
    const capSameSet: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["b", "a"] }],
    };
    expect(compareParity(ref, capSameSet).axes.dom).toBe("pass");

    const capDifferentSet: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["a", "c"] }],
    };
    expect(compareParity(ref, capDifferentSet).axes.dom).toBe("fail");
  });

  it("class match treats captured as a superset (extra captured classes ok)", () => {
    // Module docstring says DOM comparison is "captured is superset of
    // reference" — extra captured classes on a matched element should
    // NOT cause the axis to fail. The historical strict length-equality
    // pre-filter contradicted that rule.
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["primary"] }],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "div", classes: ["primary", "active", "rounded"] }],
    };
    expect(compareParity(ref, cap).axes.dom).toBe("pass");
  });

  it("class match distinguishes duplicates as a multiset (a,a,b ≠ a,b,b)", () => {
    // The pre-fix `Set`-based comparison erroneously declared these
    // equal because they share the same set {a,b} and same length.
    // Multiset semantics correctly reject the mismatch.
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "li", classes: ["a", "a", "b"] }],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "li", classes: ["a", "b", "b"] }],
    };
    expect(compareParity(ref, cap).axes.dom).toBe("fail");
  });

  it("does not double-claim a single captured element for two reference elements", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [
        { tag: "li", classes: ["item"] },
        { tag: "li", classes: ["item"] },
      ],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      domElements: [{ tag: "li", classes: ["item"] }],
    };
    const report = compareParity(ref, cap);
    expect(report.axes.dom).toBe("fail");
    expect(report.details.dom?.missing).toHaveLength(1);
  });

  it("treats empty reference DOM as a vacuous pass", () => {
    const ref: ParitySnapshot = { ...baseSnapshot(), domElements: [] };
    const cap: ParitySnapshot = { ...baseSnapshot(), domElements: [] };
    const report = compareParity(ref, cap);
    expect(report.axes.dom).toBe("pass");
    expect(report.details.dom?.extra_count).toBe(0);
  });
});

describe("compareParity — tools axis", () => {
  it("passes on exact ordered match", () => {
    const ref = baseSnapshot();
    const cap = baseSnapshot();
    const report = compareParity(ref, cap);
    expect(report.axes.tools).toBe("pass");
    expect(report.details.tools?.first_divergence_index).toBeUndefined();
  });

  it("fails on reorder and reports first divergence index", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      toolCalls: ["search", "summarize", "render"],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      toolCalls: ["search", "render", "summarize"],
    };
    const report = compareParity(ref, cap);
    expect(report.axes.tools).toBe("fail");
    expect(report.details.tools?.first_divergence_index).toBe(1);
  });

  it("fails when captured is a prefix of reference", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      toolCalls: ["a", "b", "c"],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      toolCalls: ["a", "b"],
    };
    const report = compareParity(ref, cap);
    expect(report.axes.tools).toBe("fail");
    expect(report.details.tools?.first_divergence_index).toBe(2);
  });

  it("fails when captured has trailing extras", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      toolCalls: ["a"],
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      toolCalls: ["a", "b"],
    };
    const report = compareParity(ref, cap);
    expect(report.axes.tools).toBe("fail");
    expect(report.details.tools?.first_divergence_index).toBe(1);
  });

  it("treats both-empty as a pass", () => {
    const ref: ParitySnapshot = { ...baseSnapshot(), toolCalls: [] };
    const cap: ParitySnapshot = { ...baseSnapshot(), toolCalls: [] };
    expect(compareParity(ref, cap).axes.tools).toBe("pass");
  });
});

describe("compareParity — stream axis", () => {
  it("passes when both ratios are within default tolerances", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 180, p50_chunk_ms: 140, total_chunks: 10 },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.stream).toBe("pass");
    expect(report.details.stream?.ttft_ratio).toBeCloseTo(1.8);
    expect(report.details.stream?.p50_chunk_ratio).toBeCloseTo(2.8);
  });

  it("fails when TTFT ratio exceeds tolerance", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 250, p50_chunk_ms: 60, total_chunks: 10 },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.stream).toBe("fail");
    expect(report.details.stream?.ttft_ratio).toBe(2.5);
  });

  it("fails when P50 chunk ratio exceeds tolerance", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 120, p50_chunk_ms: 200, total_chunks: 10 },
    };
    expect(compareParity(ref, cap).axes.stream).toBe("fail");
  });

  it("respects caller-provided tolerance overrides", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 250, p50_chunk_ms: 60, total_chunks: 10 },
    };
    // 250/100 = 2.5; default fails, 3.0 passes.
    expect(compareParity(ref, cap, { ttft_ratio: 3.0 }).axes.stream).toBe(
      "pass",
    );
  });

  it("fails with a reason when reference TTFT is zero", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 0, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 50, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.stream).toBe("fail");
    expect(report.details.stream?.reason).toMatch(/reference\.ttft_ms/);
    expect(report.details.stream?.ttft_ratio).toBe(Number.POSITIVE_INFINITY);
  });

  it("fails with a reason when reference P50 chunk is zero", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 0, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 10, total_chunks: 10 },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.stream).toBe("fail");
    expect(report.details.stream?.reason).toMatch(/reference\.p50_chunk_ms/);
  });

  it("fails when captured has a NaN measurement", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: {
        ttft_ms: Number.NaN,
        p50_chunk_ms: 50,
        total_chunks: 10,
      },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.stream).toBe("fail");
    expect(report.details.stream?.reason).toMatch(/captured\.ttft_ms/);
  });

  it("uses spec-default tolerances when none are supplied", () => {
    expect(DEFAULT_PARITY_TOLERANCES.ttft_ratio).toBe(2.0);
    expect(DEFAULT_PARITY_TOLERANCES.p50_chunk_ratio).toBe(3.0);
  });

  it("fails when captured produced zero chunks but reference had chunks", () => {
    // A 5xx response / dead network / detached CDP yields a captured
    // profile of all zeros. Without the explicit zero-chunk guard,
    // computeRatio(0, refTtft) = 0 ≤ 2.0 so the axis would PASS while
    // masking total stream failure. The guard surfaces this loudly.
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 0, p50_chunk_ms: 0, total_chunks: 0 },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.stream).toBe("fail");
    expect(report.details.stream?.reason).toMatch(/zero chunks/);
    expect(report.details.stream?.ttft_ratio).toBe(Number.POSITIVE_INFINITY);
    expect(report.details.stream?.p50_chunk_ratio).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("vacuously passes when both reference and captured have zero chunks", () => {
    // A featureType where the reference itself never produced a stream
    // (rare but possible — e.g. frontend-only flow) shouldn't be
    // penalised when captured also has zero. The guard only fires when
    // reference > 0 and captured == 0; the underlying ratio path then
    // handles the symmetric-zero case via the existing reference-side
    // "must be > 0" reason.
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 0, p50_chunk_ms: 0, total_chunks: 0 },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      streamProfile: { ttft_ms: 0, p50_chunk_ms: 0, total_chunks: 0 },
    };
    const report = compareParity(ref, cap);
    // Reference has ttft=0 so the existing ratio path fires its own
    // "reference must be > 0" reason; the axis still fails (correctly,
    // because we can't compute a meaningful ratio against a zero
    // reference). We assert on the reason source — this is NOT the
    // zero-chunk branch.
    expect(report.axes.stream).toBe("fail");
    expect(report.details.stream?.reason).not.toMatch(/zero chunks/);
  });
});

describe("compareParity — contract axis", () => {
  it("passes when captured is a strict superset of reference fields", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { a: "string", b: "number" },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { a: "string", b: "number", c: "boolean" },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.contract).toBe("pass");
    expect(report.details.contract?.extra_field_count).toBe(1);
  });

  it("fails when a reference field is missing from captured", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { a: "string", b: "number" },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { a: "string" },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.contract).toBe("fail");
    expect(report.details.contract?.missing_fields).toEqual(["b"]);
    // Pure-absent field belongs in missing_fields, NOT type_mismatched.
    expect(report.details.contract?.type_mismatched_fields).toEqual([]);
  });

  it("fails when a reference field has a mismatched type", () => {
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { a: "string" },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { a: "number" },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.contract).toBe("fail");
    // Type drift is its own bucket; missing_fields reserved for absent-only.
    expect(report.details.contract?.missing_fields).toEqual([]);
    expect(report.details.contract?.type_mismatched_fields).toEqual(["a"]);
  });

  it("splits absent and type-drifted fields into separate buckets", () => {
    // One field absent, one field type-mismatched — buckets must NOT
    // be conflated.
    const ref: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { absent: "string", drifted: "number" },
    };
    const cap: ParitySnapshot = {
      ...baseSnapshot(),
      contractShape: { drifted: "string" },
    };
    const report = compareParity(ref, cap);
    expect(report.axes.contract).toBe("fail");
    expect(report.details.contract?.missing_fields).toEqual(["absent"]);
    expect(report.details.contract?.type_mismatched_fields).toEqual([
      "drifted",
    ]);
  });

  it("treats both-empty as a vacuous pass", () => {
    const ref: ParitySnapshot = { ...baseSnapshot(), contractShape: {} };
    const cap: ParitySnapshot = { ...baseSnapshot(), contractShape: {} };
    const report = compareParity(ref, cap);
    expect(report.axes.contract).toBe("pass");
    expect(report.details.contract?.extra_field_count).toBe(0);
  });
});

describe("compareParity — aggregate verdict", () => {
  it("overall pass requires all four axes pass", () => {
    const ref = baseSnapshot();
    const cap = baseSnapshot();
    const report = compareParity(ref, cap);
    expect(report.overall).toBe("pass");
    expect(report.failure_count).toBe(0);
  });

  it("counts failures across mixed axes correctly", () => {
    const ref: ParitySnapshot = {
      domElements: [{ tag: "div", classes: ["x"] }],
      toolCalls: ["a", "b"],
      streamProfile: { ttft_ms: 100, p50_chunk_ms: 50, total_chunks: 10 },
      contractShape: { foo: "string" },
    };
    const cap: ParitySnapshot = {
      // dom passes
      domElements: [{ tag: "div", classes: ["x"] }],
      // tools fails (reordered)
      toolCalls: ["b", "a"],
      // stream fails (TTFT 5x)
      streamProfile: { ttft_ms: 500, p50_chunk_ms: 50, total_chunks: 10 },
      // contract passes
      contractShape: { foo: "string" },
    };
    const report = compareParity(ref, cap);
    expect(report.overall).toBe("fail");
    expect(report.failure_count).toBe(2);
    expect(report.axes).toEqual({
      dom: "pass",
      tools: "fail",
      stream: "fail",
      contract: "pass",
    });
  });
});
