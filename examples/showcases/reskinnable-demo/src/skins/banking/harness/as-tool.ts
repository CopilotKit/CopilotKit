import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { fetchExpenseCsv } from "./csv";
import { buildHarnessPrompt } from "./prompt";
import { clearProgress, publishProgress } from "./progress";
import { createExpenseHarnessStream } from "./run";
import { HARNESS_RUN_CHANNEL } from "./types";
import type { HarnessProgressEvent, HarnessSummary } from "./types";
import { prepareWorkspace, readSummary } from "./workspace";

/**
 * ARM A. The harness as a `defineTool`.
 *
 * SERVER-SAFE: no client directive, no JSX, no React, no `.tsx` imports — it is
 * imported by banking's server-only agent module.
 *
 * The shape of this file IS the finding under comparison: `execute` returns one
 * resolved value, so every intermediate frame leaves through `publishProgress`
 * (a second transport) instead of the run's own event stream. Nothing here
 * reaches the thread, which is why a mid-run reload loses the journey and the
 * run replays as a single tool chip.
 *
 * Arm C deletes this file and hands `createExpenseHarnessStream` to the
 * runtime's tanstack factory instead.
 */

export interface HarnessDeps {
  channel: string;
  now: () => number;
  /**
   * Reads the statement CSV. Defaults to `fetchExpenseCsv`.
   *
   * It is a THUNK rather than the `csvText` string this originally took, because
   * the read has to happen INSIDE the published-error path: as a caller-supplied
   * string, a failing read threw in `execute` — after the channel had already
   * been cleared — so the console went blank with no `error` frame, which is the
   * precise failure the error-frame rule exists to prevent.
   */
  readCsv?: () => Promise<string>;
  createStream?: typeof createExpenseHarnessStream;
}

/**
 * The run that currently OWNS `HARNESS_RUN_CHANNEL`, or `null`.
 *
 * ONE run per instance, because the channel id is FIXED (see `types.ts`): two
 * live runs interleave their frames into one console and whichever finishes
 * first closes the stream for both.
 *
 * A second call SUPERSEDES the first rather than being refused, and that
 * direction is deliberate. `defineTool`'s `execute` is typed
 * `(args) => Promise<unknown>` — there is no cancellation hook at the tool
 * boundary, so nothing on the server ever hears that the presenter cancelled the
 * turn or reloaded the tab. A refusal therefore had NO RELEASE: the guard came
 * back only when the drain finished, i.e. when a codex run nobody was watching
 * finally ended, and every retry across those MINUTES was refused before a
 * console had even rendered — the stage showing nothing at all. Superseding
 * makes the second click work, and aborting the old signal is what actually
 * kills the codex process group (`run.ts` — that signal is the only thing that
 * reaches `killTree`).
 *
 * The cost accepted: a genuine double-send restarts the run instead of being
 * rejected. That is recoverable in one click; the lockout was not recoverable
 * without a server restart.
 */
let inFlight: AbortController | null = null;

/**
 * Chunk → console frame.
 *
 * The `type` strings and FIELD NAMES below are the ones Task 4's probe actually
 * observed against the real Codex binary
 * (`docs/superpowers/plans/2026-08-14-probe-findings.md`) — an earlier draft of
 * this plan guessed `type:"reasoning-delta"` reading `.text`, and every one of
 * those guesses was wrong. The stream emits AG-UI-shaped event names.
 *
 * Every field fact below was RE-MEASURED against the `claude` binary when this
 * arm changed engines, and all of them held. The only behavioural difference is
 * the one this arm changed engines FOR — see the `TOOL_CALL_END` case.
 *
 * Field facts that matter, all verified:
 *  - `REASONING_MESSAGE_CONTENT` carries `delta` ONLY. There is NO `content`
 *    field on it; reading `content` yields undefined and the console stays
 *    permanently empty while the harness works perfectly.
 *  - `RUN_ERROR` carries its cause as a STRING in `message`, and a rejected
 *    model (a 400) arrives as this CHUNK rather than as a throw — so the loop
 *    below ends normally and `readSummary` then reports "never wrote
 *    summary.json", which is a symptom, not the cause. Mapping it is the only
 *    way the real reason reaches the console.
 *  - Tool calls arrive ALREADY RESOLVED: START, ARGS and END are emitted
 *    back-to-back from one complete harness item with IDENTICAL timestamps, and
 *    the whole `args` JSON lands in a single chunk. So exactly one of the three
 *    may be rendered, and it is END — see the `TOOL_CALL_END` case. Re-measured
 *    on `claude-code`: the same three, in the same order.
 *  - `sandbox.file` and the engine's session id (`codex.session-id` /
 *    `claude-code.session-id`) ride INSIDE `type:"CUSTOM"`, discriminated by
 *    `name`. Matching `type === "sandbox.file"` never fires. Neither engine's
 *    name is read here — `CUSTOM` falls through to `null` — which is why
 *    switching engines needed no change in this mapper.
 *
 * A chunk the console does not render maps to `null` rather than a noise frame.
 */
export const mapChunkToProgress = (
  chunk: unknown,
): HarnessProgressEvent | null => {
  const c = chunk as {
    type?: string;
    delta?: string;
    message?: string;
    toolCallName?: string;
    toolName?: string;
    input?: unknown;
    name?: string;
    value?: unknown;
  };
  const at = Date.now();

  switch (c.type) {
    case "REASONING_MESSAGE_CONTENT":
      // `delta` only — see the note above.
      return c.delta ? { kind: "thinking", text: c.delta, at } : null;

    case "RUN_ERROR":
      return {
        kind: "error",
        message:
          c.message ??
          "The harness run failed and reported no message. Check the server log.",
        at,
      };

    /**
     * END, not START — deliberately, and the choice costs nothing.
     *
     * All three tool chunks share one timestamp, so rendering on END is not
     * later than rendering on START; it is the same instant. What END buys is
     * that ONE frame carries both halves: `toolCallName`/`toolName` for the
     * label AND the parsed arguments in `input`. START has the names but no
     * arguments, and `TOOL_CALL_ARGS` has the arguments but no name — pairing
     * them would need correlation state keyed by `toolCallId` for no gain.
     *
     * This also removes a duplicate: an earlier version rendered START *and*
     * `TOOL_CALL_ARGS`, so every tool call produced two frames — one labelled
     * and one labelled "args" — which contradicted the anti-duplication
     * rationale written directly above it. That second frame was also
     * double-encoded, because `TOOL_CALL_ARGS.args` is ALREADY a JSON string.
     *
     * ⚠ ONE HALF OF THAT REASONING WAS ENGINE-SPECIFIC AND IS NOW DEAD. Under
     * codex the args were also worthless — `web_search` arrived with an empty
     * query on every observed call, because that adapter reads the CLI's own
     * item schema and SYNTHESISES arguments it never receives. Arm A now runs
     * `claude-code`, which reads the model's `tool_use` blocks, so the real
     * query lands in both `TOOL_CALL_ARGS.args` and the `input` rendered below.
     * Recovering that query is the whole reason this arm changed engines. The
     * anti-duplication rule above still stands on its own.
     *
     * `input` is the parsed object, so it is the one to stringify.
     */
    case "TOOL_CALL_END": {
      const label = c.toolCallName ?? c.toolName ?? "tool";
      if (c.input === undefined) return { kind: "tool", label, at };
      return {
        kind: "tool",
        label,
        detail: JSON.stringify(c.input).slice(0, 160),
        at,
      };
    }

    default:
      return null;
  }
};

/** Drain the harness, republishing every frame, and read its verdict. */
export const runExpenseHarness = async (
  deps: HarnessDeps,
): Promise<HarnessSummary> => {
  // Take the channel from whoever holds it, and abort them FIRST so the old
  // codex process is killed before this one starts rather than two of them
  // racing for the same fixed channel id.
  inFlight?.abort(
    new Error(
      `Superseded by a newer harness run on channel "${HARNESS_RUN_CHANNEL}".`,
    ),
  );
  const controller = new AbortController();
  inFlight = controller;

  /**
   * Every publish is gated on STILL OWNING the channel.
   *
   * Without this, the superseded run's abort rejection lands in the NEW run's
   * console: its `catch` publishes an `error` frame after the new run has
   * cleared the buffer, and `error` is terminal — so the new console would close
   * instantly, reporting the death of a run the presenter already replaced.
   */
  const publishIfOwner = (event: HarnessProgressEvent): void => {
    if (inFlight === controller) publishProgress(deps.channel, event);
  };

  try {
    // Clear FIRST, before anything can publish. The channel id is fixed, so a
    // previous run's backlog would otherwise replay into this run's console —
    // and its trailing `done` frame closes the new console's stream instantly.
    // This lives here rather than in `execute` so that the constraint has a
    // regression test: `execute`'s channel is hardcoded, `deps.channel` is not.
    clearProgress(deps.channel);

    // Wall-clock, so an NTP step mid-run can skew the headline "this took
    // minutes" figure. Acceptable for a presenter demo (nothing branches on it),
    // and `Math.max(0, …)` below keeps a backwards step from rendering as a
    // negative duration. A monotonic clock would need a second injected dep for
    // a number nobody acts on.
    const startedAt = deps.now();
    const createStream = deps.createStream ?? createExpenseHarnessStream;
    const readCsv = deps.readCsv ?? fetchExpenseCsv;

    try {
      // Inside the try on purpose: a failed read is the most likely failure of
      // the whole run and it MUST leave an `error` frame behind.
      const csvText = await readCsv();
      const { dir, summaryPath } = await prepareWorkspace(csvText);

      const stream = createStream({
        dir,
        prompt: buildHarnessPrompt(),
        // The REAL signal, not a throwaway controller: `run.ts` documents this
        // as the only path to `killTree`, so a run that is superseded here is a
        // harness process group that actually dies rather than one that keeps
        // burning tokens with nobody listening.
        abortSignal: controller.signal,
        // ARM A RUNS CLAUDE CODE; Arm C passes nothing and keeps codex. The one
        // reason to spend an engine on this arm: codex's adapter synthesises the
        // `web_search` arguments it never receives, so the console's search
        // frames read `{"query":""}` — see the `TOOL_CALL_END` case below. This
        // engine reads the model's own `tool_use` blocks, so the real query
        // arrives. `run.ts` carries the model-pin warning that goes with it.
        engine: "claude-code",
      });

      for await (const chunk of stream) {
        const event = mapChunkToProgress(chunk);
        if (event) publishIfOwner(event);
      }

      const elapsedSeconds = Math.max(
        0,
        Math.round((deps.now() - startedAt) / 1000),
      );
      const summary = await readSummary(summaryPath, elapsedSeconds);
      publishIfOwner({ kind: "done", at: Date.now() });
      return summary;
    } catch (error) {
      // Publish BEFORE rethrowing: the console is the only place a presenter can
      // see why a four-minute run died, and silence here reads on stage as the
      // agent simply hanging.
      publishIfOwner({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
      throw error;
    }
  } finally {
    // Only the OWNER releases. A superseded run reaching its `finally` after the
    // new one started must not null out the new run's controller — that would
    // hand the channel to a third caller while the second is still writing.
    if (inFlight === controller) inFlight = null;
  }
};

/** The tool banking's classic agent registers under `EXPENSE_HARNESS_MODE`. */
export const analyzeExpensesTool = defineTool({
  name: "analyzeOffsiteExpenses",
  description:
    "Analyse the attached personal credit-card statement against the company " +
    "offsite: research each merchant on the web, decide which charges are " +
    "reimbursable, file the reimbursable ones, and return a summary. This runs " +
    "for SEVERAL MINUTES. Call it once and do not narrate the steps yourself.",
  // Everything this run needs is fixed, so `execute` is a one-liner: the fixed
  // channel is cleared, the CSV is read and every failure is reported inside
  // `runExpenseHarness`, where each of those steps has a test.
  parameters: z.object({}),
  execute: async () =>
    runExpenseHarness({
      channel: HARNESS_RUN_CHANNEL,
      now: () => Date.now(),
    }),
});
