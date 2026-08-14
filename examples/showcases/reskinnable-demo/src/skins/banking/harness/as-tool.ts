import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { buildHarnessPrompt } from "./prompt";
import { clearProgress, publishProgress } from "./progress";
import { createExpenseHarnessStream } from "./run";
import { EXPENSE_CSV_PUBLIC_PATH, HARNESS_RUN_CHANNEL } from "./types";
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
  csvText: string;
  now: () => number;
  createStream?: typeof createExpenseHarnessStream;
}

/**
 * Chunk → console frame.
 *
 * The `type` strings and FIELD NAMES below are the ones Task 4's probe actually
 * observed against the real Codex binary
 * (`docs/superpowers/plans/2026-08-14-probe-findings.md`) — an earlier draft of
 * this plan guessed `type:"reasoning-delta"` reading `.text`, and every one of
 * those guesses was wrong. The stream emits AG-UI-shaped event names.
 *
 * Field facts that matter, all verified:
 *  - `REASONING_MESSAGE_CONTENT` carries `delta` ONLY. There is NO `content`
 *    field on it; reading `content` yields undefined and the console stays
 *    permanently empty while the harness works perfectly.
 *  - `TOOL_CALL_START` carries BOTH `toolCallName` and `toolName`.
 *  - `TOOL_CALL_ARGS` carries `args` AND `delta`.
 *  - Tool calls arrive ALREADY RESOLVED (identical timestamps across
 *    START/ARGS/END), so START is the one to render — ARGS/END would duplicate.
 *  - `sandbox.file` and `codex.session-id` ride INSIDE `type:"CUSTOM"`,
 *    discriminated by `name`. Matching `type === "sandbox.file"` never fires.
 *
 * A chunk the console does not render maps to `null` rather than a noise frame.
 */
export const mapChunkToProgress = (
  chunk: unknown,
): HarnessProgressEvent | null => {
  const c = chunk as {
    type?: string;
    delta?: string;
    toolCallName?: string;
    toolName?: string;
    args?: unknown;
    name?: string;
    value?: unknown;
  };
  const at = Date.now();

  switch (c.type) {
    case "REASONING_MESSAGE_CONTENT":
      // `delta` only — see the note above.
      return c.delta ? { kind: "thinking", text: c.delta, at } : null;

    case "TOOL_CALL_START":
      // Render on START only: ARGS and END share its timestamp and would
      // triple every tool call in the console.
      return {
        kind: "tool",
        label: c.toolCallName ?? c.toolName ?? "tool",
        at,
      };

    case "TOOL_CALL_ARGS":
      // Args arrive whole rather than streaming, so attach them as the detail
      // of their own frame instead of trying to accumulate deltas.
      return c.args
        ? {
            kind: "tool",
            label: "args",
            detail: JSON.stringify(c.args).slice(0, 160),
            at,
          }
        : null;

    default:
      return null;
  }
};

/** Drain the harness, republishing every frame, and read its verdict. */
export const runExpenseHarness = async (
  deps: HarnessDeps,
): Promise<HarnessSummary> => {
  const startedAt = deps.now();
  const { dir, summaryPath } = await prepareWorkspace(deps.csvText);
  const createStream = deps.createStream ?? createExpenseHarnessStream;

  try {
    const stream = createStream({
      dir,
      prompt: buildHarnessPrompt(),
      abortSignal: new AbortController().signal,
    });

    for await (const chunk of stream) {
      const event = mapChunkToProgress(chunk);
      if (event) publishProgress(deps.channel, event);
    }

    const elapsedSeconds = Math.round((deps.now() - startedAt) / 1000);
    const summary = await readSummary(summaryPath, elapsedSeconds);
    publishProgress(deps.channel, { kind: "done", at: Date.now() });
    return summary;
  } catch (error) {
    // Publish BEFORE rethrowing: the console is the only place a presenter can
    // see why a four-minute run died, and silence here reads on stage as the
    // agent simply hanging.
    publishProgress(deps.channel, {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    });
    throw error;
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
  parameters: z.object({}),
  execute: async () => {
    // Clear first: the channel is a fixed id, so a previous run's frames would
    // otherwise replay into this run's console — and that backlog's trailing
    // `done` frame closes the new console's stream instantly.
    clearProgress(HARNESS_RUN_CHANNEL);

    const csvText = await fetch(
      `http://localhost:${process.env.PORT ?? 3000}${EXPENSE_CSV_PUBLIC_PATH}`,
    ).then((response) => response.text());

    return runExpenseHarness({
      channel: HARNESS_RUN_CHANNEL,
      csvText,
      now: () => Date.now(),
    });
  },
});
