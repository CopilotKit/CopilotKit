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

// Cache at boot. Previously the logger re-read process.env on every emit,
// which is both wasteful on the hot path and makes debugging "why didn't my
// LOG_LEVEL take" harder (looks like it should work, but the resolved value
// depended on whatever process.env happened to look like at emit time).
//
// To change verbosity on a running process WITHOUT a restart, send SIGHUP
// (with a handler that calls `reloadLogLevel()`) or call `reloadLogLevel()`
// directly from a debug endpoint. The cached value is intentional — we
// don't re-read per-emit.
const parsed = parseLevel(process.env.LOG_LEVEL);
let cachedLevel: Level = parsed.level;

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

/**
 * JSON.stringify with two belt-and-braces fallbacks:
 *   1. Cycle break via WeakSet — circular `meta` (e.g. a caller passing an
 *      Error with a cause chain that loops, or a bus event carrying its own
 *      emitter reference) otherwise throws TypeError out of the catch block
 *      that called logger.error, masking the original failure.
 *   2. BigInt coerce to string — `JSON.stringify(1n)` throws; surfacing as
 *      `"1"` keeps the log line emittable instead of swallowing the record.
 * Any stringify failure after fallbacks becomes a literal `[logger: stringify
 * failed]` marker so the log line still appears (at the cost of losing meta
 * — preferable to silently losing the entire log event).
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, val): unknown => {
      if (typeof val === "bigint") return val.toString();
      if (val !== null && typeof val === "object") {
        if (seen.has(val as object)) return "[Circular]";
        seen.add(val as object);
      }
      return val;
    });
  } catch {
    // Best-effort fallback: emit structural shell so the level/msg survive.
    try {
      const v = value as { level?: unknown; msg?: unknown; ts?: unknown };
      return JSON.stringify({
        level: v.level,
        msg: v.msg,
        ts: v.ts,
        _meta_err: "[logger: stringify failed]",
      });
    } catch {
      return `{"level":"error","msg":"logger: stringify failed"}`;
    }
  }
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
  stream.write(`${safeStringify(line)}\n`);
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
