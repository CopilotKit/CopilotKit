import { describe, expect, it } from "vitest";
import {
  buildResultArtifactName,
  mergeBuildResultFiles,
  parseBuildOutputs,
  successSet,
} from "../build-outputs";
import type { BuildOutcome, ServiceBuildResult } from "../build-outputs";

const sample: ServiceBuildResult[] = [
  { service: "showcase-mastra", status: "success" },
  { service: "showcase-ag2", status: "failure" },
  { service: "shell-docs", status: "skipped" },
  { service: "showcase-aimock", status: "success" },
];

describe("build-outputs", () => {
  it("parses a JSON array of {service,status} entries", () => {
    const json = JSON.stringify(sample);
    expect(parseBuildOutputs(json)).toEqual(sample);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseBuildOutputs("not json")).toThrow(/parse/i);
  });

  it("throws on entries missing fields", () => {
    expect(() => parseBuildOutputs(JSON.stringify([{ service: "x" }]))).toThrow(
      /status/i,
    );
  });

  it("throws on an unknown status value", () => {
    const bad = JSON.stringify([{ service: "x", status: "weird" }]);
    expect(() => parseBuildOutputs(bad)).toThrow(/status/i);
  });

  it("successSet returns only services with status === 'success'", () => {
    expect(successSet(sample).sort()).toEqual(
      ["showcase-aimock", "showcase-mastra"].sort(),
    );
  });

  it("successSet returns empty when no services succeeded", () => {
    const allFailed: ServiceBuildResult[] = [
      { service: "a", status: "failure" },
      { service: "b", status: "failure" },
    ];
    expect(successSet(allFailed)).toEqual([]);
  });

  it("type BuildOutcome enumerates success|failure|skipped", () => {
    const outcomes: BuildOutcome[] = ["success", "failure", "skipped"];
    expect(outcomes).toHaveLength(3);
  });
});

describe("buildResultArtifactName", () => {
  it("returns the canonical per-slot artifact name", () => {
    expect(buildResultArtifactName("showcase-aimock")).toBe(
      "build-result-showcase-aimock",
    );
  });

  it("rejects empty service names (would collide with aggregate artifact)", () => {
    expect(() => buildResultArtifactName("")).toThrow(/service/i);
  });
});

describe("mergeBuildResultFiles", () => {
  it("merges per-slot {service,status} JSON payloads into a single array", () => {
    const slotPayloads = [
      '{"service":"showcase-mastra","status":"success"}',
      '{"service":"showcase-ag2","status":"failure"}',
      '{"service":"showcase-aimock","status":"success"}',
    ];
    expect(mergeBuildResultFiles(slotPayloads)).toEqual([
      { service: "showcase-mastra", status: "success" },
      { service: "showcase-ag2", status: "failure" },
      { service: "showcase-aimock", status: "success" },
    ]);
  });

  it("throws when a slot payload is missing service or status", () => {
    expect(() => mergeBuildResultFiles(['{"service":"x"}'])).toThrow(/status/i);
  });

  it("throws on an invalid status value", () => {
    expect(() =>
      mergeBuildResultFiles(['{"service":"x","status":"weird"}']),
    ).toThrow(/status/i);
  });

  it("returns an empty array when no slot payloads are provided", () => {
    expect(mergeBuildResultFiles([])).toEqual([]);
  });
});
