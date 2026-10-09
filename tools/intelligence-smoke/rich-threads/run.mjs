import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { runSuite } from "./runner.mjs";
import { runConfiguredSuite } from "./bootstrap.mjs";

const { values } = parseArgs({
  options: {
    framework: { type: "string" },
    fixture: { type: "string" },
    baseline: { type: "string" },
    output: { type: "string" },
    rows: { type: "string", default: "1" },
    config: { type: "string" },
  },
});
for (const name of ["framework", "output"]) {
  if (!values[name]) throw new Error(`--${name} is required`);
}
const rowIds = values.rows.split(",");
if (!rowIds.every((id) => /^[1-6]$/.test(id)))
  throw new Error("--rows must list row numbers 1–6");
if (values.config) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Suite interrupted"));
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const report = await runConfiguredSuite({
      config: JSON.parse(await readFile(resolve(values.config), "utf8")),
      frameworks: values.framework.split(","),
      rowIds,
      outputDir: resolve(values.output),
      signal: controller.signal,
    });
    console.log(`${report.status}: ${resolve(values.output, "suite.json")}`);
    if (report.status !== "passed") process.exitCode = 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
} else {
  if (!values.fixture || !values.baseline)
    throw new Error(
      "Use --config for the committed browser suite; supplemental fixtures require --fixture and --baseline",
    );
  const rows = [];
  for (const id of rowIds) {
    // Missing sibling modules are an explicit error, never silently skipped.
    rows.push((await import(`./rows/row${id}.mjs`)).row);
  }
  const { createFixture } = await import(
    pathToFileURL(resolve(values.fixture))
  );
  const report = await runSuite({
    framework: values.framework,
    outputDir: resolve(values.output),
    rows,
    createFixture,
    baseline: JSON.parse(await readFile(resolve(values.baseline), "utf8")),
  });
  console.log(`${report.status}: ${resolve(values.output, "result.json")}`);
  if (report.status !== "passed") process.exitCode = 1;
}
