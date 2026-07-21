import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

export const FRONTEND_PERFORMANCE_PROFILE = {
  coldNavigations: 10,
  cpuSlowdownRate: 4,
  networkProfile: "50mbps-down-10mbps-up-20ms-latency",
  latencyMs: 20,
  downloadThroughputBytesPerSecond: 6_250_000,
  uploadThroughputBytesPerSecond: 1_250_000,
  readinessMark: "copilotkit:showcase-shell-ready",
  p95BudgetMs: 2_000,
} as const;

export interface FrontendPerformanceArtifact {
  schemaVersion: 1;
  commitSha: string;
  startedAt: string;
  finishedAt: string;
  profile: typeof FRONTEND_PERFORMANCE_PROFILE;
  readinessDurationsMs: number[];
  summary: {
    sampleCount: number;
    p95ReadinessMs: number;
    budgetMs: number;
    status: "passed" | "failed";
  };
}

/** Calculate a percentile using the deterministic nearest-rank definition. */
export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number {
  if (values.length === 0)
    throw new Error("at least one measurement is required");
  if (percentile <= 0 || percentile > 1) {
    throw new Error("percentile must be greater than zero and at most one");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1]!;
}

/** Shape deterministic, privacy-safe shell-readiness evidence. */
export function createFrontendPerformanceArtifact(input: {
  commitSha: string;
  startedAt: string;
  finishedAt: string;
  readinessDurationsMs: number[];
}): FrontendPerformanceArtifact {
  if (
    input.readinessDurationsMs.length !==
    FRONTEND_PERFORMANCE_PROFILE.coldNavigations
  ) {
    throw new Error(
      `expected ${FRONTEND_PERFORMANCE_PROFILE.coldNavigations} cold-navigation measurements`,
    );
  }
  const p95ReadinessMs = nearestRankPercentile(
    input.readinessDurationsMs,
    0.95,
  );
  return {
    schemaVersion: 1,
    commitSha: input.commitSha,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    profile: FRONTEND_PERFORMANCE_PROFILE,
    readinessDurationsMs: input.readinessDurationsMs,
    summary: {
      sampleCount: input.readinessDurationsMs.length,
      p95ReadinessMs,
      budgetMs: FRONTEND_PERFORMANCE_PROFILE.p95BudgetMs,
      status:
        p95ReadinessMs <= FRONTEND_PERFORMANCE_PROFILE.p95BudgetMs
          ? "passed"
          : "failed",
    },
  };
}

async function applyFixedProfile(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: FRONTEND_PERFORMANCE_PROFILE.latencyMs,
    downloadThroughput:
      FRONTEND_PERFORMANCE_PROFILE.downloadThroughputBytesPerSecond,
    uploadThroughput:
      FRONTEND_PERFORMANCE_PROFILE.uploadThroughputBytesPerSecond,
  });
  await session.send("Emulation.setCPUThrottlingRate", {
    rate: FRONTEND_PERFORMANCE_PROFILE.cpuSlowdownRate,
  });
}

async function measureColdNavigation(
  browser: Browser,
  baseUrl: string,
): Promise<number> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      "X-AIMock-Strict": "true",
      "X-AIMock-Context": "langgraph-python",
      "X-Test-Id": "frontend-shell-readiness",
    },
  });
  try {
    const page = await context.newPage();
    await applyFixedProfile(page);
    await page.goto(
      `${baseUrl.replace(/\/$/, "")}/langgraph-python/agentic-chat`,
      { waitUntil: "load" },
    );
    await page.waitForFunction(
      (markName) => performance.getEntriesByName(markName, "mark").length === 1,
      FRONTEND_PERFORMANCE_PROFILE.readinessMark,
      { timeout: 30_000 },
    );
    return await page.evaluate(
      (markName) =>
        performance.getEntriesByName(markName, "mark")[0]!.startTime,
      FRONTEND_PERFORMANCE_PROFILE.readinessMark,
    );
  } finally {
    await context.close();
  }
}

/** Measure ten isolated cold navigations with fixed Chromium CDP throttling. */
export async function runFrontendPerformanceSuite(input: {
  baseUrl: string;
  commitSha: string;
}): Promise<FrontendPerformanceArtifact> {
  const startedAt = new Date().toISOString();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const readinessDurationsMs: number[] = [];
    for (
      let index = 0;
      index < FRONTEND_PERFORMANCE_PROFILE.coldNavigations;
      index += 1
    ) {
      readinessDurationsMs.push(
        await measureColdNavigation(browser, input.baseUrl),
      );
    }
    return createFrontendPerformanceArtifact({
      commitSha: input.commitSha,
      startedAt,
      finishedAt: new Date().toISOString(),
      readinessDurationsMs,
    });
  } finally {
    await browser.close();
  }
}
