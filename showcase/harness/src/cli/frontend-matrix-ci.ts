#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Command, InvalidArgumentError } from "commander";
import { chromium } from "playwright";
import type { Browser } from "playwright";

import {
  aggregateFrontendMatrixArtifacts,
  selectFrontendMatrixShard,
} from "../probes/frontend-matrix-ci.js";
import type { FrontendMatrixAggregateReport } from "../probes/frontend-matrix-ci.js";
import {
  evaluateCurrentFrontendParity,
  evaluateFrontendParity,
  frontendParityCellsFromAggregate,
} from "../probes/frontend-parity-gate.js";
import type { AcceptedBaselineFailure } from "../probes/frontend-parity-gate.js";
import {
  createFrontendCellExecutor,
  createPlaywrightProbeExecutor,
} from "../probes/frontend-matrix-playwright.js";
import { buildFrontendMatrix } from "../probes/frontend-matrix.js";
import type {
  FrontendMatrixCell,
  RunnableFrontend,
} from "../probes/frontend-matrix.js";
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

interface FrontendBaselinePolicy {
  schemaVersion: 1;
  frozenBaseCommit: string;
  acceptedFailures: AcceptedBaselineFailure[];
}

/** Limit parity inputs and policy entries to one independently run CI scope. */
export function scopeByIntegrationAndFeature<
  Item extends { integration: string; feature: string },
>(
  items: readonly Item[],
  options: { integration?: string; features?: readonly string[] },
): Item[] {
  const features = new Set(options.features ?? []);
  return items.filter(
    (item) =>
      (options.integration === undefined ||
        item.integration === options.integration) &&
      (features.size === 0 || features.has(item.feature)),
  );
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

function frontend(value: string): RunnableFrontend {
  if (value !== "react" && value !== "angular") {
    throw new InvalidArgumentError('must be "react" or "angular"');
  }
  return value;
}

function commaSeparatedValues(value: string): string[] {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new InvalidArgumentError("must contain at least one value");
  }
  return values;
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

async function loadMatrix(
  catalogFile: string,
  options: {
    frontend?: RunnableFrontend;
    integration?: string;
    features?: string[];
  } = {},
): Promise<FrontendMatrixCell[]> {
  return buildFrontendMatrix(await readJson(catalogFile), {
    frontends: options.frontend ? [options.frontend] : undefined,
    integrations: options.integration ? [options.integration] : undefined,
    features: options.features,
  });
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
    .option("--frontend <id>", "limit the plan to one frontend", frontend)
    .option("--integration <slug>", "limit the plan to one integration")
    .option(
      "--features <slugs>",
      "limit the plan to comma-separated feature slugs",
      commaSeparatedValues,
    )
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
      const matrix = await loadMatrix(options.catalog, options);
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
    .requiredOption("--integration <slug>")
    .requiredOption(
      "--integration-base-url <url>",
      "branch-local origin that serves both /demos/* and /angular/*",
    )
    .requiredOption("--source-commit <revision>")
    .requiredOption("--container-image-revision <revision>")
    .requiredOption("--fixture-revision <revision>")
    .requiredOption("--feature-contract-revision <revision>")
    .requiredOption("--output <file>")
    .option("--catalog <file>", "generated frontend catalog", DEFAULT_CATALOG)
    .option("--frontend <id>", "limit execution to one frontend", frontend)
    .option(
      "--features <slugs>",
      "limit execution to comma-separated feature slugs",
      commaSeparatedValues,
    )
    .option("--concurrency <n>", "parallel isolated cells", positiveInteger, 4)
    .action(async (options) => {
      const shardIndex = Number(options.shardIndex);
      const matrix = await loadMatrix(options.catalog, options);
      const plan = await readJson<MeasuredShardPlan>(options.plan);
      const cells = selectFrontendMatrixShard(matrix, plan, shardIndex);
      const integrationBaseUrl = new URL(
        options.integrationBaseUrl,
      ).href.replace(/\/$/, "");
      const backendUrls = { [options.integration]: integrationBaseUrl };
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
          angularBaseUrl: integrationBaseUrl,
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
          sourceCommit: options.sourceCommit,
          containerImageRevision: options.containerImageRevision,
          fixtureRevision: options.fixtureRevision,
          featureContractRevision: options.featureContractRevision,
          shardIndex,
          shardCount: plan.shards.length,
          startedAt,
          finishedAt: new Date().toISOString(),
          results,
        });
        await writeJson(options.output, artifact);
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
    .option("--frontend <id>", "limit aggregation to one frontend", frontend)
    .option("--integration <slug>", "limit aggregation to one integration")
    .option(
      "--features <slugs>",
      "limit aggregation to comma-separated feature slugs",
      commaSeparatedValues,
    )
    .action(async (options) => {
      const matrix = await loadMatrix(options.catalog, options);
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
      if (report.summary.p95ShardWallTimeMs > P95_WALL_TIME_LIMIT_MS) {
        process.exitCode = 1;
      }
    });

  program
    .command("pair")
    .description("Compare React and Angular at one exact source revision")
    .requiredOption("--pull-request <file>", "verified aggregate report")
    .requiredOption("--output <file>")
    .option("--integration <slug>", "limit comparison to one integration")
    .option(
      "--features <slugs>",
      "limit comparison to comma-separated feature slugs",
      commaSeparatedValues,
    )
    .action(async (options) => {
      const pullRequest = await readJson<FrontendMatrixAggregateReport>(
        options.pullRequest,
      );
      const cells = scopeByIntegrationAndFeature(
        frontendParityCellsFromAggregate(pullRequest),
        {
          integration: options.integration,
          features: options.features,
        },
      );
      const report = evaluateCurrentFrontendParity({
        sourceCommit: pullRequest.sourceCommit,
        cells,
      });
      await writeJson(options.output, report);
      console.log(
        `Classified ${report.comparisons.length} current-revision frontend pairs; ${report.passed ? "no Angular regressions" : "blocking Angular regressions found"}.`,
      );
      if (!report.passed) process.exitCode = 1;
    });

  program
    .command("compare")
    .description("Apply the three-way frozen-base parity rules")
    .requiredOption("--baseline <file>", "frozen React aggregate report")
    .requiredOption("--pull-request <file>", "PR React and Angular report")
    .requiredOption("--policy <file>", "owned baseline failure policy")
    .requiredOption("--output <file>")
    .option("--integration <slug>", "limit comparison to one integration")
    .option(
      "--features <slugs>",
      "limit comparison to comma-separated feature slugs",
      commaSeparatedValues,
    )
    .action(async (options) => {
      const baseline = await readJson<FrontendMatrixAggregateReport>(
        options.baseline,
      );
      const pullRequest = await readJson<FrontendMatrixAggregateReport>(
        options.pullRequest,
      );
      const policy = await readJson<FrontendBaselinePolicy>(options.policy);
      if (policy.schemaVersion !== 1) {
        throw new Error(
          `unsupported baseline policy schema ${policy.schemaVersion}`,
        );
      }
      if (baseline.sourceCommit !== policy.frozenBaseCommit) {
        throw new Error(
          `baseline source ${baseline.sourceCommit} does not match frozen commit ${policy.frozenBaseCommit}`,
        );
      }
      const scope = {
        integration: options.integration,
        features: options.features,
      };
      const baselineCells = scopeByIntegrationAndFeature(
        frontendParityCellsFromAggregate(baseline),
        scope,
      );
      const pullRequestCells = scopeByIntegrationAndFeature(
        frontendParityCellsFromAggregate(pullRequest),
        scope,
      );
      const acceptedBaselineFailures = scopeByIntegrationAndFeature(
        policy.acceptedFailures,
        scope,
      );
      const report = evaluateFrontendParity({
        frozenBaseCommit: policy.frozenBaseCommit,
        pullRequestCommit: pullRequest.sourceCommit,
        baselineReact: baselineCells,
        pullRequest: pullRequestCells,
        expectedAngularCellIds: pullRequestCells
          .filter((cell) => cell.frontend === "angular")
          .map((cell) => `${cell.integration}/${cell.feature}`),
        acceptedBaselineFailures,
      });
      await writeJson(options.output, report);
      console.log(
        `Compared ${report.comparisons.length} frontend pairs; ${report.passed ? "no blocking regressions" : "blocking regressions found"}.`,
      );
      if (!report.passed) process.exitCode = 1;
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
