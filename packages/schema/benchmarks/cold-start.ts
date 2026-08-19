import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type as arkType } from "arktype";
import * as v from "valibot";
import * as z from "zod/v4-mini";
import { number, object, parse, string } from "../src/index.js";

interface Result {
  readonly library: string;
  readonly measurement: number;
}

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const collectGarbage = (
  globalThis as typeof globalThis & { readonly gc?: () => void }
).gc;
let retainedSchemas: readonly unknown[] = [];

/** Return the median from an odd-sized set of measurements. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Measure repeated construction followed by each schema's first parse. */
function measureColdOperations(
  operation: () => unknown,
  iterations = 100_000,
): number {
  for (let index = 0; index < Math.min(iterations, 10_000); index += 1) {
    operation();
  }
  const samples: number[] = [];
  for (let round = 0; round < 7; round += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      operation();
    }
    samples.push(iterations / ((performance.now() - start) / 1_000));
  }
  return median(samples);
}

/** Measure retained heap bytes for independently constructed schemas. */
function measureRetainedBytes(factory: () => unknown): number {
  if (!collectGarbage) {
    throw new Error("Run this benchmark with --expose-gc");
  }
  factory();
  const samples: number[] = [];
  for (let round = 0; round < 5; round += 1) {
    collectGarbage();
    const before = process.memoryUsage().heapUsed;
    retainedSchemas = Array.from({ length: 25_000 }, factory);
    collectGarbage();
    const after = process.memoryUsage().heapUsed;
    samples.push((after - before) / retainedSchemas.length);
    retainedSchemas = [];
  }
  collectGarbage();
  return median(samples);
}

/** Measure one dynamic import inside a fresh Node.js process. */
function measureImport(moduleSpecifier: string): number {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const start = performance.now(); await import(${JSON.stringify(
        moduleSpecifier,
      )}); console.log(performance.now() - start);`,
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "Import benchmark failed");
  }
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration)) {
    throw new Error(`Invalid import duration: ${result.stdout}`);
  }
  return duration;
}

/** Measure a module import across fresh processes. */
function measureMedianImport(moduleSpecifier: string): number {
  return median(
    Array.from({ length: 7 }, () => measureImport(moduleSpecifier)),
  );
}

const coldOperations: Result[] = [
  {
    library: "@copilotkit/schema",
    measurement: measureColdOperations(() =>
      parse(object({ age: number(), name: string() }), {
        age: 37,
        name: "Ada",
      }),
    ),
  },
  {
    library: "arktype",
    measurement: measureColdOperations(
      () =>
        arkType({ age: "number", name: "string" })
          .onUndeclaredKey("delete")
          .assert({
            age: 37,
            name: "Ada",
          }),
      2_000,
    ),
  },
  {
    library: "valibot",
    measurement: measureColdOperations(() =>
      v.parse(v.object({ age: v.number(), name: v.string() }), {
        age: 37,
        name: "Ada",
      }),
    ),
  },
  {
    library: "zod/mini",
    measurement: measureColdOperations(() =>
      z.parse(z.object({ age: z.number(), name: z.string() }), {
        age: 37,
        name: "Ada",
      }),
    ),
  },
];

const retainedBytes: Result[] = [
  {
    library: "@copilotkit/schema",
    measurement: measureRetainedBytes(() =>
      object({ age: number(), name: string() }),
    ),
  },
  {
    library: "arktype",
    measurement: measureRetainedBytes(() =>
      arkType({ age: "number", name: "string" }).onUndeclaredKey("delete"),
    ),
  },
  {
    library: "valibot",
    measurement: measureRetainedBytes(() =>
      v.object({ age: v.number(), name: v.string() }),
    ),
  },
  {
    library: "zod/mini",
    measurement: measureRetainedBytes(() =>
      z.object({ age: z.number(), name: z.string() }),
    ),
  },
];

const importMilliseconds: Result[] = [
  {
    library: "@copilotkit/schema",
    measurement: measureMedianImport(
      pathToFileURL(`${packageRoot}/dist/index.mjs`).href,
    ),
  },
  {
    library: "arktype",
    measurement: measureMedianImport("arktype"),
  },
  {
    library: "valibot",
    measurement: measureMedianImport("valibot"),
  },
  {
    library: "zod/mini",
    measurement: measureMedianImport("zod/mini"),
  },
];

console.log("cold construction + first parse ops/s");
console.table(coldOperations);
console.log("retained bytes/schema");
console.table(retainedBytes);
console.log("fresh-process import milliseconds");
console.table(importMilliseconds);

for (const [name, results, lowerIsBetter] of [
  ["cold construction + first parse", coldOperations, false],
  ["retained bytes/schema", retainedBytes, true],
  ["fresh-process import", importMilliseconds, true],
] as const) {
  const schemaResult = results[0]?.measurement ?? Number.NaN;
  const comparisons = results.slice(1).map(({ measurement }) => measurement);
  const bestComparison = lowerIsBetter
    ? Math.min(...comparisons)
    : Math.max(...comparisons);
  const passes = lowerIsBetter
    ? schemaResult <= bestComparison
    : schemaResult >= bestComparison;
  if (!passes) {
    throw new Error(
      `${name} gate failed: ${schemaResult} versus ${bestComparison}`,
    );
  }
}
