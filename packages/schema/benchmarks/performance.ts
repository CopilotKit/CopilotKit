import { performance } from "node:perf_hooks";
import { type as arkType } from "arktype";
import * as v from "valibot";
import * as z from "zod/v4-mini";
import {
  array,
  boolean,
  lazy,
  literal,
  number,
  object,
  parse,
  safeParse,
  schema as defineSchema,
  string,
  transform,
  union,
} from "../src/index.js";
import type { Schema } from "../src/index.js";

interface Benchmark {
  readonly iterations: number;
  readonly library: string;
  readonly run: () => unknown;
  readonly scenario: string;
}

interface BenchmarkResult {
  readonly library: string;
  readonly "median ops/s": number;
  readonly scenario: string;
}

const input = {
  active: true,
  age: 37,
  name: "Ada",
  tags: ["math", "code", "logic"],
};

const schema = object({
  active: boolean(),
  age: number(),
  name: string(),
  tags: array(string()),
});

const arktypeSchema = arkType({
  active: "boolean",
  age: "number",
  name: "string",
  tags: "string[]",
}).onUndeclaredKey("delete");

const valibotSchema = v.object({
  active: v.boolean(),
  age: v.number(),
  name: v.string(),
  tags: v.array(v.string()),
});

const zodMiniSchema = z.object({
  active: z.boolean(),
  age: z.number(),
  name: z.string(),
  tags: z.array(z.string()),
});

const invalidInput = {
  active: "yes",
  age: "old",
  name: 42,
  tags: ["math", false],
};

const unionSchema = union([literal("ready"), number()]);
const arktypeUnion = arkType("'ready' | number");
const valibotUnion = v.union([v.literal("ready"), v.number()]);
const zodMiniUnion = z.union([z.literal("ready"), z.number()]);

const transformSchema = defineSchema(
  string(),
  transform((value: string) => value.length),
);
const arktypeTransform = arkType("string").pipe((value) => value.length);
const valibotTransform = v.pipe(
  v.string(),
  v.transform((value) => value.length),
);
const zodMiniTransform = z.pipe(
  z.string(),
  z.transform((value: string) => value.length),
);

interface TreeNode {
  readonly children: TreeNode[];
  readonly value: string;
}

const recursiveInput: TreeNode = {
  children: [
    {
      children: [{ children: [], value: "leaf" }],
      value: "branch",
    },
  ],
  value: "root",
};
const recursiveSchema: Schema<TreeNode> = lazy(() =>
  object({
    children: array(recursiveSchema),
    value: string(),
  }),
);
const arktypeRecursive = arkType.module({
  node: {
    children: "node[]",
    value: "string",
  },
}).node;
const valibotRecursive: v.GenericSchema<TreeNode> = v.lazy(() =>
  v.object({
    children: v.array(valibotRecursive),
    value: v.string(),
  }),
);
const zodMiniRecursive: z.ZodMiniType<TreeNode> = z.lazy(() =>
  z.object({
    children: z.array(zodMiniRecursive),
    value: z.string(),
  }),
);

const benchmarks: readonly Benchmark[] = [
  {
    iterations: 250_000,
    library: "@copilotkit/schema",
    run: () => parse(schema, input),
    scenario: "valid object",
  },
  {
    iterations: 250_000,
    library: "arktype",
    run: () => arktypeSchema(input),
    scenario: "valid object",
  },
  {
    iterations: 250_000,
    library: "valibot",
    run: () => v.parse(valibotSchema, input),
    scenario: "valid object",
  },
  {
    iterations: 250_000,
    library: "zod/mini",
    run: () => z.parse(zodMiniSchema, input),
    scenario: "valid object",
  },
  {
    iterations: 25_000,
    library: "@copilotkit/schema",
    run: () => safeParse(schema, invalidInput),
    scenario: "invalid object",
  },
  {
    iterations: 25_000,
    library: "arktype",
    run: () => arktypeSchema(invalidInput),
    scenario: "invalid object",
  },
  {
    iterations: 25_000,
    library: "valibot",
    run: () => v.safeParse(valibotSchema, invalidInput),
    scenario: "invalid object",
  },
  {
    iterations: 25_000,
    library: "zod/mini",
    run: () => z.safeParse(zodMiniSchema, invalidInput),
    scenario: "invalid object",
  },
  {
    iterations: 250_000,
    library: "@copilotkit/schema",
    run: () => parse(unionSchema, 42),
    scenario: "union",
  },
  {
    iterations: 250_000,
    library: "arktype",
    run: () => arktypeUnion(42),
    scenario: "union",
  },
  {
    iterations: 250_000,
    library: "valibot",
    run: () => v.parse(valibotUnion, 42),
    scenario: "union",
  },
  {
    iterations: 250_000,
    library: "zod/mini",
    run: () => z.parse(zodMiniUnion, 42),
    scenario: "union",
  },
  {
    iterations: 250_000,
    library: "@copilotkit/schema",
    run: () => parse(transformSchema, "Ada"),
    scenario: "transform",
  },
  {
    iterations: 250_000,
    library: "arktype",
    run: () => arktypeTransform("Ada"),
    scenario: "transform",
  },
  {
    iterations: 250_000,
    library: "valibot",
    run: () => v.parse(valibotTransform, "Ada"),
    scenario: "transform",
  },
  {
    iterations: 250_000,
    library: "zod/mini",
    run: () => z.parse(zodMiniTransform, "Ada"),
    scenario: "transform",
  },
  {
    iterations: 100_000,
    library: "@copilotkit/schema",
    run: () => object({ age: number(), name: string() }),
    scenario: "construction",
  },
  {
    iterations: 100_000,
    library: "arktype",
    run: () =>
      arkType({ age: "number", name: "string" }).onUndeclaredKey("delete"),
    scenario: "construction",
  },
  {
    iterations: 100_000,
    library: "valibot",
    run: () => v.object({ age: v.number(), name: v.string() }),
    scenario: "construction",
  },
  {
    iterations: 100_000,
    library: "zod/mini",
    run: () => z.object({ age: z.number(), name: z.string() }),
    scenario: "construction",
  },
  {
    iterations: 100_000,
    library: "@copilotkit/schema",
    run: () => parse(recursiveSchema, recursiveInput),
    scenario: "recursive object",
  },
  {
    iterations: 100_000,
    library: "arktype",
    run: () => arktypeRecursive(recursiveInput),
    scenario: "recursive object",
  },
  {
    iterations: 100_000,
    library: "valibot",
    run: () => v.parse(valibotRecursive, recursiveInput),
    scenario: "recursive object",
  },
  {
    iterations: 100_000,
    library: "zod/mini",
    run: () => z.parse(zodMiniRecursive, recursiveInput),
    scenario: "recursive object",
  },
];

/**
 * Run enough calls to let V8 optimize each validator before measurement.
 */
function warmUp(benchmark: Benchmark): void {
  for (
    let index = 0;
    index < Math.min(benchmark.iterations, 50_000);
    index += 1
  ) {
    benchmark.run();
  }
}

/**
 * Measure one benchmark and return operations per second.
 */
function measure(benchmark: Benchmark, iterations: number): number {
  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    benchmark.run();
  }
  const elapsedSeconds = (performance.now() - start) / 1_000;
  return iterations / elapsedSeconds;
}

/**
 * Return the median from an odd-sized set of measurements.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

for (const benchmark of benchmarks) {
  warmUp(benchmark);
}

const samples = new Map<string, number[]>(
  benchmarks.map(({ library, scenario }) => [`${scenario}:${library}`, []]),
);

for (let round = 0; round < 7; round += 1) {
  for (let offset = 0; offset < benchmarks.length; offset += 1) {
    const benchmark = benchmarks[(round + offset) % benchmarks.length];
    if (!benchmark) {
      throw new Error("Benchmark rotation selected no library");
    }
    samples
      .get(`${benchmark.scenario}:${benchmark.library}`)
      ?.push(measure(benchmark, benchmark.iterations));
  }
}

const results: BenchmarkResult[] = benchmarks.map(({ library, scenario }) => ({
  library,
  "median ops/s": Math.round(
    median(samples.get(`${scenario}:${library}`) ?? []),
  ),
  scenario,
}));

console.table(results);

/** Read one measured result or fail when the benchmark matrix is incomplete. */
function operationsPerSecond(scenario: string, library: string): number {
  const result = results.find(
    (candidate) =>
      candidate.scenario === scenario && candidate.library === library,
  );
  if (!result) {
    throw new Error(`Missing ${scenario} result for ${library}`);
  }
  return result["median ops/s"];
}

const construction = operationsPerSecond("construction", "@copilotkit/schema");
const comparisonLibraries = ["arktype", "valibot", "zod/mini"] as const;
const fastestConstruction = Math.max(
  ...comparisonLibraries.map((library) =>
    operationsPerSecond("construction", library),
  ),
);
if (construction < fastestConstruction * 1.2) {
  throw new Error(
    `Construction gate failed: ${construction} is less than 120% of ${fastestConstruction}`,
  );
}

for (const scenario of [
  "valid object",
  "invalid object",
  "union",
  "transform",
  "recursive object",
]) {
  const schemaOperations = operationsPerSecond(scenario, "@copilotkit/schema");
  const fastestComparison = Math.max(
    ...comparisonLibraries.map((library) =>
      operationsPerSecond(scenario, library),
    ),
  );
  if (schemaOperations <= fastestComparison) {
    throw new Error(
      `${scenario} gate failed: ${schemaOperations} does not beat ${fastestComparison}`,
    );
  }
}
