import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapChunkToProgress, runExpenseHarness } from "./as-tool";
import { clearProgress, readProgress } from "./progress";

/**
 * The chunk `type` strings and FIELD NAMES asserted here are the ones Task 4's
 * probe OBSERVED against the real Codex binary
 * (`docs/superpowers/plans/2026-08-14-probe-findings.md`), not guesses. An
 * earlier draft of this plan guessed `type:"reasoning-delta"` reading `.text`
 * and was wrong on every one. Do not "tidy" a name here without re-running the
 * probe: a mapper matching strings the harness never emits yields a
 * permanently-empty console while the harness works perfectly.
 */

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

  it("maps TOOL_CALL_START to a tool frame using toolCallName", () => {
    expect(
      mapChunkToProgress({
        type: "TOOL_CALL_START",
        toolCallName: "web_search",
        toolName: "web_search",
      }),
    ).toMatchObject({ kind: "tool", label: "web_search" });
  });

  it("returns null for a chunk the console does not render", () => {
    expect(mapChunkToProgress({ type: "TEXT_MESSAGE_END" })).toBeNull();
  });
});

describe("runExpenseHarness", () => {
  it("publishes progress while running and returns the summary", async () => {
    const channel = "tool-test-1";
    clearProgress(channel);

    const summary = await runExpenseHarness({
      channel,
      csvText: "date,merchant,amount,city,card_last4,description\n",
      now: () => 0,
      // Stands in for Codex: two chunks, then write summary.json as a real run
      // would. Asserting on a mocked Codex stream would test the mock, so this
      // covers only OUR drain/publish/read logic.
      createStream: ({ dir }) => ({
        async *[Symbol.asyncIterator]() {
          yield { type: "REASONING_MESSAGE_CONTENT", delta: "reading csv" };
          yield { type: "TOOL_CALL_START", toolCallName: "web_search" };
          await writeFile(
            join(dir, "summary.json"),
            JSON.stringify({
              rowsRead: 1,
              merchantsSearched: 1,
              totalExpensable: 0,
              totalPersonal: 0,
              // NOT `[]`, deliberately. `readSummary` REJECTS a zero-verdict
              // summary (a hollow report card renders identically to a correct
              // one), so an empty array here would exercise the throw path and
              // never reach the `done` frame this case is about.
              verdicts: [
                {
                  merchant: "Copper Room",
                  date: "2026-07-15",
                  amount: 0,
                  decision: "personal",
                  reason: "fixture",
                },
              ],
            }),
            "utf8",
          );
        },
      }),
    });

    expect(summary.merchantsSearched).toBe(1);
    const frames = readProgress(channel).map((f) => f.kind);
    expect(frames).toContain("thinking");
    expect(frames).toContain("tool");
    expect(frames.at(-1)).toBe("done");
  });

  it("publishes an error frame and rethrows when nothing was written", async () => {
    const channel = "tool-test-2";
    clearProgress(channel);

    await expect(
      runExpenseHarness({
        channel,
        csvText: "x\n",
        now: () => 0,
        createStream: () => ({
          async *[Symbol.asyncIterator]() {
            yield { type: "REASONING_MESSAGE_CONTENT", delta: "giving up" };
          },
        }),
      }),
    ).rejects.toThrow(/never wrote summary\.json/);

    expect(readProgress(channel).at(-1)).toMatchObject({ kind: "error" });
  });
});
