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

// LangFuse Logging Integration
export interface LogLLMRequestData {
  threadId?: string;
  runId?: string;
  model?: string;
  messages: any[];
  actions?: any[];
  forwardedParameters?: any;
  timestamp: number;
  provider?: string;
  [key: string]: any;
}

export interface LogLLMResponseData {
  threadId: string;
  runId?: string;
  model?: string;
  output: any;
  latency: number;
  timestamp: number;
  provider?: string;
  isProgressiveChunk?: boolean;
  isFinalResponse?: boolean;
  [key: string]: any;
}

export interface LogLLMErrorData {
  threadId?: string;
  runId?: string;
  model?: string;
  error: Error | string;
  timestamp: number;
  provider?: string;
  [key: string]: any;
}

export interface CopilotLoggerHooks {
  logRequest: (data: LogLLMRequestData) => void | Promise<void>;
  logResponse: (data: LogLLMResponseData) => void | Promise<void>;
  logError: (data: LogLLMErrorData) => void | Promise<void>;
}

export interface CopilotLoggingConfig {
  enabled: boolean;
  progressive: boolean;
  logger: CopilotLoggerHooks;
}
