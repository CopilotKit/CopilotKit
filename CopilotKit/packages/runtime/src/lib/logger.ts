import createPinoLogger from "pino";
import pretty from "pino-pretty";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type CopilotRuntimeLogger = ReturnType<typeof createLogger>;

export function createLogger(options?: { level?: LogLevel; component?: string }) {
  const { level, component } = options || {};
  const stream = pretty({ colorize: true });

  const logger = createPinoLogger(
    {
      level: process.env.LOG_LEVEL || level || "error",
      redact: {
        paths: ["pid", "hostname"],
        remove: true,
      },
    },
    stream,
  );

  if (component) {
    return logger.child({ component });
  } else {
    return logger;
  }
}
