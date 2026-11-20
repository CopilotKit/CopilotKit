import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runSuite } from "./runner.mjs";

const { values } = parseArgs({
  options: {
    framework: { type: "string" },
    fixture: { type: "string" },
    baseline: { type: "string" },
    output: { type: "string" },
    rows: { type: "string", default: "1" },
  },
});
for (const name of ["framework", "fixture", "baseline", "output"]) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const rowIds = values.rows.split(",");
if (!rowIds.every((id) => /^[1-6]$/.test(id)))
  throw new Error("--rows must list row numbers 1–6");
const rows = [];
for (const id of rowIds) {
  // Missing sibling modules are an explicit error, never silently skipped.
  rows.push((await import(`./rows/row${id}.mjs`)).row);
}
const { createFixture } = await import(pathToFileURL(resolve(values.fixture)));
const report = await runSuite({
  framework: values.framework,
  outputDir: resolve(values.output),
  rows,
  createFixture,
  baseline: JSON.parse(await readFile(resolve(values.baseline), "utf8")),
});
console.log(`${report.status}: ${resolve(values.output, "result.json")}`);
if (report.status !== "passed") process.exitCode = 1;
