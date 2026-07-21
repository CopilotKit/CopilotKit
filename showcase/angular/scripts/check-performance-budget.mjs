import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = join(scriptDirectory, "..");

/** Return the static initial graph emitted by the Angular esbuild application builder. */
export function initialOutputNames(outputs) {
  const roots = Object.entries(outputs)
    .filter(
      ([, output]) =>
        output.entryPoint === "src/main.ts" ||
        output.entryPoint === "angular:styles/global:styles",
    )
    .map(([name]) => name);
  if (roots.length !== 2) {
    throw new Error(
      `Expected two initial entry points, found ${roots.length}.`,
    );
  }

  const visited = new Set();
  const visit = (name) => {
    const output = outputs[name];
    if (visited.has(name) || output === undefined) return;
    visited.add(name);
    for (const dependency of output.imports ?? []) {
      if (dependency.kind !== "dynamic-import") visit(dependency.path);
    }
  };
  for (const root of roots) visit(root);
  return [...visited].sort();
}

/** Enforce both the recorded relative threshold and the independently fixed cap. */
export function evaluateRawBudget(actualBytes, baseline) {
  const relativeCap = Math.floor(
    baseline.initial.rawBytes * (1 + baseline.maximumRelativeRegression),
  );
  const effectiveCap = Math.min(relativeCap, baseline.absoluteCapBytes);
  return { passes: actualBytes <= effectiveCap, relativeCap, effectiveCap };
}

function run() {
  const baseline = JSON.parse(
    readFileSync(join(projectDirectory, "performance-baseline.json"), "utf8"),
  );
  const outputDirectory = join(
    projectDirectory,
    "dist/showcase-angular/browser",
  );
  const stats = JSON.parse(
    readFileSync(
      join(projectDirectory, "dist/showcase-angular/stats.json"),
      "utf8",
    ),
  );
  const files = initialOutputNames(stats.outputs);
  const sizes = files.reduce(
    (total, name) => {
      const contents = readFileSync(join(outputDirectory, name));
      return {
        rawBytes: total.rawBytes + stats.outputs[name].bytes,
        gzipBytes: total.gzipBytes + gzipSync(contents, { level: 9 }).length,
        brotliBytes: total.brotliBytes + brotliCompressSync(contents).length,
      };
    },
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
  const result = evaluateRawBudget(sizes.rawBytes, baseline);
  console.log(
    JSON.stringify({
      event: "angular_showcase_bundle_budget",
      baseCommit: baseline.baseCommit,
      files,
      ...sizes,
      relativeCapBytes: result.relativeCap,
      absoluteCapBytes: baseline.absoluteCapBytes,
      effectiveCapBytes: result.effectiveCap,
      passes: result.passes,
    }),
  );
  if (!result.passes) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
