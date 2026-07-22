#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

import { Command, InvalidArgumentError } from "commander";
import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserType, Page } from "playwright";

import {
  ANGULAR_RUNTIME_READY_BUDGET_MS,
  ANGULAR_RUNTIME_READY_SAMPLE_COUNT,
  evaluateRuntimeReadiness,
} from "../probes/angular-proof.js";

type BrowserName = "chromium" | "firefox" | "webkit";

interface CanaryResult {
  id: string;
  durationMs: number;
  status: "passed";
}

interface ProofOptions {
  browser: BrowserName;
  integration: string;
  integrationBaseUrl: string;
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  output: string;
}

const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const SAFE_REVISION_RE = /^(?:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/;

function browserName(value: string): BrowserName {
  if (value !== "chromium" && value !== "firefox" && value !== "webkit") {
    throw new InvalidArgumentError("must be chromium, firefox, or webkit");
  }
  return value;
}

function browserTypeFor(name: BrowserName): BrowserType {
  if (name === "firefox") return firefox;
  if (name === "webkit") return webkit;
  return chromium;
}

function checkedId(value: string, label: string): string {
  if (!SAFE_ID_RE.test(value)) throw new Error(`${label} is not a safe slug`);
  return value;
}

function checkedRevision(value: string, label: string): string {
  if (!SAFE_REVISION_RE.test(value)) {
    throw new Error(`${label} is not an immutable revision`);
  }
  return value;
}

function checkedLoopbackBase(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "integration base URL must be an uncredentialed loopback HTTP origin",
    );
  }
  return url.href.replace(/\/$/, "");
}

async function recordCanary(
  results: CanaryResult[],
  id: string,
  run: () => Promise<void>,
): Promise<void> {
  const startedAt = performance.now();
  await run();
  results.push({
    id,
    durationMs: Math.round(performance.now() - startedAt),
    status: "passed",
  });
  console.log(`[passed] ${id}`);
}

async function assertNoPageErrors(
  page: Page,
  run: () => Promise<void>,
): Promise<void> {
  const pageErrors: string[] = [];
  const listener = (error: Error): void => {
    pageErrors.push(error.name);
  };
  page.on("pageerror", listener);
  try {
    await run();
    if (pageErrors.length > 0) {
      throw new Error(
        `browser page raised ${pageErrors.length} uncaught error(s)`,
      );
    }
  } finally {
    page.off("pageerror", listener);
  }
}

async function waitForAngular(page: Page): Promise<void> {
  await page
    .locator("showcase-root[ng-version]")
    .waitFor({ state: "attached" });
  await page.waitForFunction(
    () =>
      performance.getEntriesByName("copilotkit:showcase-shell-ready").length >
      0,
  );
}

async function runDesktopCanaries(
  browser: Browser,
  baseUrl: string,
  integration: string,
  results: CanaryResult[],
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await assertNoPageErrors(page, async () => {
      await recordCanary(
        results,
        "static-host-and-browser-bootstrap",
        async () => {
          const response = await page.goto(`${baseUrl}/angular/agentic-chat`, {
            waitUntil: "domcontentloaded",
          });
          if (response === null || !response.ok()) {
            throw new Error(
              "Angular deep link did not return a successful document",
            );
          }
          const initialHtml = await response.text();
          if (!initialHtml.includes("<showcase-root")) {
            throw new Error(
              "Angular static document is missing its root element",
            );
          }
          if (initialHtml.includes('id="__next"')) {
            throw new Error(
              "Angular route returned the React integration document",
            );
          }
          await waitForAngular(page);
          const runtime = await page.evaluate(() => {
            const scope = globalThis as typeof globalThis & {
              __COPILOTKIT_SHOWCASE__?: unknown;
              Zone?: unknown;
            };
            return {
              manifest: scope.__COPILOTKIT_SHOWCASE__,
              zoneLoaded: scope.Zone !== undefined,
            };
          });
          if (
            JSON.stringify(runtime.manifest) !==
            JSON.stringify({
              frontendId: "angular",
              integrationId: integration,
            })
          ) {
            throw new Error(
              "Angular runtime manifest does not match the image",
            );
          }
          if (runtime.zoneLoaded)
            throw new Error("Angular host loaded Zone.js");
          await page.getByText(`angular/${integration}/agentic-chat`).waitFor();
        },
      );

      await recordCanary(results, "popup-keyboard-focus", async () => {
        await page.goto(`${baseUrl}/angular/prebuilt-popup`);
        await waitForAngular(page);
        const dialog = page.getByRole("dialog", { name: "Copilot" });
        await dialog.waitFor();
        await dialog.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        const launcher = page.getByRole("button", {
          name: "Open Copilot chat",
        });
        if (
          !(await launcher.evaluate((element) => element.matches(":focus")))
        ) {
          throw new Error("popup did not return focus to its launcher");
        }
        await launcher.press("Enter");
        await dialog.waitFor();
      });

      await recordCanary(results, "sidebar-desktop-mode", async () => {
        await page.goto(`${baseUrl}/angular/prebuilt-sidebar`);
        await waitForAngular(page);
        const sidebar = page.locator("[data-copilot-sidebar]");
        await sidebar.waitFor();
        if ((await sidebar.getAttribute("role")) !== "complementary") {
          throw new Error("desktop sidebar is not a complementary region");
        }
      });

      await recordCanary(
        results,
        "route-teardown-and-unavailable-state",
        async () => {
          await page.goto(`${baseUrl}/angular/prebuilt-popup`);
          await waitForAngular(page);
          await page.evaluate(
            'history.pushState({}, "", "/angular/agentic-chat"); dispatchEvent(new PopStateEvent("popstate"));',
          );
          await page.locator("showcase-chat-feature").waitFor();
          if ((await page.locator("showcase-popup-feature").count()) !== 0) {
            throw new Error("the previous Angular route was not destroyed");
          }
          await page.goto(`${baseUrl}/angular/not-a-demo`);
          await page.getByRole("alert").waitFor();
          await page
            .getByRole("heading", { name: "Invalid demo route" })
            .waitFor();
        },
      );
    });
  } finally {
    await context.close();
  }
}

async function runMobileCanaries(
  browser: Browser,
  baseUrl: string,
  results: CanaryResult[],
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await assertNoPageErrors(page, async () => {
      await recordCanary(results, "popup-mobile-layout", async () => {
        await page.goto(`${baseUrl}/angular/prebuilt-popup`);
        await waitForAngular(page);
        const box = await page
          .getByRole("dialog", { name: "Copilot" })
          .boundingBox();
        if (box === null || box.width < 389 || box.height < 843) {
          throw new Error("mobile popup does not fill the viewport");
        }
      });
      await recordCanary(results, "sidebar-mobile-dialog", async () => {
        await page.goto(`${baseUrl}/angular/prebuilt-sidebar`);
        await waitForAngular(page);
        const sidebar = page.locator('[data-copilot-sidebar][role="dialog"]');
        await sidebar.waitFor();
        if ((await sidebar.getAttribute("aria-modal")) !== "true") {
          throw new Error("mobile sidebar is not modal");
        }
      });
    });
  } finally {
    await context.close();
  }
}

async function collectRuntimeReadiness(
  browser: Browser,
  browserNameValue: BrowserName,
  baseUrl: string,
): Promise<number[]> {
  const measurements: number[] = [];
  for (
    let sample = 0;
    sample < ANGULAR_RUNTIME_READY_SAMPLE_COUNT;
    sample += 1
  ) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      if (browserNameValue === "chromium") {
        const session = await context.newCDPSession(page);
        await session.send("Network.enable");
        await session.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 20,
          downloadThroughput: (50 * 1024 * 1024) / 8,
          uploadThroughput: (10 * 1024 * 1024) / 8,
        });
        await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      await page.goto(`${baseUrl}/angular/agentic-chat`, {
        waitUntil: "domcontentloaded",
      });
      await waitForAngular(page);
      const measurement = await page.evaluate(() => {
        const entry = performance
          .getEntriesByName("copilotkit:showcase-shell-ready")
          .at(-1);
        return entry?.startTime;
      });
      if (measurement === undefined)
        throw new Error("runtime-ready mark is missing");
      measurements.push(Math.round(measurement));
    } finally {
      await context.close();
    }
  }
  return measurements;
}

async function main(options: ProofOptions): Promise<void> {
  const integration = checkedId(options.integration, "integration");
  const baseUrl = checkedLoopbackBase(options.integrationBaseUrl);
  const sourceCommit = checkedRevision(options.sourceCommit, "source commit");
  const imageRevision = checkedRevision(
    options.containerImageRevision,
    "container image revision",
  );
  const fixtureRevision = checkedRevision(
    options.fixtureRevision,
    "fixture revision",
  );
  const browser = await browserTypeFor(options.browser).launch({
    headless: true,
    args:
      options.browser === "chromium"
        ? ["--no-sandbox", "--disable-dev-shm-usage"]
        : [],
  });
  const canaries: CanaryResult[] = [];
  try {
    await runDesktopCanaries(browser, baseUrl, integration, canaries);
    await runMobileCanaries(browser, baseUrl, canaries);
    const measurementsMs = await collectRuntimeReadiness(
      browser,
      options.browser,
      baseUrl,
    );
    const evaluation = evaluateRuntimeReadiness(measurementsMs);
    if (!evaluation.passed) {
      throw new Error(
        `runtime readiness exceeded ${ANGULAR_RUNTIME_READY_BUDGET_MS} ms`,
      );
    }
    const report = {
      schemaVersion: 1,
      sourceCommit,
      containerImageRevision: imageRevision,
      fixtureRevision,
      integration,
      browser: options.browser,
      viewports: ["1440x900", "390x844"],
      canaries,
      runtimeReadiness: {
        route: "/angular/agentic-chat",
        cpuSlowdown: options.browser === "chromium" ? 4 : null,
        network:
          options.browser === "chromium" ? "50Mbps/10Mbps/20ms" : "native",
        budgetMs: ANGULAR_RUNTIME_READY_BUDGET_MS,
        measurementsMs,
        ...evaluation,
      },
      status: "passed",
    };
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    await fs.writeFile(
      options.output,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await browser.close();
  }
}

const program = new Command()
  .name("angular-proof-ci")
  .requiredOption("--integration <slug>")
  .requiredOption("--integration-base-url <url>")
  .requiredOption("--source-commit <revision>")
  .requiredOption("--container-image-revision <revision>")
  .requiredOption("--fixture-revision <revision>")
  .requiredOption("--output <file>")
  .option("--browser <name>", "browser engine", browserName, "chromium")
  .action(main);

await program.parseAsync();
