export const ANGULAR_PROOF_FEATURES = [
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
] as const;

export const ANGULAR_RUNTIME_READY_BUDGET_MS = 2_000;
export const ANGULAR_RUNTIME_READY_SAMPLE_COUNT = 10;

export interface RuntimeReadinessEvaluation {
  sampleCount: number;
  maximumMs: number;
  p95Ms: number;
  passed: boolean;
}

/** Check ten cold runtime-ready measurements against the fixed budget. */
export function evaluateRuntimeReadiness(
  measurementsMs: readonly number[],
): RuntimeReadinessEvaluation {
  if (measurementsMs.length !== ANGULAR_RUNTIME_READY_SAMPLE_COUNT) {
    throw new Error(
      `runtime readiness requires exactly ${ANGULAR_RUNTIME_READY_SAMPLE_COUNT} samples`,
    );
  }
  if (
    measurementsMs.some(
      (measurement) => !Number.isFinite(measurement) || measurement < 0,
    )
  ) {
    throw new Error(
      "runtime readiness samples must be finite non-negative numbers",
    );
  }
  const sorted = [...measurementsMs].sort((left, right) => left - right);
  const maximumMs = sorted.at(-1)!;
  const p95Index = Math.ceil(sorted.length * 0.95) - 1;
  return {
    sampleCount: sorted.length,
    maximumMs,
    p95Ms: sorted[p95Index]!,
    passed: maximumMs <= ANGULAR_RUNTIME_READY_BUDGET_MS,
  };
}
