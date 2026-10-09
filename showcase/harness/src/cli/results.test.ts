import { describe, it, expect, vi, afterEach } from "vitest";
import {
  bestEffortWriter,
  createPbWriter,
  printResult,
  printSummary,
  probeResultToTerminal,
} from "./results.js";
import type { TerminalResult } from "./results.js";
import type { StatusWriter } from "../writers/status-writer.js";
import type { Logger, ProbeResult, WriteOutcome } from "../types/index.js";
import { createPbClient } from "../storage/pb-client.js";

// Wrap createPbClient in a PASSTHROUGH vi.fn so the B4 construction-failure
// tests can stub a throwing implementation for one call. Every other test
// gets the real implementation unchanged.
vi.mock("../storage/pb-client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../storage/pb-client.js")>();
  return { ...actual, createPbClient: vi.fn(actual.createPbClient) };
});

function fakeLogger(): {
  logger: Logger;
  warns: Array<{ msg: string; meta?: Record<string, unknown> }>;
} {
  const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
  const logger: Logger = {
    info: () => {},
    warn: (msg, meta) => warns.push({ msg, meta }),
    error: () => {},
    debug: () => {},
  };
  return { logger, warns };
}

function probeResult(): ProbeResult<unknown> {
  return {
    key: "smoke:mastra",
    state: "green",
    signal: { slug: "mastra" },
    observedAt: "2026-04-20T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// bestEffortWriter — the swallowing wrapper createPbWriter returns. A downed
// PB (rejecting inner writer) must resolve and log, never reject — that's the
// module-header "best-effort, never crashes the run" contract for ctx.writer
// consumers (drivers await ctx.writer.write outside any try/catch of ours).
// ---------------------------------------------------------------------------
describe("bestEffortWriter", () => {
  it("resolves and logs cli.pb-write-failed when the inner write rejects (downed PB)", async () => {
    const { logger, warns } = fakeLogger();
    class PbDownError extends Error {
      statusCode = 503;
    }
    const inner: StatusWriter = {
      write: async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      },
      writeOverlay: async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      },
    };
    const writer = bestEffortWriter(inner, logger);

    // Must resolve, not reject.
    const outcome = await writer.write(probeResult());

    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toBe("cli.pb-write-failed");
    expect(warns[0]!.meta?.key).toBe("smoke:mastra");
    // Detail preservation: serialized via errorInfo/serializeErr, so the
    // structured payload (message + HTTP status) survives, not just
    // String(err).
    const err = String(warns[0]!.meta?.err);
    expect(err).toContain("ECONNREFUSED");
    expect(err).toContain("503");

    // Synthesized outcome marks the tick as errored; nothing durable changed.
    expect(outcome.newState).toBe("error");
    expect(outcome.transition).toBe("error");
    // C1: the synthesized outcome must be distinguishable from a genuine
    // first-ever-error tick — `persisted: false` says "nothing was written;
    // errorStatePrev: null means unknown, not first-ever".
    expect(outcome.persisted).toBe(false);
  });

  it("resolves and logs cli.pb-write-failed when the inner writeOverlay rejects (downed PB)", async () => {
    const { logger, warns } = fakeLogger();
    class PbDownError extends Error {
      statusCode = 503;
    }
    const inner: StatusWriter = {
      write: async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      },
      writeOverlay: async () => {
        throw new PbDownError("fetch failed: ECONNREFUSED");
      },
    };
    const writer = bestEffortWriter(inner, logger);

    // Must resolve, not reject — same best-effort contract as write().
    const outcome = await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });

    expect(warns).toHaveLength(1);
    expect(warns[0]!.msg).toBe("cli.pb-write-failed");
    expect(warns[0]!.meta?.key).toBe("d6:mastra");
    const err = String(warns[0]!.meta?.err);
    expect(err).toContain("ECONNREFUSED");
    expect(err).toContain("503");

    // Synthesized outcome: nothing durable changed, no row to report. A2
    // (round 4): `persisted: false` distinguishes a swallowed PB outage
    // (nothing was written — row existence unknown) from a genuine
    // row-miss, which the real writer reports WITHOUT the discriminator.
    expect(outcome).toEqual({ applied: false, state: null, persisted: false });
  });

  it("counts every swallowed write/overlay failure on droppedWriteCount (A4 round 7)", async () => {
    // Red-green (round-7 A4): a LIVE writer's swallowed per-write failures
    // (downed PB mid-run) previously vanished behind per-write warns — the
    // summary's dropped-count only covered the init-failure stub, so a whole
    // run of swallowed writes reported "0 dropped".
    const { logger } = fakeLogger();
    const inner: StatusWriter = {
      write: async () => {
        throw new Error("fetch failed");
      },
      writeOverlay: async () => {
        throw new Error("fetch failed");
      },
    };
    const writer = bestEffortWriter(inner, logger);
    expect(writer.droppedWriteCount()).toBe(0);

    await writer.write(probeResult());
    await writer.write(probeResult()); // same key — counter is UNDEDUPED
    await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });

    expect(writer.droppedWriteCount()).toBe(3);
  });

  it("does not count successful writes as dropped (A4 round 7)", async () => {
    const { logger } = fakeLogger();
    const inner: StatusWriter = {
      write: async () => ({
        previousState: null,
        newState: "green" as const,
        transition: "first" as const,
        firstFailureAt: null,
        failCount: 0,
        persisted: true,
      }),
      writeOverlay: async () => ({
        applied: true,
        state: null,
        historyPersisted: true,
      }),
    };
    const writer = bestEffortWriter(inner, logger);
    await writer.write(probeResult());
    await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(writer.droppedWriteCount()).toBe(0);
  });

  it("passes through the inner outcome on success without logging", async () => {
    const { logger, warns } = fakeLogger();
    const innerOutcome: WriteOutcome = {
      previousState: null,
      newState: "green",
      transition: "first",
      firstFailureAt: null,
      failCount: 0,
      persisted: true,
    };
    const inner: StatusWriter = {
      write: async () => innerOutcome,
      writeOverlay: async () => ({
        applied: false,
        state: null,
        historyPersisted: false,
      }),
    };
    const writer = bestEffortWriter(inner, logger);

    const outcome = await writer.write(probeResult());

    expect(outcome).toBe(innerOutcome);
    expect(warns).toHaveLength(0);
    // A2 (round 4): `persisted` is required and truthful — a passed-through
    // durable success carries true (no more absence-encoding).
    expect(outcome.persisted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// printSummary — degraded vs failed split. Degraded is a distinct durable
// state (yellow `~` in per-line rendering); the summary must not conflate it
// with red/error under the red "Failed:" banner.
// ---------------------------------------------------------------------------
describe("printSummary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureSummary(results: TerminalResult[]): string {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printSummary(results);
    // Strip ANSI escapes so assertions read the visible text. A5(v):
    // `[0-9;]*` covers multi-parameter SGR sequences (e.g. \x1b[0;1m),
    // which the previous `[0-9]+` left in the output.
    // eslint-disable-next-line no-control-regex
    return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  }

  it("lists degraded under its own ~ Degraded: section, not Failed:", () => {
    const out = captureSummary([
      { key: "smoke:a", state: "green", durationMs: 100 },
      { key: "smoke:b", state: "degraded", durationMs: 200 },
      { key: "smoke:c", state: "red", durationMs: 300, error: "boom" },
      { key: "smoke:d", state: "error", durationMs: 400, error: "probe error" },
    ]);

    expect(out).toContain("1 passed");
    expect(out).toContain("1 degraded");
    expect(out).toContain("2 failed");
    expect(out).toContain("~ Degraded:");
    expect(out).toContain("Failed:");
    // smoke:b appears in the Degraded section only — never after Failed:.
    const failedSection = out.slice(out.indexOf("Failed:"));
    expect(failedSection).not.toContain("smoke:b");
    expect(failedSection).toContain("smoke:c");
    expect(failedSection).toContain("smoke:d");
    const degradedSection = out.slice(
      out.indexOf("~ Degraded:"),
      out.indexOf("Failed:"),
    );
    expect(degradedSection).toContain("smoke:b");
  });

  it("omits the Failed: section when only degraded results exist", () => {
    const out = captureSummary([
      { key: "smoke:a", state: "green", durationMs: 100 },
      { key: "smoke:b", state: "degraded", durationMs: 200 },
    ]);

    expect(out).toContain("1 passed");
    expect(out).toContain("1 degraded");
    expect(out).toContain("~ Degraded:");
    expect(out).not.toContain("Failed:");
    expect(out).not.toContain("failed");
  });

  it("prints the all-green summary without degraded or failed sections", () => {
    const out = captureSummary([
      { key: "smoke:a", state: "green", durationMs: 100 },
    ]);

    expect(out).toContain("1 passed");
    expect(out).not.toContain("degraded");
    expect(out).not.toContain("Failed:");
  });

  it("surfaces a non-zero PB-writer dropped-count (B1) so a dead PB writer is visible at end of run", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printSummary([{ key: "smoke:a", state: "green", durationMs: 100 }], {
      pbDroppedWrites: 3,
      pbWriterInitFailed: true,
    });
    // eslint-disable-next-line no-control-regex
    const out = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(out).toContain(
      "3 results not persisted to PocketBase (PB writer init failed)",
    );
  });

  it("distinguishes mid-run write failures from an init failure (A4 round 7)", () => {
    // Red-green (round-7 A4): the summary line previously always blamed
    // "PB writer init failed", lying about a LIVE writer whose individual
    // writes were swallowed (downed PB mid-run).
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printSummary([{ key: "smoke:a", state: "green", durationMs: 100 }], {
      pbDroppedWrites: 2,
    });
    // eslint-disable-next-line no-control-regex
    const out = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(out).toContain(
      "2 results not persisted to PocketBase (write failures during run)",
    );
    // The count renders ONCE (in "N results not persisted"), not again in
    // the cause clause.
    expect(out).not.toContain("(2 write failures");
    expect(out).not.toContain("init failed");
  });

  it("uses the singular forms for exactly one mid-run write failure", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printSummary([{ key: "smoke:a", state: "green", durationMs: 100 }], {
      pbDroppedWrites: 1,
    });
    // eslint-disable-next-line no-control-regex
    const out = lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    // BOTH nouns singularize: the count ("1 result", not "1 results") and
    // the cause ("write failure", not "write failures").
    expect(out).toContain(
      "1 result not persisted to PocketBase (write failure during run)",
    );
    expect(out).not.toContain("1 results");
  });

  it("omits the dropped-count line when zero or not provided", () => {
    const outZero = captureSummaryWithOpts(
      [{ key: "smoke:a", state: "green", durationMs: 100 }],
      { pbDroppedWrites: 0 },
    );
    expect(outZero).not.toContain("not persisted to PocketBase");
    const outOmitted = captureSummary([
      { key: "smoke:a", state: "green", durationMs: 100 },
    ]);
    expect(outOmitted).not.toContain("not persisted to PocketBase");
  });

  function captureSummaryWithOpts(
    results: TerminalResult[],
    opts: { pbDroppedWrites?: number },
  ): string {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printSummary(results, opts);
    // eslint-disable-next-line no-control-regex
    return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  }
});

// ---------------------------------------------------------------------------
// createPbWriter — construction is INSIDE the best-effort boundary (B4). The
// module-header contract is "a downed PB never crashes the run": a throwing
// createPbClient (bad URL, malformed config) previously crashed the CLI
// before any probe ran, because only the per-write path was wrapped.
// ---------------------------------------------------------------------------
describe("createPbWriter construction failure (B4)", () => {
  afterEach(() => {
    vi.mocked(createPbClient).mockReset();
  });

  it("returns a no-op writer (and warns) when createPbClient throws — never crashes the run", async () => {
    const { logger, warns } = fakeLogger();
    vi.mocked(createPbClient).mockImplementationOnce(() => {
      throw new Error("Invalid URL: not-a-url");
    });

    // Construction must not throw …
    const writer = createPbWriter(
      { url: "not-a-url", email: "e@x", password: "pw" },
      logger,
    );
    expect(
      warns.filter((w) => w.msg === "cli.pb-writer-init-failed"),
    ).toHaveLength(1);
    expect(String(warns[0]!.meta?.err)).toContain("Invalid URL");

    // … and the returned writer resolves synthesized outcomes, same shape as
    // the bestEffortWriter failure legs (persisted/applied false markers).
    const outcome = await writer.write(probeResult());
    expect(outcome.newState).toBe("error");
    expect(outcome.transition).toBe("error");
    expect(outcome.persisted).toBe(false);

    const overlayOutcome = await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(overlayOutcome).toEqual({
      applied: false,
      state: null,
      persisted: false,
    });
  });
});

// ---------------------------------------------------------------------------
// B1 (round 6): the init-failure no-op writer must not drop writes SILENTLY.
// One boot warn is not enough for a whole run's worth of results vanishing:
// every dropped write warns (deduped per key, bounded) naming the init
// failure, a dropped-count is tracked, and the CLI summary surfaces it.
// ---------------------------------------------------------------------------
describe("createPbWriter init-failure no-op writer drop visibility (B1)", () => {
  afterEach(() => {
    vi.mocked(createPbClient).mockReset();
  });

  function makeInitFailedWriter() {
    const { logger, warns } = fakeLogger();
    vi.mocked(createPbClient).mockImplementationOnce(() => {
      throw new Error("Invalid URL: not-a-url");
    });
    const writer = createPbWriter(
      { url: "not-a-url", email: "e@x", password: "pw" },
      logger,
    );
    return { writer, warns };
  }

  it("warns per dropped write, naming the init failure, deduped per key", async () => {
    const { writer, warns } = makeInitFailedWriter();

    await writer.write(probeResult()); // key smoke:mastra
    await writer.write(probeResult()); // same key — deduped
    await writer.write({ ...probeResult(), key: "smoke:agno" }); // new key

    const drops = warns.filter((w) => w.msg === "cli.pb-write-dropped");
    expect(drops).toHaveLength(2);
    expect(drops[0]!.meta?.key).toBe("smoke:mastra");
    expect(drops[1]!.meta?.key).toBe("smoke:agno");
    // The message must NAME the init failure so the operator knows why the
    // write was dropped (not a per-write outage — the writer never existed).
    expect(String(drops[0]!.meta?.hint)).toContain("init failed");
  });

  it("dedupes overlay drops on the same bounded per-key set as writes", async () => {
    const { writer, warns } = makeInitFailedWriter();

    await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });
    await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:01Z",
    });

    const drops = warns.filter((w) => w.msg === "cli.pb-write-dropped");
    expect(drops).toHaveLength(1);
    expect(drops[0]!.meta?.key).toBe("d6:mastra");
  });

  it("counts EVERY dropped write (write + writeOverlay), undeduped", async () => {
    const { writer } = makeInitFailedWriter();
    expect(writer.droppedWriteCount()).toBe(0);

    await writer.write(probeResult());
    await writer.write(probeResult());
    await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });

    expect(writer.droppedWriteCount()).toBe(3);
  });

  it("a successfully-constructed writer reports zero dropped writes (and initFailed:false)", async () => {
    const { logger } = fakeLogger();
    const writer = createPbWriter(
      { url: "http://127.0.0.1:8090", email: "e@x", password: "pw" },
      logger,
    );
    expect(writer.droppedWriteCount()).toBe(0);
    expect(writer.initFailed).toBe(false);
  });

  it("the init-failure writer reports initFailed:true", async () => {
    const { writer } = makeInitFailedWriter();
    expect(writer.initFailed).toBe(true);
  });

  it("a LIVE writer counts swallowed per-write failures through bestEffortWriter (A4 round 7)", async () => {
    // Red-green (round-7 A4): a successfully-constructed writer whose PB
    // goes down MID-RUN swallows every write (best-effort contract) — those
    // drops must reach the summary counter, not just per-write warns.
    const { logger } = fakeLogger();
    vi.mocked(createPbClient).mockImplementationOnce(
      () =>
        ({
          // The status-writer's first PB touch is the prior-row read;
          // throwing there fails every write/writeOverlay attempt.
          getFirst: async () => {
            throw new Error("fetch failed: ECONNREFUSED");
          },
        }) as unknown as ReturnType<typeof createPbClient>,
    );
    const writer = createPbWriter(
      { url: "http://127.0.0.1:8090", email: "e@x", password: "pw" },
      logger,
    );
    expect(writer.initFailed).toBe(false);
    expect(writer.droppedWriteCount()).toBe(0);

    await writer.write(probeResult());
    await writer.writeOverlay({
      key: "d6:mastra",
      signal: { overlay: true },
      observedAt: "2026-04-20T00:00:00Z",
    });

    expect(writer.droppedWriteCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// probeResultToTerminal / printResult — degraded error labelling (B3). The C3
// degraded/failed split must hold in the per-line detail too: degraded is NOT
// a failure, so it must not get a generic red "failed" detail label.
// ---------------------------------------------------------------------------
describe("degraded error labelling (B3)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives a degraded result NO generic fallback error label (not 'failed')", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "degraded",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    };
    const terminal = probeResultToTerminal(result);
    expect(terminal.error).toBeUndefined();
  });

  it("preserves a degraded result's own errorDesc detail", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "degraded",
      signal: { errorDesc: "2 of 10 pills flaked" },
      observedAt: "2026-04-20T00:00:00Z",
    };
    const terminal = probeResultToTerminal(result);
    expect(terminal.error).toBe("2 of 10 pills flaked");
  });

  it("keeps the generic 'failed' / 'probe error' fallbacks for red and error states", () => {
    const red = probeResultToTerminal({
      key: "smoke:mastra",
      state: "red",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(red.error).toBe("failed");
    const errored = probeResultToTerminal({
      key: "smoke:mastra",
      state: "error",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    });
    expect(errored.error).toBe("probe error");
  });

  it("renders a degraded result's error detail in YELLOW, not red", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printResult({
      key: "smoke:mastra",
      state: "degraded",
      durationMs: 100,
      error: "2 of 10 pills flaked",
    });
    const detail = lines.find((l) => l.includes("2 of 10 pills flaked"))!;
    expect(detail).toBeDefined();
    expect(detail).toContain("\x1b[33m"); // yellow — degraded-appropriate
    expect(detail).not.toContain("\x1b[31m"); // never the red failure colour
  });

  it("still renders a red result's error detail in RED", () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    printResult({
      key: "smoke:mastra",
      state: "red",
      durationMs: 100,
      error: "boom",
    });
    const detail = lines.find((l) => l.includes("boom"))!;
    expect(detail).toBeDefined();
    expect(detail).toContain("\x1b[31m");
  });
});

// ---------------------------------------------------------------------------
// probeResultToTerminal — duration extraction.
// ---------------------------------------------------------------------------
describe("probeResultToTerminal duration", () => {
  it("renders latencyMs === 0 as 0ms, not the wall-clock fallback", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: { latencyMs: 0 },
      observedAt: "2026-04-20T00:00:00Z",
    };
    // A startedAt well in the past: if the falsy-zero bug discards
    // latencyMs, the wall-clock fallback produces a large positive value.
    const terminal = probeResultToTerminal(result, Date.now() - 60_000);
    expect(terminal.durationMs).toBe(0);
  });

  it("falls back to wall-clock when latencyMs is non-finite", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: { latencyMs: Number.NaN },
      observedAt: "2026-04-20T00:00:00Z",
    };
    const terminal = probeResultToTerminal(result, Date.now() - 60_000);
    expect(terminal.durationMs).toBeGreaterThanOrEqual(60_000);
  });

  it("uses the wall clock for an explicit startedAt === 0 (epoch), not 0ms", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    };
    // An explicit epoch-0 startedAt is a provided wall-clock anchor: if the
    // falsy-zero bug discards it, durationMs collapses to 0 instead of the
    // (large) delta from epoch.
    const terminal = probeResultToTerminal(result, 0);
    expect(terminal.durationMs).toBeGreaterThan(0);
  });

  it("rejects an array-shaped signal (no Record cast, wall-clock fallback)", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: [{ latencyMs: 1234 }],
      observedAt: "2026-04-20T00:00:00Z",
    };
    // Arrays satisfy `typeof === "object"` but are not Records: the guard
    // must reject them (matching withCommErrorOverlay / status-writer
    // convention) so no array is cast to Record<string, unknown>.
    const terminal = probeResultToTerminal(result, Date.now() - 60_000);
    expect(terminal.signal).toBeUndefined();
    expect(terminal.durationMs).toBeGreaterThanOrEqual(60_000);
  });

  it("clamps a negative latencyMs to 0 (A5)", () => {
    // Red-green (round-4 A5iv): a clock-skewed/buggy probe can report a
    // negative latencyMs; it must render as 0, never a negative duration.
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: { latencyMs: -50 },
      observedAt: "2026-04-20T00:00:00Z",
    };
    const terminal = probeResultToTerminal(result, Date.now() - 60_000);
    expect(terminal.durationMs).toBe(0);
  });

  it("clamps a negative wall-clock delta to 0 (A5)", () => {
    // A startedAt ahead of Date.now() (clock adjustment mid-run) yields a
    // negative delta; clamp to 0.
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: {},
      observedAt: "2026-04-20T00:00:00Z",
    };
    const terminal = probeResultToTerminal(result, Date.now() + 60_000);
    expect(terminal.durationMs).toBe(0);
  });

  it("prefers a positive latencyMs over the wall-clock fallback", () => {
    const result: ProbeResult<unknown> = {
      key: "smoke:mastra",
      state: "green",
      signal: { latencyMs: 1234 },
      observedAt: "2026-04-20T00:00:00Z",
    };
    const terminal = probeResultToTerminal(result, Date.now() - 60_000);
    expect(terminal.durationMs).toBe(1234);
  });
});
