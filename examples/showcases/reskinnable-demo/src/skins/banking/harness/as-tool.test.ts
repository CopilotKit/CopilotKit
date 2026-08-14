import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapChunkToProgress, runExpenseHarness } from "./as-tool";
import { clearProgress, publishProgress, readProgress } from "./progress";

/**
 * The chunk `type` strings and FIELD NAMES asserted here are the ones Task 4's
 * probe OBSERVED against the real Codex binary
 * (`docs/superpowers/plans/2026-08-14-probe-findings.md`), not guesses. An
 * earlier draft of this plan guessed `type:"reasoning-delta"` reading `.text`
 * and was wrong on every one. Do not "tidy" a name here without re-running the
 * probe: a mapper matching strings the harness never emits yields a
 * permanently-empty console while the harness works perfectly.
 */

/**
 * A summary the shape guard in `workspace.ts` accepts. NOT `verdicts: []` —
 * `readSummary` REJECTS a zero-verdict summary (a hollow report card renders
 * identically to a correct one), so an empty array would send every happy-path
 * case down the throw path.
 */
const VALID_SUMMARY = {
  rowsRead: 1,
  merchantsSearched: 1,
  totalExpensable: 0,
  totalPersonal: 0,
  verdicts: [
    {
      merchant: "Copper Room",
      date: "2026-07-15",
      amount: 0,
      decision: "personal",
      reason: "fixture",
    },
  ],
};

/** Stands in for Codex: yield the given chunks, then write `summary.json`. */
const streamOf =
  (chunks: unknown[], summary: unknown = VALID_SUMMARY) =>
  ({ dir }: { dir: string }) => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
      await writeFile(
        join(dir, "summary.json"),
        JSON.stringify(summary),
        "utf8",
      );
    },
  });

describe("mapChunkToProgress", () => {
  it("maps a reasoning chunk to a thinking frame, reading `delta`", () => {
    expect(
      mapChunkToProgress({
        type: "REASONING_MESSAGE_CONTENT",
        delta: "**Searching exact address**",
      }),
    ).toMatchObject({ kind: "thinking", text: "**Searching exact address**" });
  });

  it("ignores a reasoning chunk that carries `content` but no `delta`", () => {
    // Guards the exact bug the probe caught: this event has NO `content` field,
    // so a mapper reading `content` yields a permanently-empty console while the
    // harness works perfectly. If someone reintroduces that, this fails.
    expect(
      mapChunkToProgress({
        type: "REASONING_MESSAGE_CONTENT",
        content: "should be ignored",
      }),
    ).toBeNull();
  });

  it("maps TOOL_CALL_END to a tool frame using toolCallName and `input`", () => {
    // END rather than START: all three tool chunks share one timestamp, and END
    // is the only one carrying BOTH the name and the parsed arguments.
    expect(
      mapChunkToProgress({
        type: "TOOL_CALL_END",
        toolCallName: "web_search",
        toolName: "web_search",
        input: { query: "copper room austin" },
      }),
    ).toMatchObject({
      kind: "tool",
      label: "web_search",
      detail: '{"query":"copper room austin"}',
    });
  });

  it("renders a tool call ONCE, on END — START and ARGS are not frames", () => {
    // Tool calls arrive already resolved, so all three chunks describe one call.
    // Rendering more than one of them triples every tool call in the console.
    expect(
      mapChunkToProgress({
        type: "TOOL_CALL_START",
        toolCallId: "exec-1",
        toolCallName: "web_search",
        toolName: "web_search",
      }),
    ).toBeNull();
    expect(
      mapChunkToProgress({
        type: "TOOL_CALL_ARGS",
        toolCallId: "exec-1",
        // Already a JSON STRING on the wire, so stringifying it double-encodes.
        args: '{"query":""}',
        delta: '{"query":""}',
      }),
    ).toBeNull();
  });

  it("maps RUN_ERROR to an error frame carrying `message`", () => {
    // A rejected model arrives as this CHUNK, not as a throw. Dropping it leaves
    // the presenter with readSummary's "never wrote summary.json" — the symptom
    // — while the actual 400 is discarded.
    expect(
      mapChunkToProgress({
        type: "RUN_ERROR",
        message:
          '{"error":"The \'gpt-5.1-codex\' model is not supported when using Codex with a ChatGPT account"}',
      }),
    ).toMatchObject({
      kind: "error",
      message: expect.stringContaining("is not supported"),
    });
  });

  it("returns null for a chunk the console does not render", () => {
    expect(mapChunkToProgress({ type: "TEXT_MESSAGE_END" })).toBeNull();
  });
});

describe("runExpenseHarness", () => {
  it("publishes progress while running and returns the summary", async () => {
    const channel = "tool-test-1";
    clearProgress(channel);

    // A STEPPING clock, so the elapsed arithmetic is actually exercised: with a
    // frozen `() => 0` the sum is `0 - 0` and a startedAt/now inversion or a
    // sign flip would pass green.
    const times = [0, 125_000];
    const summary = await runExpenseHarness({
      channel,
      now: () => times.shift() ?? 125_000,
      readCsv: async () => "date,merchant,amount,city,card_last4,description\n",
      // Asserting on a mocked Codex stream would test the mock, so this covers
      // only OUR drain/publish/read logic.
      createStream: streamOf([
        { type: "REASONING_MESSAGE_CONTENT", delta: "reading csv" },
        { type: "TOOL_CALL_END", toolCallName: "web_search", input: {} },
      ]),
    });

    expect(summary.merchantsSearched).toBe(1);
    expect(summary.elapsedSeconds).toBe(125);
    const frames = readProgress(channel).map((f) => f.kind);
    expect(frames).toContain("thinking");
    expect(frames).toContain("tool");
    expect(frames.at(-1)).toBe("done");
  });

  it("never reports a negative duration when the clock steps backwards", async () => {
    const channel = "tool-test-clock";
    const times = [10_000, 4_000];
    const summary = await runExpenseHarness({
      channel,
      now: () => times.shift() ?? 4_000,
      readCsv: async () => "x\n",
      createStream: streamOf([]),
    });

    expect(summary.elapsedSeconds).toBe(0);
  });

  it("clears the channel before this run publishes anything", async () => {
    // The one constraint whose breach is SILENT: the channel id is fixed, so a
    // stale backlog replays into the new console and its trailing `done` closes
    // the stream instantly — the console looks finished before the run starts.
    const channel = "tool-test-clear";
    clearProgress(channel);
    publishProgress(channel, { kind: "done", at: 1 });
    publishProgress(channel, { kind: "thinking", text: "stale", at: 2 });

    await runExpenseHarness({
      channel,
      now: () => 0,
      readCsv: async () => "x\n",
      createStream: streamOf([
        { type: "REASONING_MESSAGE_CONTENT", delta: "fresh" },
      ]),
    });

    const frames = readProgress(channel);
    expect(frames.map((f) => f.kind)).toEqual(["thinking", "done"]);
    expect(frames[0]).toMatchObject({ text: "fresh" });
  });

  it("publishes an error frame and rethrows when nothing was written", async () => {
    const channel = "tool-test-2";
    clearProgress(channel);

    await expect(
      runExpenseHarness({
        channel,
        now: () => 0,
        readCsv: async () => "x\n",
        createStream: () => ({
          async *[Symbol.asyncIterator]() {
            yield { type: "REASONING_MESSAGE_CONTENT", delta: "giving up" };
          },
        }),
      }),
    ).rejects.toThrow(/never wrote summary\.json/);

    expect(readProgress(channel).at(-1)).toMatchObject({ kind: "error" });
  });

  it("publishes an error frame when the CSV read fails", async () => {
    // The read is the likeliest failure of the whole run (wrong port, renamed
    // fixture). It used to happen in `execute`, OUTSIDE the published-error
    // path, so it blanked the console and left no frame explaining why.
    const channel = "tool-test-csv";
    clearProgress(channel);

    await expect(
      runExpenseHarness({
        channel,
        now: () => 0,
        readCsv: async () => {
          throw new Error("GET /sample-expenses-offsite.csv returned 404");
        },
        createStream: streamOf([]),
      }),
    ).rejects.toThrow(/returned 404/);

    expect(readProgress(channel).at(-1)).toMatchObject({
      kind: "error",
      message: expect.stringContaining("404"),
    });
  });

  it("refuses a second concurrent run without touching either console", async () => {
    // Deterministic without a gate: the in-flight flag is set synchronously,
    // before `runExpenseHarness`'s first await, so the second call is refused
    // while the first is unavoidably still in flight.
    const channel = "tool-test-concurrent";
    const rival = "tool-test-concurrent-rival";
    clearProgress(channel);
    clearProgress(rival);

    const first = runExpenseHarness({
      channel,
      now: () => 0,
      readCsv: async () => "x\n",
      createStream: streamOf([
        { type: "REASONING_MESSAGE_CONTENT", delta: "first run" },
      ]),
    });

    await expect(
      runExpenseHarness({
        channel: rival,
        now: () => 0,
        readCsv: async () => "x\n",
        createStream: streamOf([]),
      }),
    ).rejects.toThrow(/already in flight/);

    // The refusal must publish NOTHING: an `error` frame here would read as the
    // live run dying, and on the real fixed channel it would also wipe it.
    expect(readProgress(rival)).toHaveLength(0);

    await expect(first).resolves.toMatchObject({ merchantsSearched: 1 });
    expect(readProgress(channel).at(-1)).toMatchObject({ kind: "done" });
  });

  it("releases the in-flight guard after a failed run", async () => {
    const channel = "tool-test-release";
    clearProgress(channel);

    await expect(
      runExpenseHarness({
        channel,
        now: () => 0,
        readCsv: async () => {
          throw new Error("boom");
        },
        createStream: streamOf([]),
      }),
    ).rejects.toThrow("boom");

    // A guard that leaks on the error path would lock the demo out until the
    // server restarts, so the next run must still be allowed to start.
    const summary = await runExpenseHarness({
      channel,
      now: () => 0,
      readCsv: async () => "x\n",
      createStream: streamOf([]),
    });
    expect(summary.rowsRead).toBe(1);
  });
});
