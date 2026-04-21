import type { Logger } from "./types/index.js";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const VALID_LEVELS: readonly Level[] = ["debug", "info", "warn", "error"];

function parseLevel(raw: string | undefined): {
  level: Level;
  invalid: boolean;
} {
  if (raw == null || raw === "") return { level: "info", invalid: false };
  const normalized = raw.toLowerCase();
  if ((VALID_LEVELS as readonly string[]).includes(normalized)) {
    return { level: normalized as Level, invalid: false };
  }
  return { level: "info", invalid: true };
}

// Cache at boot. Previously the logger re-read process.env on every emit, which
// is both wasteful on the hot path and makes debugging "why didn't my LOG_LEVEL
// take" harder (looks like it should work, but the resolved value depended on
// whatever process.env happened to look like at emit time).
let cachedLevel: Level;
const parsed = parseLevel(process.env.LOG_LEVEL);
cachedLevel = parsed.level;

// Emit a boot-time warning loud enough to catch in a tail before operators
// waste time wondering why `debug` logs aren't showing. Done via a direct
// stderr write to avoid bootstrap ordering issues with the `logger` export.
if (parsed.invalid) {
  const warning = {
    level: "warn",
    msg: "logger: invalid LOG_LEVEL, falling back to 'info'",
    ts: new Date().toISOString(),
    raw: process.env.LOG_LEVEL,
    validLevels: VALID_LEVELS,
  };
  process.stderr.write(`${JSON.stringify(warning)}\n`);
}

/**
 * Re-read LOG_LEVEL from process.env. Call from a SIGHUP handler if you want
 * operators to adjust verbosity on a running process without a restart.
 */
export function reloadLogLevel(): void {
  const next = parseLevel(process.env.LOG_LEVEL);
  cachedLevel = next.level;
  if (next.invalid) {
    const warning = {
      level: "warn",
      msg: "logger: invalid LOG_LEVEL on reload, keeping 'info'",
      ts: new Date().toISOString(),
      raw: process.env.LOG_LEVEL,
    };
    process.stderr.write(`${JSON.stringify(warning)}\n`);
  }
}

function currentLevel(): Level {
  return cachedLevel;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[currentLevel()]) return;
  const line = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...(meta ?? {}),
  };
  const stream =
    level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

export const logger: Logger = {
  debug: (msg, meta) => emit("debug", msg, meta),
  info: (msg, meta) => emit("info", msg, meta),
  warn: (msg, meta) => emit("warn", msg, meta),
  error: (msg, meta) => emit("error", msg, meta),
};

export function createLogger(bindings: Record<string, unknown>): Logger {
  return {
    debug: (msg, meta) => emit("debug", msg, { ...bindings, ...(meta ?? {}) }),
    info: (msg, meta) => emit("info", msg, { ...bindings, ...(meta ?? {}) }),
    warn: (msg, meta) => emit("warn", msg, { ...bindings, ...(meta ?? {}) }),
    error: (msg, meta) => emit("error", msg, { ...bindings, ...(meta ?? {}) }),
  };
}
