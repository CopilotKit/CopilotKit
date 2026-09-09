/**
 * BEAT 6 — the strings Meridian's teach chain settles with, and the rules that
 * read them back.
 *
 * Two pairs live here, each a BUILDER beside its READER so the two cannot drift:
 * the demonstration directive (written by the recorder, read by the "Recorded N
 * steps" card) and the two save directives (written by the card's buttons, read
 * by the classifier that decides which receipt to print).
 *
 * React-free and server-safe on purpose: these readers are the part of those
 * cards worth a unit test, and a pure module is testable without mounting a
 * provider, a thread and an agent registration. Modelled on
 * `src/skins/commerce/teach-mode-directives.ts`, which `docs/teach-mode/README.md`
 * names as the reference precisely because its replay behaviour is pinned by a
 * round-trip test rather than left to a hand-rolled render.
 *
 * The rule the whole file exists to hold: A CARD STATES ONLY WHAT ITS PRODUCER
 * REPORTED. It never re-derives a fact by parsing its own rendering, and it never
 * treats the mere PRESENCE of a settle as an answer.
 */

/**
 * The directive `awaitDemonstration` settles with, and the only supported way to
 * read its step count back out.
 *
 * The count travels INSIDE the string because that string is all the card has on
 * REPLAY: the recording context is live-session state and is empty by the time a
 * reopened thread re-renders the card — which is exactly when beat 2 ("threads
 * store AG-UI streams, not text") is on screen. A card that recounted the prose
 * would also miscount any step label containing a numeral, and freight labels
 * carry them constantly ("Released the expedite on PO-88213 — 1. 5 days saved").
 */
export function buildDemonstrationDirective({
  steps,
  code,
}: {
  /** The observed step labels, in order, exactly as the recorder captured them. */
  steps: string[];
  /** The escalation code the planner actually filed, or `null` if none. */
  code: string | null;
}): string {
  const observed = steps
    .map((label, index) => `${index + 1}. ${label}`)
    .join("\n");
  return (
    `The planner finished after ${steps.length} ${steps.length === 1 ? "step" : "steps"}. ` +
    `Observed steps:\n${observed || "(nothing captured)"}\n` +
    (code
      ? `The escalation code they filed was ${code}.`
      : "No escalation code was captured — ask the planner which code they used before saving anything.")
  );
}

/**
 * The step count the directive above REPORTED, or `null` for any string carrying
 * none (a thread recorded before this contract existed, or a paraphrase). `null`
 * means "say nothing about a count", never "zero".
 *
 * Anchored at the START of the result, so nothing inside a free-text step label
 * can be mistaken for the count.
 */
export function readDemonstratedStepCount(result: unknown): number | null {
  if (typeof result !== "string") return null;
  const match = /^The planner finished after (\d+) steps?\./.exec(
    result.trim(),
  );
  return match ? Number(match[1]) : null;
}

/**
 * Settles the save card when the planner confirms. Names the scope and kind
 * explicitly so the durable write cannot land in the wrong bucket.
 *
 * SCOPE IS `user`, NOT `project`, and that is load-bearing rather than a style
 * choice — read `intelligence/forget-memories.ts` before changing it. That sweep
 * deliberately SKIPS project-scoped rows, because project scope is global to the
 * shared Intelligence instance and deleting those would destroy a sibling skin's
 * seeded memories. So a beat-6 procedure saved at project scope would survive
 * every presenter reset, and the SECOND run of this demo would open with the
 * agent already knowing the answer: it would never decline, never offer to
 * record, and the beat would silently prove nothing. Beat 5's seeded procedure
 * is also `user`/`operational`; the two are kept apart by their TEXT (each says
 * plainly that it is not the other) and by the prompt clauses that route to
 * them, not by their scope.
 */
export const SAVE_PROCEDURE_CONFIRMED =
  "The planner confirmed. Persist this with save_memory now (scope 'user', kind 'operational'), then say in one sentence that you have it.";

/** Settles the save card when the planner declines. Forbids the durable write. */
export const SAVE_PROCEDURE_DECLINED =
  "The planner declined to save it. Do not call save_memory.";

/**
 * `pending` — not answered yet (render the live card).
 * `saved` — the planner confirmed; the procedure was persisted.
 * `declined` — the planner refused; NOTHING was written.
 * `unknown` — settled with a string neither directive explains. Never rendered
 * as a success: an unrecognized settle is not evidence of a write.
 */
export type SaveProcedureOutcome = "pending" | "saved" | "declined" | "unknown";

/**
 * BOTH buttons settle this card with a string, so `typeof result === "string"`
 * says the card was answered and NOTHING about the answer. Branching on presence
 * prints "Saved — I'll use this next time" after the presenter clicked "Don't
 * save": a durable write asserted on stage that never happened, and it
 * mis-renders the same way on every later replay of the thread.
 */
export function classifySaveProcedureResult(
  result: unknown,
): SaveProcedureOutcome {
  if (typeof result !== "string") return "pending";
  const text = result.trim();
  if (text.length === 0) return "pending";
  if (text === SAVE_PROCEDURE_CONFIRMED) return "saved";
  if (text === SAVE_PROCEDURE_DECLINED) return "declined";
  // Tolerate a paraphrase, but never GUESS "saved": a decline must read as a
  // decline, and only an explicit confirmation earns the receipt.
  if (/declined|do not call save_memory/i.test(text)) return "declined";
  if (/confirmed/i.test(text) && /save_memory/i.test(text)) return "saved";
  return "unknown";
}

/**
 * The directive `offerWorkflowRecording` settles with on each button, plus the
 * reader. Same rule as the save pair: the card must not print the raw string —
 * it is an instruction addressed to the AGENT, and putting the demo's own wiring
 * on screen in front of the room is its own failure.
 */
export const OFFER_ACCEPTED =
  "The planner agreed to demonstrate. Call awaitDemonstration now and wait — do not guess any steps and do not tell them where to click.";

export const OFFER_DECLINED =
  "The planner declined to demonstrate. Stop here and do not retry the blocked mitigation.";

export function readOfferAccepted(result: unknown): boolean {
  return typeof result === "string" && /agreed to demonstrate/i.test(result);
}
