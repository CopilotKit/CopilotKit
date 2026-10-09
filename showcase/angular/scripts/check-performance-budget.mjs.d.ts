export interface AngularBuildOutput {
  entryPoint?: string;
  imports?: ReadonlyArray<{ path: string; kind: string }>;
  bytes?: number;
}

export interface PerformanceBaseline {
  initial: { rawBytes: number };
  maximumRelativeRegression: number;
  absoluteCapBytes: number;
}

export function initialOutputNames(
  outputs: Readonly<Record<string, AngularBuildOutput>>,
): string[];

export function evaluateRawBudget(
  actualBytes: number,
  baseline: PerformanceBaseline,
): {
  passes: boolean;
  relativeCap: number;
  effectiveCap: number;
};
