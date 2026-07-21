#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { runFrontendPerformanceSuite } from "../probes/frontend-performance.js";

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Build the CI-only cold-navigation performance command. */
export function createProgram(): Command {
  const program = new Command();
  program
    .name("frontend-performance")
    .description("Measure the Angular Showcase shell readiness budget")
    .requiredOption("--base-url <url>")
    .requiredOption("--output <file>")
    .action(async (options: { baseUrl: string; output: string }) => {
      const artifact = await runFrontendPerformanceSuite({
        baseUrl: options.baseUrl,
        commitSha: process.env.GITHUB_SHA ?? "local",
      });
      await writeJson(options.output, artifact);
      console.log(
        `Measured ${artifact.summary.sampleCount} cold navigations; p95 ${artifact.summary.p95ReadinessMs.toFixed(1)} ms (budget ${artifact.summary.budgetMs} ms).`,
      );
      if (artifact.summary.status === "failed") process.exitCode = 1;
    });
  return program;
}

export async function main(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
