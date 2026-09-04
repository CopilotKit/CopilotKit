/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — CopilotRuntimeLogger:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — createLogger:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — LogLevel:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/
 *   V2 reference docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import createPinoLogger from "pino";
import pretty from "pino-pretty";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type CopilotRuntimeLogger = ReturnType<typeof createLogger>;

export function createLogger(options?: {
  level?: LogLevel;
  component?: string;
}) {
  const { level, component } = options || {};
  const stream = pretty({ colorize: true });

  const logger = createPinoLogger(
    {
      level: process.env.LOG_LEVEL || level || "error",
      // Drop `pid` and `hostname` with pino's own `base` switch rather than
      // with `redact`. pino 9 validates every redact path by calling
      // `Function(...)`, and edge runtimes such as Cloudflare Workers forbid
      // code generation from strings. That throws while the logger is being
      // built, and the validator reports the first path in the array, so the
      // failure surfaces as the misleading "redact paths array contains an
      // invalid path (pid)". `base: null` produces identical output and needs
      // no code generation. See issue #2355.
      base: null,
    },
    stream,
  );

  if (component) {
    return logger.child({ component });
  } else {
    return logger;
  }
}
