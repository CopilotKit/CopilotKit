#!/usr/bin/env node
import { Command, Option, InvalidArgumentError } from "commander";
import { loadConfig } from "./cli/config.js";
import {
  up,
  down,
  rebuild,
  build,
  recreate,
  ps,
  logs,
  ports,
  diffLogs,
  writeLastTestTimestamp,
} from "./cli/lifecycle.js";
import { run } from "./cli/runner.js";
import { fixturesValidate, formatReport } from "./cli/fixtures.js";
import { doctor } from "./cli/doctor.js";
import { aimockRebuild } from "./cli/aimock-rebuild.js";
import type { TestLevel } from "./cli/targets.js";
import { registerEvalCommand } from "./cli/eval/index.js";

const program = new Command();

program
  .name("showcase")
  .description("Local showcase depth-level (smoke/D4/D5) test infrastructure")
  .version("0.1.0");

// ── up ──────────────────────────────────────────────────────────────────
program
  .command("up [slugs...]")
  .description("Start infrastructure and named packages")
  .action(async (slugs: string[]) => {
    loadConfig(); // validate config before starting
    await up(slugs);
  });

// ── down ────────────────────────────────────────────────────────────────
program
  .command("down [slugs...]")
  .description("Stop services")
  .action(async (slugs: string[]) => {
    loadConfig();
    await down(slugs);
  });

// ── test ────────────────────────────────────────────────────────────────
program
  .command("test <target>")
  .description("Run probe tests (target: <slug>, <slug>:<demo>, or all)")
  .addOption(
    new Option("--level <level>", "probe depth (smoke|d4|d5|all)").choices([
      "smoke",
      "d4",
      "d5",
      "all",
    ]),
  )
  .option("--d5", "shorthand for --level d5")
  .option("--d4", "shorthand for --level d4")
  .option("--smoke", "shorthand for --level smoke")
  .option("--verbose", "Enable verbose logging output")
  .option("--headed", "run Playwright in headed mode")
  .option("--repeat <n>", "run N times", (val: string) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || n < 1) {
      throw new InvalidArgumentError("must be a positive integer");
    }
    return n;
  })
  .option("--keep", "don't stop auto-started packages after test")
  .option("--live", "write results to PocketBase for dashboard")
  .option("--rebuild", "force Docker rebuild before running")
  .action(
    async (
      target: string,
      opts: {
        level?: string;
        d5?: boolean;
        d4?: boolean;
        smoke?: boolean;
        verbose?: boolean;
        headed?: boolean;
        repeat?: number;
        keep?: boolean;
        live?: boolean;
        rebuild?: boolean;
      },
    ) => {
      const config = loadConfig();

      const shorthands = [opts.smoke, opts.d4, opts.d5].filter(Boolean);
      if (shorthands.length > 1) {
        console.error("Error: specify at most one of --smoke, --d4, --d5");
        process.exit(1);
      }

      const shorthand = opts.smoke
        ? "smoke"
        : opts.d4
          ? "d4"
          : opts.d5
            ? "d5"
            : null;
      if (shorthand && opts.level) {
        console.error(
          "Error: --level and shorthand flags (--smoke, --d4, --d5) are mutually exclusive",
        );
        process.exit(1);
      }
      const level: TestLevel =
        shorthand ?? (opts.level as TestLevel) ?? "smoke";

      writeLastTestTimestamp();
      const result = await run(target, { ...opts, level }, config);

      if (result.failed > 0) {
        process.exit(1);
      }
    },
  );

// ── rebuild ─────────────────────────────────────────────────────────────
program
  .command("rebuild [slugs...]")
  .description("Rebuild Docker images")
  .action(async (slugs: string[]) => {
    loadConfig();
    await rebuild(slugs);
  });

// ── ps ──────────────────────────────────────────────────────────────────
program
  .command("ps")
  .description("Show running services")
  .action(async () => {
    loadConfig();
    const output = await ps();
    console.log(output);
  });

// ── logs ────────────────────────────────────────────────────────────────
program
  .command("logs <slug>")
  .description("Tail logs for a service")
  .action(async (slug: string) => {
    loadConfig();
    await logs(slug);
  });

// ── build ──────────────────────────────────────────────────────────────
program
  .command("build [slugs...]")
  .description("Build Docker images without starting containers")
  .action(async (slugs: string[]) => {
    loadConfig();
    await build(slugs);
  });

// ── ports ──────────────────────────────────────────────────────────────
program
  .command("ports")
  .description("Print slug-to-host-port mapping")
  .action(() => {
    loadConfig();
    console.log(ports());
  });

// ── recreate ───────────────────────────────────────────────────────────
program
  .command("recreate <slug>")
  .description("Force-recreate a service container")
  .option("--build", "also rebuild the image first")
  .action(async (slug: string, opts: { build?: boolean }) => {
    loadConfig();
    await recreate(slug, { build: opts.build });
  });

// ── fixtures ───────────────────────────────────────────────────────────
const fixturesCmd = program
  .command("fixtures")
  .description("Fixture file management");

fixturesCmd
  .command("validate")
  .description("Check fixture JSON files for structural errors")
  .action(() => {
    const report = fixturesValidate();
    console.log(formatReport(report));
    if (report.errors.length > 0) {
      process.exit(1);
    }
  });

// ── doctor ─────────────────────────────────────────────────────────────
program
  .command("doctor")
  .description("Diagnose common local stack issues")
  .action(async () => {
    const output = await doctor();
    console.log(output);
  });

// ── aimock-rebuild ─────────────────────────────────────────────────────
program
  .command("aimock-rebuild")
  .description("Rebuild aimock from local source and redeploy container")
  .option("--from <path>", "path to aimock source directory")
  .action(async (opts: { from?: string }) => {
    await aimockRebuild({ from: opts.from });
  });

// ── diff-logs ──────────────────────────────────────────────────────────
program
  .command("diff-logs <slug>")
  .description("Show log output for a specific time window")
  .option(
    "--since <duration>",
    'time window (e.g. "5m", "30s", "last-test")',
    "5m",
  )
  .option("--grep <pattern>", "filter log lines by pattern")
  .action(async (slug: string, opts: { since?: string; grep?: string }) => {
    loadConfig();
    await diffLogs(slug, { since: opts.since, grep: opts.grep });
  });

// ── status ──────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show last test results summary")
  .action(async () => {
    const config = loadConfig();
    console.log(
      `Visit the showcase dashboard at ${config.dashboardUrl} for test results and status.`,
    );
  });

// ── eval ───────────────────────────────────────────────────────────────
registerEvalCommand(program);

// ── error handling & entry point ────────────────────────────────────────
process.on("unhandledRejection", (err) => {
  console.error(
    `\x1b[31m[showcase] Unhandled error:\x1b[0m ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});

program.parseAsync().catch((err: unknown) => {
  console.error(
    `\x1b[31m[showcase] Error:\x1b[0m ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
