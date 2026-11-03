/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — CopilotRuntimeLogger:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — createLogger:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — LogLevel:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import { processEnv } from "@copilotkit/shared";

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * One log method. Give a message, or an object of fields and an optional
 * message. The fields go into the JSON line next to the message.
 */
type LogFn = {
  (msg: string): void;
  (obj: object, msg?: string): void;
};

/**
 * The logger that `createLogger` returns and `runtime.debugLogger` holds.
 * Each call writes one JSON line in pino's format, so `npx pino-pretty` can
 * format the output.
 */
export interface CopilotRuntimeLogger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  /** Returns a logger that adds `bindings` to each line it writes. */
  child(bindings: Record<string, unknown>): CopilotRuntimeLogger;
}

// pino's number levels. A logger writes a line only when the level of the
// call is at or above its threshold.
const METHOD_LEVELS: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

// `LOG_LEVEL` also accepts pino's other level names. They only set the
// threshold. There are no `trace` or `fatal` methods.
const THRESHOLDS = new Map<string, number>([
  ["trace", 10],
  ...Object.entries(METHOD_LEVELS),
  ["fatal", 60],
  ["silent", Infinity],
]);

function resolveThreshold(level: LogLevel | undefined) {
  const name = processEnv().LOG_LEVEL || level || "error";
  // An unknown name falls back to "error". It must not stop the runtime.
  return THRESHOLDS.get(name) ?? METHOD_LEVELS.error;
}

// A JSON.stringify replacer. It writes an Error as `{ type, message, stack }`
// (JSON.stringify writes an Error as `{}`), and it writes a reference back to
// an ancestor as "[Circular]". It keeps a stack of the ancestors of the
// current value, so an object that is used two times in different places is
// written two times and is not marked as circular.
function createReplacer() {
  const ancestors: unknown[] = [];
  return function replacer(this: unknown, _key: string, value: unknown) {
    // `this` is the object that holds `value`. Remove the ancestors that
    // JSON.stringify has finished.
    while (ancestors.length > 0 && ancestors.at(-1) !== this) {
      ancestors.pop();
    }
    const written =
      value instanceof Error
        ? { type: value.name, message: value.message, stack: value.stack }
        : value;
    if (typeof written !== "object" || written === null) {
      return written;
    }
    if (ancestors.includes(written)) {
      return "[Circular]";
    }
    ancestors.push(written);
    return written;
  };
}

function buildLogger(threshold: number, bindings: Record<string, unknown>) {
  const createLogFn = (levelValue: number) => {
    const log: LogFn = (objOrMsg: string | object, msg?: string) => {
      if (levelValue < threshold) {
        return;
      }
      const isMessageOnly = typeof objOrMsg === "string";
      const message = isMessageOnly ? objOrMsg : msg;
      const fields = isMessageOnly ? {} : objOrMsg;
      const head = { level: levelValue, time: Date.now() };
      try {
        const record: Record<string, unknown> = {
          ...head,
          ...bindings,
          ...fields,
        };
        if (message !== undefined) {
          record.msg = message;
        }
        console.log(JSON.stringify(record, createReplacer()));
      } catch {
        // A value that JSON cannot write (for example a BigInt or a getter
        // that throws). A log call must never throw, so write the message
        // only.
        console.log(JSON.stringify({ ...head, msg: message }));
      }
    };
    return log;
  };

  const logger: CopilotRuntimeLogger = {
    debug: createLogFn(METHOD_LEVELS.debug),
    info: createLogFn(METHOD_LEVELS.info),
    warn: createLogFn(METHOD_LEVELS.warn),
    error: createLogFn(METHOD_LEVELS.error),
    child: (childBindings) =>
      buildLogger(threshold, { ...bindings, ...childBindings }),
  };
  return logger;
}

/**
 * Creates the runtime logger. Each call writes one JSON line with
 * `console.log`, in pino's format:
 * `{"level":20,"time":<ms>,"component":"...",...fields,"msg":"..."}`.
 *
 * @param options.level - The lowest level to write. The `LOG_LEVEL`
 *   environment variable wins over it. The default is `"error"`.
 * @param options.component - Added as `component` to each line.
 *
 * @example
 * const logger = createLogger({ level: "debug", component: "copilotkit-debug" });
 * logger.debug({ eventCount: 2 }, "SSE stream completed");
 */
export function createLogger(options?: {
  level?: LogLevel;
  component?: string;
}) {
  const { level, component } = options ?? {};
  return buildLogger(resolveThreshold(level), component ? { component } : {});
}
