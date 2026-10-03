import { createHash } from "node:crypto";

import type { Browser, BrowserContext, Frame, Page, Request } from "playwright";

import { runConversation } from "./helpers/conversation-runner.js";
import type { PublicObservation } from "./helpers/conversation-runner.js";
import { conversationFailureSummary } from "./helpers/privacy-safe-diagnostics.js";
import type { D5FeatureType, D5Script } from "./helpers/d5-registry.js";
import {
  installBrowserContextShims,
  installPrePaintFromEnv,
} from "./helpers/init-scripts.js";
import {
  parseSseEvents,
  attachSseInterceptor,
} from "./helpers/sse-interceptor.js";
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

import {
  functionalAdmission,
  FUNCTIONAL_CANONICAL_REVISIONS,
} from "../shared/cell-model/live-status.js";

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
  key?: string;
  runId?: string;
  targetRevision?: string;
  canonicalRevision?: string;
}

export type FrontendProbeExecutor = (
  input: FrontendProbeInput,
) => Promise<FrontendProbeResult>;

export interface FrontendCellExecutorOptions {
  angularBaseUrl: string;
  backendUrls: Readonly<Record<string, string>>;
  invocationId: string;
  targetRevisions?: Readonly<Record<string, string>>;
  runProbe: FrontendProbeExecutor;
  executionMode?: "diagnostic" | "public-pill";
  publicShellBaseUrl?: string;
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
      executionMode: options.executionMode,
      publicShellBaseUrl: options.publicShellBaseUrl,
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
            key: `d6:${cell.integration}/${featureType}`,
            runId: options.invocationId,
            targetRevision: options.targetRevisions?.[cell.integration],
            canonicalRevision: FUNCTIONAL_CANONICAL_REVISIONS[featureType],
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
      status:
        failed.length > 0
          ? "failed"
          : probes.length === 0 ||
              probes.some((probe) => probe.status === "unverified")
            ? "unverified"
            : "passed",
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
  browser: {
    newContext: (
      options?: Parameters<Browser["newContext"]>[0],
    ) => Promise<Pick<BrowserContext, "newPage" | "close">>;
  };
  scripts: ReadonlyMap<D5FeatureType, D5Script>;
  probeTimeoutMs?: number;
  hydrationTimeoutMs?: number;
  executionMode?: "diagnostic" | "public-pill";
}

/** Observe the normal transport; no route handler, fetch wrapper or browser mutation. */
export function observePublicTransport(
  page: Page,
  targetFrame: () => Frame | undefined,
): () => PublicObservation {
  const messages = new Map<string, string>();
  const requests = new Map<
    Request,
    { runId: string; threadId: string; messageId: string }
  >();
  let terminalIdentity: PublicObservation["terminal"];
  let active = 0;
  let starts = 0;
  let finished = 0;
  let error: string | undefined;
  const fail = () => {
    error ??= "public pill transport or page error";
  };
  page.on("pageerror", fail);
  page.on("request", (request) => {
    if (request.method() !== "POST" || request.frame() !== targetFrame())
      return;
    try {
      const input = request.postDataJSON();
      if (input?.method !== "agent/run") return;
      const body = input.body;
      if (
        !body ||
        !Array.isArray(body.messages) ||
        typeof body.runId !== "string" ||
        typeof body.threadId !== "string"
      ) {
        fail();
        return;
      }
      for (const message of body.messages) {
        if (message.role !== "user") continue;
        if (
          typeof message.id !== "string" ||
          !message.id ||
          typeof message.content !== "string"
        ) {
          fail();
          return;
        }
        if (
          messages.has(message.id) &&
          messages.get(message.id) !== message.content
        ) {
          fail();
          return;
        }
        messages.set(message.id, message.content);
      }
      const user = body.messages
        .filter((message: { role: string }) => message.role === "user")
        .at(-1);
      if (!user?.id) {
        fail();
        return;
      }
      requests.set(request, {
        runId: body.runId,
        threadId: body.threadId,
        messageId: user.id,
      });
      active++;
      starts++;
    } catch {
      fail();
    }
  });
  page.on("requestfailed", (request) => {
    if (requests.has(request)) fail();
  });
  page.on("response", (response) => {
    const request = response.request();
    const identity = requests.get(request);
    if (!identity) return;
    // Playwright does not await event listeners. The pending request keeps
    // completion closed until this body finishes; every error is latched for
    // the runner to reject, so a late or failed read cannot grant action credit.
    void (async () => {
      try {
        if (!response.ok()) throw new Error("HTTP error");
        const body = (await response.body()).toString("utf8");
        if (!body.replace(/\r\n/g, "\n").endsWith("\n\n"))
          throw new Error("incomplete SSE frame");
        const events = parseSseEvents(body);
        const terminals = events.filter(
          (event) =>
            event.kind === "json" && event.payload.type === "RUN_FINISHED",
        );
        if (
          events.some(
            (event) =>
              event.kind === "non-json" || event.payload.type === "RUN_ERROR",
          ) ||
          terminals.length !== 1
        )
          throw new Error("missing or errored terminal");
        const lifecycle = events.filter(
          (event) =>
            event.kind === "json" &&
            ["RUN_STARTED", "RUN_FINISHED", "RUN_ERROR"].includes(
              String(event.payload.type),
            ),
        );
        if (lifecycle.at(-1) !== terminals[0])
          throw new Error("run lifecycle did not end at terminal");
        const terminal = terminals[0]!;
        if (
          terminal.kind !== "json" ||
          terminal.payload.runId !== identity.runId ||
          terminal.payload.threadId !== identity.threadId
        )
          throw new Error("terminal identity mismatch");
        terminalIdentity = identity;
        finished++;
        active--;
      } catch {
        fail();
      }
    })();
  });
  return () => ({
    userMessages: [...messages].map(([id, content]) => ({ id, content })),
    runsFinished: finished,
    terminal: terminalIdentity,
    running: {
      attrPresent: true,
      runningNow: active > 0,
      sawRunningTrue: starts > 0,
      runStartCount: starts,
      lastStoppedAtMs: 0,
    },
    ...(error ? { error } : {}),
  });
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

    const publicMode = options.executionMode === "public-pill";
    const context = await options.browser.newContext(
      publicMode
        ? {}
        : {
            extraHTTPHeaders: {
              "X-AIMock-Strict": "true",
              "X-AIMock-Context": input.cell.integration,
              "X-Test-Id": input.testId,
              "X-Diag-Run-Id": input.testId,
              "X-Diag-Hops": "frontend-matrix",
            },
          },
    );
    const page = await context.newPage();
    const requestFailures: string[] = [];
    let pageErrorCount = 0;
    page.on("pageerror", () => {
      pageErrorCount += 1;
    });
    page.on("requestfailed", (request) => {
      requestFailures.push(safeFailedRequest(request.url()));
    });

    let targetFrame: Frame | undefined;
    const observePublic = publicMode
      ? observePublicTransport(page, () => targetFrame)
      : undefined;
    let stage = "initialization";
    let capture: SseCapture | undefined;
    let sseHandle: Awaited<ReturnType<typeof attachSseInterceptor>> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let runPromise: Promise<FrontendProbeResult> | undefined;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          void context.close();
          reject(new Error("frontend matrix probe timeout"));
        }, options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS);
      });
      const run = async (): Promise<FrontendProbeResult> => {
        if (!publicMode) {
          await installBrowserContextShims(page);
          await installPrePaintFromEnv(page);
          sseHandle = await attachSseInterceptor(page);
        }

        stage = "navigation";
        const response = await page.goto(input.url, {
          waitUntil: "load",
          timeout: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
        });
        if (response && !response.ok()) {
          throw new Error(`navigation returned HTTP ${response.status()}`);
        }

        stage = "hydration";
        if (publicMode) {
          const iframe = page.locator("iframe");
          await iframe.waitFor({
            state: "visible",
            timeout: options.hydrationTimeoutMs ?? DEFAULT_HYDRATION_TIMEOUT_MS,
          });
          if ((await iframe.count()) !== 1)
            throw new Error("public shell must resolve exactly one iframe");
          targetFrame =
            (await (await iframe.elementHandle())?.contentFrame()) ?? undefined;
          if (!targetFrame) throw new Error("public shell iframe missing");
          await targetFrame.waitForLoadState("load");
          const expected = new URL(
            `/${input.cell.frontend === "angular" ? "angular" : "demos"}/${input.cell.feature}`,
            input.backendUrl,
          );
          const actual = new URL(targetFrame.url());
          if (page.url() !== input.url || actual.search || actual.hash)
            throw new Error("public shell navigation target changed");
          if (
            actual.origin !== expected.origin ||
            actual.pathname !== expected.pathname
          )
            throw new Error("public shell iframe target mismatch");
        }
        const surface = targetFrame ?? page;
        await waitForFrameworkHydration(
          surface,
          input.cell.frontend,
          options.hydrationTimeoutMs,
        );

        stage = "conversation";
        const conversation = await runConversation(
          surface,
          script.buildTurns({
            integrationSlug: input.cell.integration,
            featureType: input.featureType,
            baseUrl: input.backendUrl,
          }),
          publicMode
            ? {
                executionMode: "public-pill",
                canonical: script.canonical,
                observePublic,
              }
            : {},
        );
        const observedAt = new Date().toISOString();
        if (conversation.functional)
          conversation.functional.binding = {
            key:
              input.key ?? `d6:${input.cell.integration}/${input.featureType}`,
            observedAt,
            runId: input.runId,
            frontend: input.cell.frontend,
            targetRevision: input.targetRevision,
            canonicalRevision: input.canonicalRevision,
            outerUrl: page.url(),
            iframeUrl: targetFrame?.url() ?? "",
          };
        if (conversation.failure_turn !== undefined) {
          const failureSummary = conversationFailureSummary(conversation.error);
          return {
            featureType: input.featureType,
            status: "failed",
            durationMs: Date.now() - startedAt,
            testId: input.testId,
            errorClass: "conversation-error",
            failureReason: failureSummary,
            error: `conversation failed on turn ${conversation.failure_turn} (${failureSummary})`,
            diagnostics: {
              frontend: input.cell.frontend,
              turnsCompleted: conversation.turns_completed,
              totalTurns: conversation.total_turns,
              pageErrorCount,
              requestFailureCount: requestFailures.length,
              failedRequests: requestFailures.slice(-10),
              ...(publicMode
                ? { outerUrl: page.url(), iframeUrl: targetFrame?.url() }
                : {}),
            },
            ...(conversation.functional
              ? { functional: conversation.functional }
              : {}),
          };
        }

        stage = "capture";
        if (sseHandle) capture = await sseHandle.stop();
        return {
          featureType: input.featureType,
          status:
            !publicMode ||
            functionalAdmission(
              conversation.functional?.binding?.key ?? "",
              "green",
              { functional: conversation.functional },
              observedAt,
              {
                runId: input.runId,
                targetRevision: input.targetRevision,
                canonicalRevision: input.canonicalRevision,
                frontend: input.cell.frontend,
              },
            ) === "unchanged"
              ? "passed"
              : "unverified",
          durationMs: Date.now() - startedAt,
          testId: input.testId,
          ...(conversation.functional
            ? { functional: conversation.functional }
            : {}),
          diagnostics: {
            ...(publicMode
              ? { outerUrl: page.url(), iframeUrl: targetFrame?.url() }
              : {}),
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
      runPromise = run();
      return await Promise.race([runPromise, timedOut]);
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
      // Closing a context interrupts Playwright calls, but Promise.race does
      // not cancel the losing `run()` promise. Wait for that interrupted task
      // to unwind before the shard starts its next cell; otherwise its
      // conversation loop can keep emitting diagnostics or touching shared
      // fixture/backend state after this probe has already returned.
      await runPromise?.catch(() => undefined);
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
