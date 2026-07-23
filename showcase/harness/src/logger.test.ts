import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger, reloadLogLevel } from "./logger.js";

// The module-level logger writes to process.stdout / stderr. Tests capture
// writes via spies on those streams rather than reaching into logger
// internals (which would require refactoring). Writes are synchronous so
// the capture is stable per emit.

describe("logger.safeStringify (F1.10)", () => {
  // MockInstance generic changed across vitest versions; capture the call
  // via the return value of vi.spyOn without restricting the generic.
  let outSpy: { mockRestore: () => void };
  let errSpy: { mockRestore: () => void };
  const outLines: string[] = [];
  const errLines: string[] = [];

  beforeEach(() => {
    outLines.length = 0;
    errLines.length = 0;
    outSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        outLines.push(String(chunk));
        return true;
      });
    errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        errLines.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("emits normal object without throwing", () => {
    logger.info("ok", { a: 1, b: "two" });
    expect(outLines).toHaveLength(1);
    const parsed = JSON.parse(outLines[0]!.trim()) as Record<string, unknown>;
    expect(parsed.msg).toBe("ok");
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe("two");
  });

  it("breaks cycles instead of throwing TypeError", () => {
    const obj: Record<string, unknown> = { name: "cycler" };
    obj["self"] = obj;
    // Pre-fix: logger.error on a circular meta re-threw out of the catch
    // block, masking the original error. Post-fix: cycle is broken.
    expect(() => logger.error("cycled", { obj })).not.toThrow();
    expect(errLines).toHaveLength(1);
    const raw = errLines[0]!.trim();
    expect(raw).toContain("[Circular]");
    // Line must remain valid JSON.
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("coerces BigInt meta fields instead of throwing", () => {
    expect(() =>
      logger.warn("bigint-coerce", { count: 9007199254740993n }),
    ).not.toThrow();
    expect(errLines).toHaveLength(1);
    const parsed = JSON.parse(errLines[0]!.trim()) as Record<string, unknown>;
    // Coerced to string — not silently dropped.
    expect(parsed.count).toBe("9007199254740993");
  });
});

describe("logger.reloadLogLevel (F1.5)", () => {
  // MockInstance generic changed across vitest versions; capture the call
  // via the return value of vi.spyOn without restricting the generic.
  let outSpy: { mockRestore: () => void };
  let errSpy: { mockRestore: () => void };
  const outLines: string[] = [];
  const errLines: string[] = [];
  const origLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    outLines.length = 0;
    errLines.length = 0;
    outSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        outLines.push(String(chunk));
        return true;
      });
    errSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        errLines.push(String(chunk));
        return true;
      });
  });

  afterEach(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
    // Restore module-level state so other tests aren't affected.
    if (origLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = origLevel;
    reloadLogLevel();
  });

  it("picks up a new LOG_LEVEL after reload", () => {
    process.env.LOG_LEVEL = "error";
    reloadLogLevel();
    // Info is below error — should be suppressed.
    logger.info("should-be-suppressed");
    expect(outLines).toHaveLength(0);
    // Error still emits.
    logger.error("errored");
    expect(errLines).toHaveLength(1);
  });

  it("reloadLogLevel can flip back to debug", () => {
    process.env.LOG_LEVEL = "debug";
    reloadLogLevel();
    logger.debug("now-visible");
    expect(outLines.length).toBeGreaterThan(0);
  });

  it("reloadLogLevel with invalid LOG_LEVEL keeps 'info' and warns on stderr", () => {
    process.env.LOG_LEVEL = "verbose";
    reloadLogLevel();
    // Warning about invalid LOG_LEVEL is written to stderr.
    expect(errLines.some((l) => l.includes("invalid LOG_LEVEL"))).toBe(true);
    // And info-level still works.
    outLines.length = 0;
    logger.info("after-invalid-reload");
    expect(outLines).toHaveLength(1);
  });
});
