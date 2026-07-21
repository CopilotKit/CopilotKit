#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command, InvalidArgumentError } from "commander";
import { chromium } from "playwright";
import type { Browser } from "playwright";

import {
  aggregateFrontendMatrixArtifacts,
  backendUrlsFromRegistry,
  selectFrontendMatrixShard,
} from "../probes/frontend-matrix-ci.js";
import {
  createFrontendCellExecutor,
  createPlaywrightProbeExecutor,
} from "../probes/frontend-matrix-playwright.js";
import { buildFrontendMatrix } from "../probes/frontend-matrix.js";
import type { FrontendMatrixCell } from "../probes/frontend-matrix.js";
import {
  buildMeasuredShardPlan,
  createFrontendMatrixArtifact,
  executeFrontendMatrixShard,
} from "../probes/frontend-matrix-runner.js";
import type {
  FrontendMatrixArtifact,
  MeasuredShardPlan,
} from "../probes/frontend-matrix-runner.js";
import {
  __clearD5RegistryForTesting,
  D5_REGISTRY,
} from "../probes/helpers/d5-registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = path.resolve(here, "../..");
const SHOWCASE_DIR = path.resolve(HARNESS_DIR, "..");
const DEFAULT_CATALOG = path.join(
  SHOWCASE_DIR,
  "shell/src/data/frontend-catalog.json",
);
const DEFAULT_REGISTRY = path.join(
  SHOWCASE_DIR,
  "shell/src/data/registry.json",
);
const DEFAULT_TIMINGS = path.join(
  HARNESS_DIR,
  "config/frontend-matrix-timings.json",
);
const D5_SCRIPT_FILE_MATCHER = /^d5-(?!.*\.test\.)(?!.*\.d\.).*\.(js|ts)$/;
const P95_WALL_TIME_LIMIT_MS = 30 * 60 * 1000;

interface TimingInput {
  schemaVersion: 1;
  cellDurationsMs: Record<string, number>;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

function nonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return parsed;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readTimings(file: string): Promise<TimingInput> {
  try {
    const timings = await readJson<TimingInput>(file);
    if (timings.schemaVersion !== 1) {
      throw new Error(`unsupported timing schema in ${file}`);
    }
    return timings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, cellDurationsMs: {} };
    }
    throw error;
  }
}

async function loadMatrix(catalogFile: string): Promise<FrontendMatrixCell[]> {
  return buildFrontendMatrix(await readJson(catalogFile));
}

async function loadD5Scripts(): Promise<void> {
  const scriptsDir = path.join(HARNESS_DIR, "src/probes/scripts");
  const names = (await fs.readdir(scriptsDir))
    .filter((name) => D5_SCRIPT_FILE_MATCHER.test(name))
    .sort();
  if (names.length === 0)
    throw new Error(`no D5 scripts found in ${scriptsDir}`);
  __clearD5RegistryForTesting();
  for (const name of names) {
    await import(pathToFileURL(path.join(scriptsDir, name)).href);
  }
}

async function launchChromiumWithInfrastructureRetry(): Promise<Browser> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (error) {
      lastError = error;
      if (attempt === 1) {
        console.warn(
          "Chromium infrastructure setup failed; retrying browser launch once",
        );
      }
    }
  }
  throw lastError;
}

async function findArtifactFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.name.endsWith(".json")) found.push(target);
    }
  };
  await walk(directory);
  return found.sort();
}

function createProgram(): Command {
  const program = new Command();
  program
    .name("frontend-matrix-ci")
    .description(
      "Plan, execute, and verify the complete Showcase frontend matrix",
    );

  program
    .command("plan")
    .requiredOption("--output <file>")
    .option("--catalog <file>", "generated frontend catalog", DEFAULT_CATALOG)
    .option("--timings <file>", "recorded CI timings", DEFAULT_TIMINGS)
    .option(
      "--target-ms <n>",
      "target serial work per shard",
      positiveInteger,
      1_500_000,
    )
    .option("--min-shards <n>", "minimum shard count", positiveInteger, 8)
    .option("--max-shards <n>", "maximum shard count", positiveInteger, 32)
    .option(
      "--default-probe-ms <n>",
      "estimate for unmeasured probes",
      positiveInteger,
      12_000,
    )
    .action(async (options) => {
      const matrix = await loadMatrix(options.catalog);
      const timings = await readTimings(options.timings);
      const plan = buildMeasuredShardPlan(matrix, {
        targetDurationMs: options.targetMs,
        minimumShardCount: options.minShards,
        maximumShardCount: options.maxShards,
        defaultProbeDurationMs: options.defaultProbeMs,
        measuredCellDurationsMs: timings.cellDurationsMs,
      });
      await writeJson(options.output, plan);
      console.log(
        `Planned ${matrix.length} cells across ${plan.shards.length} shards (${plan.measuredCellCount} measured, ${plan.defaultedCellCount} estimated).`,
      );
    });

  program
    .command("run")
    .requiredOption("--plan <file>")
    .requiredOption("--shard-index <n>", "zero-based shard", nonNegativeInteger)
    .requiredOption("--angular-base-url <url>")
    .requiredOption("--output <file>")
    .option("--catalog <file>", "generated frontend catalog", DEFAULT_CATALOG)
    .option("--registry <file>", "generated registry", DEFAULT_REGISTRY)
    .option("--concurrency <n>", "parallel isolated cells", positiveInteger, 4)
    .action(async (options) => {
      const shardIndex = Number(options.shardIndex);
      const matrix = await loadMatrix(options.catalog);
      const plan = await readJson<MeasuredShardPlan>(options.plan);
      const cells = selectFrontendMatrixShard(matrix, plan, shardIndex);
      const registry = await readJson<
        Parameters<typeof backendUrlsFromRegistry>[0]
      >(options.registry);
      const backendUrls = backendUrlsFromRegistry(registry);
      await loadD5Scripts();
      const browser = await launchChromiumWithInfrastructureRetry();
      const startedAt = new Date().toISOString();
      const invocationId = [
        process.env.GITHUB_RUN_ID ?? "local",
        process.env.GITHUB_RUN_ATTEMPT ?? "1",
        String(shardIndex),
      ].join("-");
      try {
        const execute = createFrontendCellExecutor({
          angularBaseUrl: options.angularBaseUrl,
          backendUrls,
          invocationId,
          runProbe: createPlaywrightProbeExecutor({
            browser,
            scripts: D5_REGISTRY,
          }),
        });
        const results = await executeFrontendMatrixShard(cells, {
          concurrency: options.concurrency,
          execute,
          onResult: (result) => {
            console.log(
              `[${result.status}] ${result.cell.id} (${result.durationMs} ms)`,
            );
          },
        });
        const artifact = createFrontendMatrixArtifact({
          commitSha: process.env.GITHUB_SHA ?? "local",
          shardIndex,
          shardCount: plan.shards.length,
          startedAt,
          finishedAt: new Date().toISOString(),
          results,
        });
        await writeJson(options.output, artifact);
        if (artifact.summary.failed > 0) process.exitCode = 1;
      } finally {
        await browser.close();
      }
    });

  program
    .command("aggregate")
    .requiredOption("--artifacts <directory>")
    .requiredOption("--output <file>")
    .requiredOption("--timings-output <file>")
    .option("--catalog <file>", "generated frontend catalog", DEFAULT_CATALOG)
    .action(async (options) => {
      const matrix = await loadMatrix(options.catalog);
      const artifactFiles = await findArtifactFiles(options.artifacts);
      const artifacts = await Promise.all(
        artifactFiles.map((file) => readJson<FrontendMatrixArtifact>(file)),
      );
      const report = aggregateFrontendMatrixArtifacts(matrix, artifacts);
      await writeJson(options.output, report);
      await writeJson(options.timingsOutput, report.measurements);
      console.log(
        `Verified ${report.summary.total} exact cells; ${report.summary.failed} failed; shard p95 ${report.summary.p95ShardWallTimeMs} ms.`,
      );
      if (
        report.summary.failed > 0 ||
        report.summary.p95ShardWallTimeMs > P95_WALL_TIME_LIMIT_MS
      ) {
        process.exitCode = 1;
      }
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
