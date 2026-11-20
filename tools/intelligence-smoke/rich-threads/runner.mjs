import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  frameworks,
  validateBaseline,
  aggregate,
  artifactWriter,
  requireText,
} from "./contract.mjs";

/** Each invocation owns a new output directory and one fixture's resources. */
export async function runSuite({
  framework,
  outputDir,
  baseline,
  rows,
  createFixture,
}) {
  assert.ok(frameworks.includes(framework), `Unknown framework: ${framework}`);
  validateBaseline(baseline);
  assert.ok(
    rows.length && new Set(rows.map((row) => row.id)).size === rows.length,
    "Rows must be nonempty and unique",
  );
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const write = artifactWriter(outputDir);
  await write("baseline.json", baseline);
  const report = {
    framework,
    baseline,
    startedAt: new Date().toISOString(),
    status: "blocked",
    rows: [],
    cleanup: "not-run",
  };
  let instance;
  try {
    instance = await createFixture({ framework, outputDir, baseline });
    assert.equal(
      typeof instance.cleanup,
      "function",
      "Fixture must expose owned cleanup",
    );
    for (const row of rows) {
      assert.ok(
        Number.isInteger(row.id) && row.id >= 1 && row.id <= 6,
        "Invalid row ID",
      );
      requireText(row.title, "Row title");
      const directory = join(outputDir, `row${row.id}`);
      await mkdir(directory, { mode: 0o700 });
      const writeArtifact = artifactWriter(directory);
      let result;
      try {
        result = await row.run({
          framework,
          baseline,
          outputDir: directory,
          fixture: instance.fixture,
          services: instance.services,
          writeArtifact,
        });
        // Derive verdict from checks; an adapter cannot report green while omitting checks.
        const status = aggregate(result.checks);
        assert.equal(result.status, status, "Row verdict contradicts checks");
      } catch (error) {
        result = {
          status: "failed",
          checks: [
            {
              name: "execution",
              status: "failed",
              evidence: [],
              detail: String(error),
            },
          ],
          limitations: [],
        };
      }
      await writeArtifact("result.json", result);
      report.rows.push({ id: row.id, title: row.title, ...result });
    }
    report.status = aggregate(report.rows);
  } catch (error) {
    report.error = String(error);
    report.status = "blocked";
  } finally {
    if (instance) {
      try {
        await instance.cleanup();
        report.cleanup = "passed";
      } catch (error) {
        report.cleanup = "failed";
        report.cleanupError = String(error);
        report.status = "failed";
      }
    }
    report.finishedAt = new Date().toISOString();
    await write("result.json", report);
  }
  return report;
}
