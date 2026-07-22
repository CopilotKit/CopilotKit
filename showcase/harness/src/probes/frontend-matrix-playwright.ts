import { createHash } from "node:crypto";

import type { Browser } from "playwright";

import { runConversation } from "./helpers/conversation-runner.js";
import { conversationFailureSummary } from "./helpers/privacy-safe-diagnostics.js";
import type { D5FeatureType, D5Script } from "./helpers/d5-registry.js";
import {
  installBrowserContextShims,
  installPrePaintFromEnv,
} from "./helpers/init-scripts.js";
import { attachSseInterceptor } from "./helpers/sse-interceptor.js";
import type { SseCapture } from "./helpers/sse-interceptor.js";
import type {
  FrontendMatrixCell,
  RunnableFrontend,
} from "./frontend-matrix.js";
import { urlForFrontendCell } from "./frontend-matrix.js";
import type {
  FrontendCellExecutor,
  FrontendProbeResult,
} from "./frontend-matrix-runner.js";

const DEFAULT_PROBE_TIMEOUT_MS = 90_000;
const DEFAULT_HYDRATION_TIMEOUT_MS = 15_000;
const TEST_ID_MAX_LENGTH = 160;
export { conversationFailureSummary } from "./helpers/privacy-safe-diagnostics.js";

export interface FrontendProbeInput {
  cell: FrontendMatrixCell;
  featureType: D5FeatureType;
  url: string;
  backendUrl: string;
  testId: string;
}

export type FrontendProbeExecutor = (
  input: FrontendProbeInput,
) => Promise<FrontendProbeResult>;

export interface FrontendCellExecutorOptions {
  angularBaseUrl: string;
  backendUrls: Readonly<Record<string, string>>;
  invocationId: string;
  runProbe: FrontendProbeExecutor;
}

function safeIdentifierPart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

/** Build a bounded test id that joins browser, proxy, fixture, and CI rows. */
export function testIdForFrontendProbe(
  cell: FrontendMatrixCell,
  featureType: D5FeatureType,
  invocationId: string,
): string {
  const raw = [
    "fm",
    cell.frontend,
    cell.integration,
    cell.feature,
    featureType,
    invocationId,
  ]
    .map(safeIdentifierPart)
    .join("-");
  if (raw.length <= TEST_ID_MAX_LENGTH) return raw;
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${raw.slice(0, TEST_ID_MAX_LENGTH - digest.length - 1)}-${digest}`;
}

/**
 * Create the cell-level executor. Every mapped sub-probe runs exactly once,
 * including siblings after a failure; retries belong only at infrastructure
 * setup boundaries outside this deterministic executor.
 */
export function createFrontendCellExecutor(
  options: FrontendCellExecutorOptions,
): FrontendCellExecutor {
  return async (cell) => {
    const startedAt = Date.now();
    const backendUrl = options.backendUrls[cell.integration];
    if (!backendUrl) {
      return {
        status: "failed",
        durationMs: Date.now() - startedAt,
        probes: [],
        errorClass: "backend-url-missing",
        error: `no approved backend URL for integration ${cell.integration}`,
      };
    }
    const url = urlForFrontendCell(cell, {
      angularBaseUrl: options.angularBaseUrl,
      reactBaseUrl: backendUrl,
    });
    const probes: FrontendProbeResult[] = [];
    for (const featureType of cell.featureTypes) {
      const testId = testIdForFrontendProbe(
        cell,
        featureType,
        options.invocationId,
      );
      try {
        probes.push(
          await options.runProbe({
            cell,
            featureType,
            url,
            backendUrl,
            testId,
          }),
        );
      } catch {
        probes.push({
          featureType,
          status: "failed",
          durationMs: 0,
          testId,
          errorClass: "probe-executor-error",
          error: "probe executor threw before producing a result",
        });
      }
    }
    const failed = probes.filter((probe) => probe.status === "failed");
    return {
      status: failed.length === 0 ? "passed" : "failed",
      durationMs: Date.now() - startedAt,
      probes,
      url,
      backendUrl,
      ...(failed.length > 0
        ? {
            errorClass: "sub-probe-failed",
            error: `${failed.length} of ${probes.length} deterministic probes failed`,
          }
        : {}),
    };
  };
}

interface HydrationPage {
  waitForFunction(
    expression: string,
    argument: undefined,
    options: { timeout: number },
  ): Promise<unknown>;
}

const ANGULAR_HYDRATION_EXPRESSION = `
  Boolean(document.querySelector('[ng-version]'))
`;

const REACT_HYDRATION_EXPRESSION = `
  (() => {
    const elements = document.querySelectorAll('html, body, body *');
    return Array.from(elements).some((element) =>
      Object.getOwnPropertyNames(element).some((key) => key.startsWith('__react'))
    );
  })()
`;

/** Wait for the selected framework to hydrate its shell. */
export async function waitForFrameworkHydration(
  page: HydrationPage,
  frontend: RunnableFrontend,
  timeoutMs = DEFAULT_HYDRATION_TIMEOUT_MS,
): Promise<void> {
  await page.waitForFunction(
    frontend === "angular"
      ? ANGULAR_HYDRATION_EXPRESSION
      : REACT_HYDRATION_EXPRESSION,
    undefined,
    { timeout: timeoutMs },
  );
}

function safeFailedRequest(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-request-url";
  }
}

function sseDiagnostics(
  capture: SseCapture | undefined,
): Record<string, unknown> {
  if (!capture) return {};
  return {
    sseEventCount: capture.raw_event_count,
    sseChunkCount: capture.streamProfile.total_chunks,
    sseTtftMs: capture.streamProfile.ttft_ms,
    toolCallNames: capture.toolCalls,
  };
}

export interface PlaywrightProbeExecutorOptions {
  browser: Browser;
  scripts: ReadonlyMap<D5FeatureType, D5Script>;
  probeTimeoutMs?: number;
  hydrationTimeoutMs?: number;
}

/**
 * Create the Chromium probe used by merge-gating matrix shards. The browser is
 * shared, but every sub-probe receives a fresh isolated context and page.
 */
export function createPlaywrightProbeExecutor(
  options: PlaywrightProbeExecutorOptions,
): FrontendProbeExecutor {
  return async (input) => {
    const startedAt = Date.now();
    const script = options.scripts.get(input.featureType);
    if (!script) {
      return {
        featureType: input.featureType,
        status: "failed",
        durationMs: Date.now() - startedAt,
        testId: input.testId,
        errorClass: "probe-script-missing",
        error: `no deterministic script registered for ${input.featureType}`,
      };
    }

    const context = await options.browser.newContext({
      extraHTTPHeaders: {
        "X-AIMock-Strict": "true",
        "X-AIMock-Context": input.cell.integration,
        "X-Test-Id": input.testId,
        "X-Diag-Run-Id": input.testId,
        "X-Diag-Hops": "frontend-matrix",
      },
    });
    const page = await context.newPage();
    const requestFailures: string[] = [];
    let pageErrorCount = 0;
    page.on("pageerror", () => {
      pageErrorCount += 1;
    });
    page.on("requestfailed", (request) => {
      requestFailures.push(safeFailedRequest(request.url()));
    });

    let stage = "initialization";
    let capture: SseCapture | undefined;
    let sseHandle: Awaited<ReturnType<typeof attachSseInterceptor>> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          void context.close();
          reject(new Error("frontend matrix probe timeout"));
        }, options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
      });
      const run = async (): Promise<FrontendProbeResult> => {
        await installBrowserContextShims(page);
        await installPrePaintFromEnv(page);
        sseHandle = await attachSseInterceptor(page);

        stage = "navigation";
        const response = await page.goto(input.url, {
          waitUntil: "load",
          timeout: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        });
        if (response && !response.ok()) {
          throw new Error(`navigation returned HTTP ${response.status()}`);
        }

        stage = "hydration";
        await waitForFrameworkHydration(
          page,
          input.cell.frontend,
          options.hydrationTimeoutMs,
        );

        stage = "conversation";
        const conversation = await runConversation(
          page,
          script.buildTurns({
            integrationSlug: input.cell.integration,
            featureType: input.featureType,
            baseUrl: input.backendUrl,
          }),
        );
        if (conversation.failure_turn !== undefined) {
          const failureSummary = conversationFailureSummary(conversation.error);
          return {
            featureType: input.featureType,
            status: "failed",
            durationMs: Date.now() - startedAt,
            testId: input.testId,
            errorClass: "conversation-error",
            error: `conversation failed on turn ${conversation.failure_turn} (${failureSummary})`,
            diagnostics: {
              frontend: input.cell.frontend,
              turnsCompleted: conversation.turns_completed,
              totalTurns: conversation.total_turns,
              pageErrorCount,
              requestFailureCount: requestFailures.length,
              failedRequests: requestFailures.slice(-10),
            },
          };
        }

        stage = "capture";
        capture = await sseHandle.stop();
        return {
          featureType: input.featureType,
          status: "passed",
          durationMs: Date.now() - startedAt,
          testId: input.testId,
          diagnostics: {
            frontend: input.cell.frontend,
            turnsCompleted: conversation.turns_completed,
            totalTurns: conversation.total_turns,
            pageErrorCount,
            requestFailureCount: requestFailures.length,
            failedRequests: requestFailures.slice(-10),
            ...sseDiagnostics(capture),
          },
        };
      };
      return await Promise.race([run(), timedOut]);
    } catch {
      return {
        featureType: input.featureType,
        status: "failed",
        durationMs: Date.now() - startedAt,
        testId: input.testId,
        errorClass:
          stage === "navigation"
            ? "goto-error"
            : stage === "hydration"
              ? "hydration-error"
              : stage === "conversation"
                ? "conversation-error"
                : stage === "capture"
                  ? "capture-error"
                  : "infrastructure-error",
        error: `${stage} failed`,
        diagnostics: {
          frontend: input.cell.frontend,
          pageErrorCount,
          requestFailureCount: requestFailures.length,
          failedRequests: requestFailures.slice(-10),
          ...sseDiagnostics(capture),
        },
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (sseHandle && !sseHandle.consumed) {
        try {
          capture = await sseHandle.stop();
        } catch {
          // The primary result already records the stage that failed.
        }
      }
      await context.close().catch(() => undefined);
    }
  };
}
