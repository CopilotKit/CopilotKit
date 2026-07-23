import { describe, it, expect, vi } from "vitest";
import { emitAggregate, sideEmit } from "./d6-emit.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";
import type {
  E2eFullFeatureSignal,
  E2eFullAggregateSignal,
} from "../drivers/d6-all-pills.js";
import { logger } from "../../logger.js";

// ---------------------------------------------------------------------------
// Fake ctx builder — mirrors the pattern used in d6-all-pills.test.ts
// ---------------------------------------------------------------------------

function makeCtx(overrides?: { writer?: ProbeResultWriter }): ProbeContext {
  return {
    now: () => new Date("2025-01-01T00:00:00Z"),
    logger,
    env: {},
    writer: overrides?.writer,
  };
}

function makeWriter(): {
  writer: ProbeResultWriter;
  rows: ProbeResult<unknown>[];
} {
  const rows: ProbeResult<unknown>[] = [];
  const writer: ProbeResultWriter = {
    write: async (r) => {
      rows.push(r);
    },
  };
  return { writer, rows };
}

const NOW = "2025-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// sideEmit
// ---------------------------------------------------------------------------

describe("sideEmit", () => {
  it("writes the feature result to ctx.writer with exact key shape d6:<slug>/<ft>", async () => {
    const { writer, rows } = makeWriter();
    const ctx = makeCtx({ writer });

    const result: ProbeResult<E2eFullFeatureSignal> = {
      key: "d6:test-slug/agentic-chat",
      state: "green",
      signal: {
        slug: "test-slug",
        featureType: "agentic-chat",
        backendUrl: "https://example.com",
      },
      observedAt: NOW,
    };

    await sideEmit(ctx, result);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe("d6:test-slug/agentic-chat");
    expect(rows[0]!.state).toBe("green");
    const signal = rows[0]!.signal as E2eFullFeatureSignal;
    expect(signal.slug).toBe("test-slug");
    expect(signal.featureType).toBe("agentic-chat");
  });

  it("writes red feature rows with correct key and signal shape", async () => {
    const { writer, rows } = makeWriter();
    const ctx = makeCtx({ writer });

    const result: ProbeResult<E2eFullFeatureSignal> = {
      key: "d6:langgraph-python/tool-rendering",
      state: "red",
      signal: {
        slug: "langgraph-python",
        featureType: "tool-rendering",
        backendUrl: "https://lgp.example.com",
        errorClass: "missing-script",
        errorDesc: "no script",
      },
      observedAt: NOW,
    };

    await sideEmit(ctx, result);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe("d6:langgraph-python/tool-rendering");
    expect(rows[0]!.state).toBe("red");
    const signal = rows[0]!.signal as E2eFullFeatureSignal;
    expect(signal.errorClass).toBe("missing-script");
  });

  it("logs a warning and does not throw when ctx.writer is absent", async () => {
    const ctx = makeCtx(); // no writer
    const warnSpy = vi.spyOn(ctx.logger, "warn");

    const result: ProbeResult<E2eFullFeatureSignal> = {
      key: "d6:test-slug/agentic-chat",
      state: "green",
      signal: {
        slug: "test-slug",
        featureType: "agentic-chat",
        backendUrl: "https://x.com",
      },
      observedAt: NOW,
    };

    await expect(sideEmit(ctx, result)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "probe.e2e-full.writer-missing",
      expect.objectContaining({ key: "d6:test-slug/agentic-chat" }),
    );
  });

  it("logs an error and does not throw when writer.write rejects", async () => {
    const writer: ProbeResultWriter = {
      write: async () => {
        throw new Error("write boom");
      },
    };
    const ctx = makeCtx({ writer });
    const errorSpy = vi.spyOn(ctx.logger, "error");

    const result: ProbeResult<E2eFullFeatureSignal> = {
      key: "d6:test-slug/agentic-chat",
      state: "green",
      signal: {
        slug: "test-slug",
        featureType: "agentic-chat",
        backendUrl: "https://x.com",
      },
      observedAt: NOW,
    };

    await expect(sideEmit(ctx, result)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "probe.e2e-full.side-emit-writer-failed",
      expect.objectContaining({ key: "d6:test-slug/agentic-chat" }),
    );
  });
});

// ---------------------------------------------------------------------------
// emitAggregate
// ---------------------------------------------------------------------------

describe("emitAggregate", () => {
  it("writes aggregate row with key d6:<slug> when rowPrefix is d6", async () => {
    const { writer, rows } = makeWriter();
    const ctx = makeCtx({ writer });

    const aggResult: ProbeResult<E2eFullAggregateSignal> = {
      key: "d6-all-pills-e2e:showcase-test-slug",
      state: "green",
      signal: {
        shape: "package",
        slug: "test-slug",
        backendUrl: "https://example.com",
        total: 2,
        passed: 2,
        failed: [],
        skipped: [],
      },
      observedAt: NOW,
    };

    await emitAggregate(ctx, "test-slug", aggResult, "d6");

    expect(rows).toHaveLength(1);
    // Exact key: d6:<slug>
    expect(rows[0]!.key).toBe("d6:test-slug");
    expect(rows[0]!.state).toBe("green");
    const signal = rows[0]!.signal as E2eFullAggregateSignal;
    expect(signal.slug).toBe("test-slug");
    expect(signal.passed).toBe(2);
    expect(signal.failed).toEqual([]);
    expect(signal.total).toBe(2);
    // observedAt forwarded unchanged
    expect(rows[0]!.observedAt).toBe(NOW);
  });

  it("writes aggregate row with key d5:<slug> when rowPrefix is d5", async () => {
    const { writer, rows } = makeWriter();
    const ctx = makeCtx({ writer });

    const aggResult: ProbeResult<E2eFullAggregateSignal> = {
      key: "d5-single-pill-e2e:showcase-test-slug",
      state: "red",
      signal: {
        shape: "package",
        slug: "test-slug",
        backendUrl: "https://example.com",
        total: 1,
        passed: 0,
        failed: ["agentic-chat"],
        skipped: [],
      },
      observedAt: NOW,
    };

    await emitAggregate(ctx, "test-slug", aggResult, "d5");

    expect(rows).toHaveLength(1);
    // Exact key: d5:<slug>
    expect(rows[0]!.key).toBe("d5:test-slug");
    expect(rows[0]!.state).toBe("red");
    const signal = rows[0]!.signal as E2eFullAggregateSignal;
    expect(signal.failed).toContain("agentic-chat");
  });

  it("logs a warning and does not throw when ctx.writer is absent", async () => {
    const ctx = makeCtx(); // no writer
    const warnSpy = vi.spyOn(ctx.logger, "warn");

    const aggResult: ProbeResult<E2eFullAggregateSignal> = {
      key: "d6-all-pills-e2e:showcase-test-slug",
      state: "green",
      signal: {
        shape: "package",
        slug: "test-slug",
        backendUrl: "https://x.com",
        total: 0,
        passed: 0,
        failed: [],
        skipped: [],
      },
      observedAt: NOW,
    };

    await expect(
      emitAggregate(ctx, "test-slug", aggResult, "d6"),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "probe.e2e-full.aggregate-writer-missing",
      expect.objectContaining({ key: "d6:test-slug" }),
    );
  });

  it("logs an error and does not throw when writer.write rejects", async () => {
    const writer: ProbeResultWriter = {
      write: async () => {
        throw new Error("aggregate write boom");
      },
    };
    const ctx = makeCtx({ writer });
    const errorSpy = vi.spyOn(ctx.logger, "error");

    const aggResult: ProbeResult<E2eFullAggregateSignal> = {
      key: "d6-all-pills-e2e:showcase-test-slug",
      state: "green",
      signal: {
        shape: "package",
        slug: "test-slug",
        backendUrl: "https://x.com",
        total: 0,
        passed: 0,
        failed: [],
        skipped: [],
      },
      observedAt: NOW,
    };

    await expect(
      emitAggregate(ctx, "test-slug", aggResult, "d6"),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "probe.e2e-full.aggregate-emit-failed",
      expect.objectContaining({ key: "d6:test-slug" }),
    );
  });
});
