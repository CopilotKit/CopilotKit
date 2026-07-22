import assert from "node:assert/strict";
import corpus from "../../intelligence/conformance/registry-adapters-v1.json" with { type: "json" };
import type { SkillRegistryTelemetryEvent } from "../src/registry-state.js";

export type CorpusCase = (typeof corpus.cases)[number];
type CorpusTelemetryRecord = CorpusCase["expected"]["telemetryRecords"][number];
type ObservedTelemetryMetadata = Readonly<
  Omit<SkillRegistryTelemetryEvent["metadata"], "framework"> & {
    readonly framework: "fixture";
  }
>;

export interface ConformanceOperation {
  readonly atMs: number;
  readonly kind: string;
  readonly [key: string]: unknown;
}

export interface ConformanceTransition {
  readonly atMs: number;
  readonly from: string;
  readonly to: string;
}

export interface ConformanceTelemetryRecord {
  readonly name: CorpusTelemetryRecord["name"];
  readonly atMs: number;
  readonly metadata:
    | CorpusTelemetryRecord["metadata"]
    | ObservedTelemetryMetadata;
}

export interface ConformanceObservation {
  readonly operations: readonly ConformanceOperation[];
  readonly calls: CorpusCase["expected"]["calls"];
  readonly statusTransitions: readonly ConformanceTransition[];
  readonly genericSdk: unknown;
  readonly readiness: unknown;
  readonly nativeHook: CorpusCase["expected"]["nativeHook"];
  readonly telemetryRecords: readonly ConformanceTelemetryRecord[];
  readonly renderedRecords: readonly unknown[];
}

export function assertConformanceObservation(
  case_: CorpusCase,
  actual: ConformanceObservation,
): void {
  assert.deepStrictEqual(actual.operations, case_.operations, "operations");
  assert.deepStrictEqual(actual.calls, case_.expected.calls, "calls");
  assert.deepStrictEqual(
    actual.statusTransitions,
    case_.expected.statusTransitions,
    "status transitions",
  );
  assert.deepStrictEqual(
    actual.genericSdk,
    case_.expected.genericSdk,
    "generic SDK result",
  );
  assert.deepStrictEqual(
    actual.readiness,
    case_.expected.readiness,
    "readiness",
  );
  assert.deepStrictEqual(
    actual.nativeHook,
    case_.expected.nativeHook,
    "native hook",
  );
  assert.deepStrictEqual(
    actual.telemetryRecords,
    case_.expected.telemetryRecords,
    "telemetry records",
  );
  assert.deepStrictEqual(
    actual.renderedRecords,
    case_.expected.renderedRecords,
    "rendered records",
  );
}
