import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createBrowser } from "./browser/session.mjs";
import { createIntelligence } from "./storage/intelligence.mjs";
import { readCapture } from "./capture/runtime-agent.mjs";
import { runSuite } from "./runner.mjs";
import { aggregate } from "./contract.mjs";
import { scenarios } from "./scenarios/row1.mjs";

/** One environment for all selected frameworks; rows and frameworks serialize. */
export async function runConfiguredSuite({
  config,
  frameworks,
  rowIds,
  outputDir,
  signal,
}) {
  assert.ok(
    frameworks.length && new Set(frameworks).size === frameworks.length,
  );
  assert.ok(
    frameworks.every((id) => ["mastra", "strands-typescript"].includes(id)),
    "Concrete browser bootstrap currently supports Mastra and Strands TS; remaining five are unvalidated",
  );
  const rows = [];
  const factories = [];
  // Preflight all modules/dependencies before any environment mutation.
  for (const id of rowIds) {
    rows.push((await import(`./rows/row${id}.mjs`)).row);
    factories.push((await import(`./row${id}/services.mjs`)).createServices);
  }
  const require = createRequire(
    join(
      resolve(
        config.dependenciesDirectory ??
          new URL("./dependencies", import.meta.url).pathname,
      ),
      "package.json",
    ),
  );
  const load = (name) => import(pathToFileURL(require.resolve(name)));
  const { chromium } = await load("playwright");
  const pg = await load("pg");
  const { AbstractAgent } = await load("@ag-ui/client");
  const { from } = await load("rxjs");
  const { default: Redis } = await load("ioredis");
  const { createEnvironment } = await import("./lifecycle/environment.mjs");
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const runId = `rich-${randomUUID()}`;
  const report = {
    runId,
    purpose: config.purpose,
    status: "blocked",
    frameworks: [],
    cleanup: "not-run",
  };
  let environment;
  try {
    environment = await createEnvironment({
      config,
      runId,
      frameworks,
      outputDir,
      signal,
    });
    const firstScope = environment.scopes[frameworks[0]];
    const cleanPool = new (pg.Pool ?? pg.default.Pool)({
      connectionString: firstScope.databaseUrl,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
    });
    const cleanRedis = new Redis(config.redisUrl, {
      lazyConnect: true,
      connectTimeout: 10_000,
      retryStrategy: () => null,
      maxRetriesPerRequest: 0,
    });
    let redisError;
    cleanRedis.on("error", (error) => {
      redisError = error;
    });
    try {
      await cleanRedis.connect();
      await environment.verifyCleanScope({
        pool: cleanPool,
        redis: cleanRedis,
        bootstrapTables: config.bootstrapTables ?? [],
        nativeBootstrapTables: config.nativeBootstrapTables ?? [],
      });
      if (redisError) throw redisError;
    } finally {
      await cleanPool.end();
      cleanRedis.disconnect();
    }
    for (const framework of frameworks) {
      signal?.throwIfAborted();
      const scope = environment.scopes[framework];
      scope.scenarios ??= scenarios({ ...scope, framework });
      assert.ok(
        scope.capture?.directory,
        "Owned pre-ingestion capture directory is required",
      );
      report.frameworks.push(
        await runSuite({
          framework,
          baseline: environment.baseline,
          rows,
          outputDir: join(outputDir, framework),
          createFixture: async ({ outputDir: frameworkOutput }) => {
            const intelligence = createIntelligence({
              scope,
              pool: new (pg.Pool ?? pg.default.Pool)({
                connectionString: scope.databaseUrl,
                connectionTimeoutMillis: 10_000,
                statement_timeout: 30_000,
              }),
            });
            const capture = {
              read: async (threadId) =>
                readCapture(scope.capture.directory, threadId),
            };
            const browsers = [];
            const fixture = {};
            const services = {};
            const cleanup = async () => {
              const results = await Promise.allSettled([
                ...browsers.map((browser) => browser.close()),
                intelligence.close(),
              ]);
              const failure = results.find(
                (result) => result.status === "rejected",
              );
              if (failure) throw failure.reason;
            };
            try {
              for (let i = 0; i < rows.length; i++) {
                const rowOutput = join(frameworkOutput, `row${rows[i].id}`);
                const browser = await createBrowser({
                  chromium,
                  scope,
                  capture,
                  signal,
                  outputDir: rowOutput,
                });
                browsers.push(browser);
                const rowServices = await factories[i]({
                  framework,
                  scope,
                  environment,
                  browser,
                  intelligence,
                  capture,
                  outputDir: rowOutput,
                  signal,
                  dependencies: { AbstractAgent, from },
                });
                for (const key of Object.keys(rowServices.services))
                  assert.ok(
                    !Object.hasOwn(services, key),
                    `Duplicate service ${key}`,
                  );
                Object.assign(fixture, rowServices.fixture);
                Object.assign(services, rowServices.services);
              }
              return { fixture, services, cleanup };
            } catch (error) {
              await cleanup();
              throw error;
            }
          },
        }),
      );
    }
    report.status = aggregate(report.frameworks);
  } catch (error) {
    report.error = String(error);
  } finally {
    if (environment) {
      try {
        await environment.cleanup();
        report.cleanup = "passed";
      } catch (error) {
        report.cleanup = "failed";
        report.cleanupError = String(error);
        report.status = "failed";
      }
    }
    report.harnessSuccess =
      report.cleanup === "passed" &&
      report.frameworks.length === frameworks.length &&
      report.frameworks.every(
        (item) => !item.error && item.cleanup === "passed",
      );
    await writeFile(
      join(outputDir, "suite.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600, flag: "wx" },
    );
  }
  return report;
}
