/**
 * BEAT 6 — the strings the teach chain's cards settle with, and the rules that
 * read them back: the demonstration directive (written by the recorder, read by
 * the "Recorded N steps" card) and the two `respond()` directives for the "shall
 * I remember it?" card with the rule that classifies which one came back.
 *
 * Server-safe and React-free on purpose: these readers are the pieces of those
 * cards worth a unit test, and a pure module is testable without mounting a
 * provider, a thread and an agent registration.
 *
 * The rule the whole file exists to hold: a card states only what its producer
 * REPORTED. It never re-derives a fact by parsing the rendering — see each
 * reader's note for the bug that rule was written after.
 *
 * Why a classifier at all. BOTH buttons settle the tool with a string — "save
 * it" and "don't save" alike — so `typeof result === "string"` tells you the
 * card was answered and NOTHING about the answer. Branching on mere presence
 * printed the "Saved. I'll use this next time" receipt after a presenter clicked
 * "Don't save", asserting a durable write that never happened, and it
 * mis-rendered the same way on thread replay — which is exactly when beat 2 is
 * on screen. This is the misclassification the `issueRefund` card in `tools.tsx`
 * documents and forbids; the payoff of the teach-a-procedure beat is the one
 * place it must not happen.
 *
 * The payloads live here beside the classifier so the two cannot drift apart:
 * change a directive string and the matcher that reads it is in view.
 */

/**
 * BEAT 6, the demonstration hand-off: the directive `awaitDemonstration` settles
 * with, and the ONE way to read its step count back out.
 *
 * The recorder KNOWS how many steps it captured, so the directive REPORTS that
 * number and the card prints the reported number. The card used to re-derive it
 * by counting `/\d+\.\s/` matches in this very prose, which also counts any
 * numeral-dot-space a step LABEL happens to contain: a recorded
 * `Marked down Aurora Throw to 1. 50 under the floor` or
 * `Filed waiver MARGIN-EXEC-OK at 12.5 % margin` each added a phantom step, so
 * the card announced more steps than the list printed under it — in the one beat
 * whose whole claim is that the recording is faithful.
 *
 * The count has to travel INSIDE the directive because that string is all the
 * card has on thread replay: the recording context is live-session state and is
 * empty by the time a reopened thread re-renders this card (rule 3 in
 * `tools.tsx`). Builder and reader therefore sit together — the wording below and
 * the pattern that reads it must never drift apart, and `teach-mode-directives.test`
 * round-trips them so they cannot.
 */
export function buildDemonstrationDirective({
  steps,
  code,
}: {
  /** The observed step labels, in order, exactly as the recorder captured them. */
  steps: string[];
  /** The waiver code the human actually filed, or `null` if none was captured. */
  code: string | null;
}): string {
  const observed = steps
    .map((label, index) => `${index + 1}. ${label}`)
    .join("\n");
  return (
    `The user finished after ${steps.length} ${steps.length === 1 ? "step" : "steps"}. ` +
    `Observed steps:\n${observed || "(nothing captured)"}\n` +
    (code
      ? `The waiver code they used was ${code}.`
      : "No waiver code was captured.")
  );
}

/**
 * The step count the directive above REPORTED, or `null` for any string that
 * carries none — a directive recorded before this contract existed, or a
 * paraphrase. `null` means "say nothing about a count", never "zero".
 *
 * Anchored at the START of the result on purpose: the count is read only from the
 * sentence the recorder wrote, so nothing inside a free-text step label can be
 * mistaken for it.
 */
export function readDemonstratedStepCount(result: unknown): number | null {
  if (typeof result !== "string") return null;
  const match = /^The user finished after (\d+) steps?\./.exec(result.trim());
  return match ? Number(match[1]) : null;
}

/** Settles the card when the user confirms. Directs the agent to persist. */
export const SAVE_PROCEDURE_CONFIRMED =
  "The user confirmed. Persist this with save_memory now (scope 'user', kind 'operational'), then say in one sentence that you have it.";

/** Settles the card when the user declines. Forbids the durable write. */
export const SAVE_PROCEDURE_DECLINED =
  "The user declined to save it. Do not call save_memory.";

/**
 * `pending` — not answered yet (render the live card).
 * `saved` — the user confirmed; the procedure was persisted.
 * `declined` — the user refused; NOTHING was written.
 * `unknown` — settled with a string neither directive explains. Never rendered
 * as a success: an unrecognized settle is not evidence of a write.
 */
export type SaveProcedureOutcome = "pending" | "saved" | "declined" | "unknown";

export function classifySaveProcedureResult(
  result: unknown,
): SaveProcedureOutcome {
  if (typeof result !== "string") return "pending";
  const text = result.trim();
  if (text.length === 0) return "pending";
  if (text === SAVE_PROCEDURE_CONFIRMED) return "saved";
  if (text === SAVE_PROCEDURE_DECLINED) return "declined";
  // Tolerate a paraphrase, but never GUESS "saved": a decline reads as a
  // decline, and only an explicit confirmation earns the receipt.
  if (/declined|do not call save_memory/i.test(text)) return "declined";
  if (/confirmed/i.test(text) && /save_memory/i.test(text)) return "saved";
  return "unknown";
}
