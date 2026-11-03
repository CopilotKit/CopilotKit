import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { createLogger } from "../core/logger";
import type { CopilotRuntimeLogger } from "../core/logger";

let consoleLog: MockInstance<typeof console.log>;

beforeEach(() => {
  // Start each test with no LOG_LEVEL, also when the machine sets one.
  vi.stubEnv("LOG_LEVEL", "");
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The raw lines the logger wrote, one per console.log call. */
function writtenLines() {
  return consoleLog.mock.calls.map(([line]) => String(line));
}

/** The lines the logger wrote, parsed as JSON. */
function writtenRecords() {
  return writtenLines().map((line) => JSON.parse(line));
}

/** Calls each log method one time and returns the levels that were written. */
function writtenLevels(logger: CopilotRuntimeLogger) {
  logger.debug("d");
  logger.info("i");
  logger.warn("w");
  logger.error("e");
  return writtenRecords().map((record) => record.level);
}

describe("createLogger", () => {
  it("writes a pino-shaped JSON line", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    createLogger({ level: "debug", component: "c" }).debug({ a: 1 }, "hi");

    expect(writtenLines()).toEqual([
      '{"level":20,"time":1700000000000,"component":"c","a":1,"msg":"hi"}',
    ]);
  });

  it("writes a message-only call with no fields", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    createLogger({ level: "debug" }).info("x");

    expect(writtenLines()).toEqual([
      '{"level":30,"time":1700000000000,"msg":"x"}',
    ]);
  });

  it("omits msg when only an object is given", () => {
    createLogger({ level: "debug" }).warn({ a: 1 });

    const [record] = writtenRecords();
    expect(record).toEqual({ level: 40, time: expect.any(Number), a: 1 });
  });

  it("filters out calls below the level", () => {
    expect(writtenLevels(createLogger({ level: "warn" }))).toEqual([40, 50]);
  });

  it("uses LOG_LEVEL before the level option", () => {
    vi.stubEnv("LOG_LEVEL", "debug");

    expect(writtenLevels(createLogger({ level: "error" }))).toEqual([
      20, 30, 40, 50,
    ]);
  });

  it("defaults to error when there is no LOG_LEVEL and no option", () => {
    expect(writtenLevels(createLogger())).toEqual([50]);
  });

  it.each(["silent", "fatal"])(
    "writes nothing when LOG_LEVEL is %s",
    (name) => {
      vi.stubEnv("LOG_LEVEL", name);

      expect(writtenLevels(createLogger({ level: "debug" }))).toEqual([]);
    },
  );

  it("writes every level when LOG_LEVEL is trace", () => {
    vi.stubEnv("LOG_LEVEL", "trace");

    expect(writtenLevels(createLogger())).toEqual([20, 30, 40, 50]);
  });

  it("falls back to error for an unknown LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "verbose");

    expect(writtenLevels(createLogger({ level: "debug" }))).toEqual([50]);
  });

  it("adds child bindings to the parent bindings", () => {
    const parent = createLogger({ level: "debug", component: "c" });

    parent.child({ req: 1 }).debug("m");
    parent.debug("p");

    expect(writtenRecords()).toEqual([
      { level: 20, time: expect.any(Number), component: "c", req: 1, msg: "m" },
      { level: 20, time: expect.any(Number), component: "c", msg: "p" },
    ]);
  });

  it("writes an Error as type, message and stack", () => {
    const err = new TypeError("boom");

    createLogger().error({ err }, "f");

    const [record] = writtenRecords();
    expect(record.err).toEqual({
      type: "TypeError",
      message: "boom",
      stack: err.stack,
    });
  });

  it("writes a circular reference as [Circular]", () => {
    const event: { type: string; self?: unknown } = { type: "RUN_STARTED" };
    event.self = event;

    createLogger({ level: "debug" }).debug({ event }, "Event emitted");

    const [record] = writtenRecords();
    expect(record.event).toEqual({ type: "RUN_STARTED", self: "[Circular]" });
  });

  it("does not mark a repeated object that is not circular", () => {
    const shared = { id: 1 };

    createLogger({ level: "debug" }).debug({ a: shared, b: shared });

    const [record] = writtenRecords();
    expect(record.a).toEqual({ id: 1 });
    expect(record.b).toEqual({ id: 1 });
  });

  it("writes the message only when a field cannot be written as JSON", () => {
    createLogger({ level: "debug" }).debug({ big: BigInt(1) }, "kept");

    const [record] = writtenRecords();
    expect(record).toEqual({
      level: 20,
      time: expect.any(Number),
      msg: "kept",
    });
  });
});
