import type {
  CopilotErrorEvent,
  CopilotErrorHandler,
} from "@copilotkit/shared";

import type { CopilotRuntimeLike } from "./runtime";

export const runtimeErrorReporterOption = Symbol(
  "copilotkit.runtimeErrorReporter",
);

export type RuntimeErrorPhase =
  | "common"
  | "sse.factory"
  | "sse.subscription"
  | "intelligence.startup"
  | "intelligence.subscription";

export interface RuntimeErrorReportParams {
  request: Request;
  error: unknown;
  operation: string;
  agentId?: string;
  threadId?: string;
  runId?: string;
  phase?: RuntimeErrorPhase;
  startTime?: number;
}

export interface RuntimeErrorReporter {
  report(params: RuntimeErrorReportParams): void;
}

export interface RuntimeErrorReporterOptions {
  [runtimeErrorReporterOption]?: RuntimeErrorReporter;
}

export function createRuntimeErrorReporter(
  handler?: CopilotErrorHandler,
): RuntimeErrorReporter {
  return {
    report({
      request,
      error,
      operation,
      agentId,
      threadId,
      runId,
      phase,
      startTime,
    }) {
      if (!handler) return;

      try {
        const event: CopilotErrorEvent = {
          type: "error",
          timestamp: Date.now(),
          context: {
            source: "runtime",
            ...(threadId ? { threadId } : {}),
            ...(runId ? { runId } : {}),
            request: {
              operation,
              method: request.method,
              url: request.url,
              path: new URL(request.url).pathname,
              headers: Object.fromEntries(request.headers.entries()),
              startTime: startTime ?? Date.now(),
            },
            ...(agentId ? { agent: { name: agentId } } : {}),
            ...(phase ? { metadata: { phase } } : {}),
          },
          error,
        };

        const result = handler(event);
        if (result && typeof (result as Promise<void>).catch === "function") {
          void (result as Promise<void>).catch((handlerError) => {
            console.error(
              "CopilotRuntime onError reporting failed:",
              handlerError,
            );
          });
        }
      } catch (handlerError) {
        console.error("CopilotRuntime onError reporting failed:", handlerError);
      }
    },
  };
}

export function getRuntimeErrorReporterFromOptions(
  options: object,
): RuntimeErrorReporter | undefined {
  return (options as RuntimeErrorReporterOptions)[runtimeErrorReporterOption];
}

export function attachRuntimeErrorReporter(
  runtime: object,
  reporter: RuntimeErrorReporter,
): void {
  Object.defineProperty(runtime, runtimeErrorReporterOption, {
    configurable: true,
    value: reporter,
  });
}

export function getRuntimeErrorReporter(
  runtime: CopilotRuntimeLike,
): RuntimeErrorReporter | undefined {
  return (runtime as CopilotRuntimeLike & RuntimeErrorReporterOptions)[
    runtimeErrorReporterOption
  ];
}
