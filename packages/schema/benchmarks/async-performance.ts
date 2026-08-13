import { performance } from "node:perf_hooks";
import { type as arkType } from "arktype";
import * as v from "valibot";
import * as z from "zod/v4-mini";
import {
  parseAsync,
  schemaAsync,
  string,
  transformAsync,
} from "../src/index.js";

interface Benchmark {
  readonly library: string;
  readonly run: () => Promise<unknown>;
}

const schema = schemaAsync(
  string(),
  transformAsync(async (value: string) => value.length),
);
const arktypeSchema = arkType("string").pipe(async (value) => value.length);
const valibotSchema = v.pipeAsync(
  v.string(),
  v.transformAsync(async (value) => value.length),
);
const zodMiniSchema = z.pipe(
  z.string(),
  z.transform(async (value: string) => value.length),
);

const benchmarks: readonly Benchmark[] = [
  {
    library: "@copilotkit/schema",
    run: () => parseAsync(schema, "Ada"),
  },
  {
    library: "arktype",
    run: () => arktypeSchema.assert("Ada"),
  },
  {
    library: "valibot",
    run: () => v.parseAsync(valibotSchema, "Ada"),
  },
  {
    library: "zod/mini",
    run: () => z.parseAsync(zodMiniSchema, "Ada"),
  },
];

/** Return the median from an odd-sized set of measurements. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Measure sequential async parses in operations per second. */
async function measure(
  benchmark: Benchmark,
  iterations: number,
): Promise<number> {
  const run = benchmark.run;
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await run();
  }
  return iterations / ((performance.now() - start) / 1_000);
}

for (const benchmark of benchmarks) {
  await measure(benchmark, 5_000);
}

const samples = new Map<string, number[]>(
  benchmarks.map(({ library }) => [library, []]),
);
for (let round = 0; round < 7; round += 1) {
  for (let offset = 0; offset < benchmarks.length; offset += 1) {
    const benchmark = benchmarks[(round + offset) % benchmarks.length];
    if (!benchmark) {
      throw new Error("Benchmark rotation selected no library");
    }
    samples.get(benchmark.library)?.push(await measure(benchmark, 500_000));
  }
}

const results = benchmarks.map(({ library }) => ({
  library,
  measurement: median(samples.get(library) ?? []),
}));
console.table(
  results.map(({ library, measurement }) => ({
    library,
    "median async ops/s": Math.round(measurement),
  })),
);

const schemaResult = results[0]?.measurement ?? Number.NaN;
const bestComparison = Math.max(
  ...results.slice(1).map(({ measurement }) => measurement),
);
if (schemaResult < bestComparison * 0.95) {
  throw new Error(
    `async parse parity gate failed: ${schemaResult} is below 95% of ${bestComparison}`,
  );
}
