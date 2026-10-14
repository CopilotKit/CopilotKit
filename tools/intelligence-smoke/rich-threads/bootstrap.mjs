import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createBrowser } from "./browser/session.mjs";
import { createIntelligence } from "./storage/intelligence.mjs";
import { createCapture } from "./capture/transport.mjs";
import { preflight } from "./preflight.mjs";
import { runSuite } from "./runner.mjs";
import { aggregate } from "./contract.mjs";
import { scenarios } from "./scenarios/row1.mjs";
import { milestone, deferred } from "./contract.mjs";

/** One environment for all selected frameworks; rows and frameworks serialize. */
export async function runConfiguredSuite({
  config,
  frameworks,
  rowIds,
  outputDir,
  signal,
  failureControl = false,
}) {
  await mkdir(outputDir, { recursive: false, mode: 0o700 });
  const runId = `rich-${randomUUID()}`;
  const report = {
    runId,
    milestone,
    deferred,
    purpose: config.purpose,
    provider: config.provider,
    requested: { frameworks, rows: rowIds },
    status: "blocked",
    frameworks: [],
    cleanup: "not-run",
  };
  let environment;
  try {
    assert.equal(
      config.provider,
      "railway",
      "The bounded milestone requires isolated Railway",
    );
    const prepared = await preflight({ frameworks, rowIds });
    report.preflight = prepared.checks;
    if (!prepared.ready) return report;
    const { rows, factories } = prepared;
    const require = createRequire(
      join(
        resolve(
          config.dependenciesDirectory ??
            fileURLToPath(new URL("./dependencies", import.meta.url)),
        ),
        "package.json",
      ),
    );
    const load = (name) => import(pathToFileURL(require.resolve(name)));
    const { chromium } = await load("playwright");
    const pg = await load("pg");
    const { AbstractAgent } = await load("@ag-ui/client");
    const { from } = await load("rxjs");
    const { createEnvironment } = await import("./lifecycle/environment.mjs");
    environment = await createEnvironment({
      config,
      runId,
      frameworks,
      outputDir,
      signal,
    });
    const clean = await environment.verifyCleanScope();
    assert.equal(
      clean.status,
      "passed",
      "Remote clean-scope verification failed",
    );
    assert.equal(
      environment.receipt.cleanScope.status,
      "passed",
      "Remote clean-scope receipt required",
    );
    for (const framework of frameworks) {
      signal?.throwIfAborted();
      const scope = environment.scopes[framework];
      assert.ok(scope, "Provisioned framework scope required");
      scope.scenarios = scenarios();
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
            const capture = createCapture({
              scope,
              provider: config.provider,
              signal,
            });
            const browsers = [];
            let browserInstance;
            const fixture = {};
            const services = {};
            const cleanup = async () => {
              const results = await Promise.allSettled([
                ...browsers.map((browser) => browser.close()),
                intelligence.close(),
              ]);
              if (browserInstance) await browserInstance.close();
              const failure = results.find(
                (result) => result.status === "rejected",
              );
              if (failure) throw failure.reason;
            };
            try {
              browserInstance = await chromium.launch({ headless: true });
              for (let i = 0; i < rows.length; i++) {
                const rowOutput = join(frameworkOutput, `row${rows[i].id}`);
                const browser = await createBrowser({
                  chromium,
                  scope,
                  capture,
                  signal,
                  outputDir: rowOutput,
                  instance: browserInstance,
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
    if (failureControl && report.status === "passed") {
      report.failureControl = {
        injected: true,
        stage: "after-real-journeys",
        detail: "Deliberate suite assertion failure to exercise cleanup",
      };
      report.status = "failed";
    }
  } catch (error) {
    report.error = {
      name: error.name,
      detail:
        "Bootstrap failed; inspect private controller diagnostics and lifecycle receipts",
    };
  } finally {
    if (environment) {
      try {
        await environment.cleanup();
        report.cleanup = "passed";
        report.withinLifetime = environment.receipt.withinLifetime === true;
        report.deadlineExceeded =
          environment.receipt.cleanup?.deadlineExceeded === true;
        if (!report.withinLifetime || report.deadlineExceeded)
          report.status = "failed";
      } catch (error) {
        report.cleanup = "failed";
        report.cleanupError = {
          name: error.name,
          detail: "Owned environment cleanup failed; recovery required",
        };
        report.status = "failed";
      }
    }
    report.harnessSuccess =
      report.cleanup === "passed" &&
      report.frameworks.length === frameworks.length &&
      report.frameworks.every(
        (item) =>
          !item.error &&
          item.cleanup === "passed" &&
          item.rows.every((row) =>
            row.checks.every(
              (check) =>
                check.status !== "blocked" && check.name !== "execution",
            ),
          ),
      );
    await writeFile(
      join(outputDir, "suite.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600, flag: "wx" },
    );
  }
  return report;
}
