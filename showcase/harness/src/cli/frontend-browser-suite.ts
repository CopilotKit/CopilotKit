#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import {
  browserProjectById,
  runFrontendBrowserSuite,
} from "../probes/frontend-browser-suite.js";

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Build the CI-only browser suite command. */
export function createProgram(): Command {
  const program = new Command();
  program
    .name("frontend-browser-suite")
    .description(
      "Run reusable Angular UI, accessibility, responsive, and security checks",
    )
    .requiredOption("--project <id>")
    .requiredOption("--base-url <url>")
    .requiredOption("--output <file>")
    .action(
      async (options: { project: string; baseUrl: string; output: string }) => {
        const artifact = await runFrontendBrowserSuite({
          project: browserProjectById(options.project),
          baseUrl: options.baseUrl,
          commitSha: process.env.GITHUB_SHA ?? "local",
        });
        await writeJson(options.output, artifact);
        console.log(
          `Verified ${artifact.summary.total} states in ${artifact.project.id}; ${artifact.summary.failed} failed.`,
        );
        if (artifact.summary.failed > 0) process.exitCode = 1;
      },
    );
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
