import { describe, expect, it } from "vitest";
import {
  buildResultArtifactName,
  mergeBuildResultFiles,
  parseBuildOutputs,
  shouldRedeployStaging,
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

  it("rejects an empty service string", () => {
    const bad = JSON.stringify([{ service: "", status: "success" }]);
    expect(() => parseBuildOutputs(bad)).toThrow(/service/i);
  });

  it("rejects a whitespace-only service string", () => {
    const bad = JSON.stringify([{ service: "   ", status: "success" }]);
    expect(() => parseBuildOutputs(bad)).toThrow(/service/i);
  });

  it("error message for parseBuildOutputs includes the entry index", () => {
    const bad = JSON.stringify([
      { service: "ok", status: "success" },
      { service: "x", status: "weird" },
    ]);
    expect(() => parseBuildOutputs(bad)).toThrow(/\[1\]/);
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

  it("rejects whitespace-only service names", () => {
    expect(() => buildResultArtifactName("   ")).toThrow(/service/i);
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

  it("rejects an empty service in a slot payload", () => {
    expect(() =>
      mergeBuildResultFiles(['{"service":"","status":"success"}']),
    ).toThrow(/service/i);
  });

  it("rejects a whitespace-only service in a slot payload", () => {
    expect(() =>
      mergeBuildResultFiles(['{"service":"   ","status":"success"}']),
    ).toThrow(/service/i);
  });

  it("throws when duplicate service names appear across slot payloads", () => {
    const slotPayloads = [
      '{"service":"dup","status":"failure"}',
      '{"service":"other","status":"success"}',
      '{"service":"dup","status":"success"}',
    ];
    expect(() => mergeBuildResultFiles(slotPayloads)).toThrow(/duplicate/i);
    expect(() => mergeBuildResultFiles(slotPayloads)).toThrow(/dup/);
  });

  it("normalizes trailing whitespace in service to its trimmed canonical form", () => {
    const result = mergeBuildResultFiles([
      '{"service":"foo ","status":"success"}',
    ]);
    expect(result).toEqual([{ service: "foo", status: "success" }]);
  });

  it("normalizes leading whitespace in service to its trimmed canonical form", () => {
    const result = mergeBuildResultFiles([
      '{"service":" foo","status":"success"}',
    ]);
    expect(result).toEqual([{ service: "foo", status: "success" }]);
  });

  it("parseBuildOutputs also returns the trimmed canonical service", () => {
    const json = JSON.stringify([{ service: "  bar  ", status: "success" }]);
    expect(parseBuildOutputs(json)).toEqual([
      { service: "bar", status: "success" },
    ]);
  });

  it("detects duplicates that differ only by surrounding whitespace", () => {
    const slotPayloads = [
      '{"service":"foo","status":"failure"}',
      '{"service":"foo ","status":"success"}',
    ];
    expect(() => mergeBuildResultFiles(slotPayloads)).toThrow(/duplicate/i);
    expect(() => mergeBuildResultFiles(slotPayloads)).toThrow(/foo/);
  });

  it("rejects an array payload with a clear 'expected object' error (not 'missing service')", () => {
    expect(() => mergeBuildResultFiles(["[]"])).toThrow(/expected object/i);
    expect(() => mergeBuildResultFiles(["[]"])).not.toThrow(/missing/i);
  });

  it("parseBuildOutputs rejects an array nested as an entry with 'expected object'", () => {
    const bad = JSON.stringify([[]]);
    expect(() => parseBuildOutputs(bad)).toThrow(/expected object/i);
  });
});

describe("shouldRedeployStaging", () => {
  it("returns true when at least one service succeeded", () => {
    expect(
      shouldRedeployStaging([
        { service: "a", status: "success" },
        { service: "b", status: "failure" },
      ]),
    ).toBe(true);
  });

  it("returns false when every service failed or was skipped", () => {
    expect(
      shouldRedeployStaging([
        { service: "a", status: "failure" },
        { service: "b", status: "skipped" },
      ]),
    ).toBe(false);
  });

  it("returns false on empty input", () => {
    expect(shouldRedeployStaging([])).toBe(false);
  });
});
