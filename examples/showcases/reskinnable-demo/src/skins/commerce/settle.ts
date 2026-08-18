/**
 * How this skin reports a write that did not go the way it was supposed to.
 * Deliberately React-free so all of it can be unit-tested on its own.
 *
 * Two halves, one rule. The rule is that NO path may end without a result:
 *
 *  - `settleInterrupt` — every human-in-the-loop card's only way to call
 *    `respond`. An unsettled interrupt wedges the agent run (see below).
 *  - `narrateWrite` — every plain `useFrontendTool` write handler's wrapper. A
 *    handler that throws returns no result at all, so the agent cannot narrate
 *    the step and the room is shown a write that silently vanished.
 *
 * ── The HITL half ────────────────────────────────────────────────────────────
 *
 * An unsettled interrupt does not merely LOOK broken: it wedges the agent run.
 * The run blocks waiting for a response that will now never arrive, the card sits
 * on screen, and — the part that makes this expensive — nothing anywhere says so.
 * There are two ways a card lands there, and both are silent:
 *
 *  1. `respond` is OPTIONAL in `useHumanInTheLoop`'s render props. It is typed
 *     `undefined` while the tool arguments are still streaming (status
 *     `InProgress`) and again once the call is `Complete`. So the idiomatic
 *     `respond?.(message)` is a NO-OP precisely when the user clicks early: the
 *     button reacts, nothing is delivered, and the run hangs.
 *  2. `respond` returns a `Promise<void>` over a live SSE transport, so it can
 *     REJECT. A bare `respond?.(…)` drops that rejection on the floor, and an
 *     `await` with no `catch` propagates it out of a click handler where React
 *     will not render anything for it.
 *
 * So no card calls `respond` directly. Every one routes through
 * `settleInterrupt`, which resolves to `null` when the interrupt is settled and
 * to a human-readable sentence when it could not be. A card handed a sentence
 * MUST show it and re-enable its own controls: the run is still waiting, so
 * clicking again is the user's only path forward, and a card stuck on "Issuing…"
 * takes that away.
 */

/** The live half of `useHumanInTheLoop`'s `respond` union. */
export type RespondFn = (result: unknown) => Promise<void>;

/**
 * Appended to a mutation's result when the write landed but the follow-up
 * `refresh()` did NOT (see `refresh`'s contract in `data/ledger-context`).
 *
 * Every handler writes over REST and then re-reads the ledger, so a failed
 * re-read leaves the page showing pre-mutation rows while the receipt says the
 * work is done — the one failure mode indistinguishable from a slow network.
 * Rule 4 in `tools.tsx` still applies: this carries no figures and no ids, only
 * the fact that the screen is behind.
 *
 * It lives HERE rather than in `tools.tsx` because `refund.ts` needs it too:
 * beat 3a's write was lifted out of the render closure, so the only place that
 * knows whether its `refresh()` succeeded is inside `submitRefund`. One
 * definition, both callers — a second copy would drift.
 */
export const STALE_VIEW_NOTE =
  " The page could not be re-read afterwards, so it may still be showing the previous value — reload it to confirm.";

/** `""` on a good refresh, the note above on a failed one. */
export const staleNote = (refreshed: boolean) =>
  refreshed ? "" : STALE_VIEW_NOTE;

/** Whatever was thrown, as one short line fit to put in front of a user. */
export function describeError(error: unknown): string {
  // Never resolves to "" or to a bare "Error": these strings get appended to a
  // sentence shown to the user, and a dangling "Could not refund Dana: " reads
  // as a rendering bug rather than as a failure.
  if (error instanceof Error) return error.message.trim() || "unknown error";
  const text = String(error ?? "").trim();
  return text || "unknown error";
}

/**
 * Deliver `message` as this interrupt's result.
 *
 * @returns `null` once the interrupt is settled, or a sentence to show the user
 * explaining that it is NOT settled and they should retry. Never throws — a
 * throw from here would be the very failure it exists to prevent.
 */
export async function settleInterrupt(
  respond: RespondFn | undefined,
  message: string,
): Promise<string | null> {
  if (!respond) {
    // Not a theoretical branch: the card renders during `InProgress`, when the
    // arguments are still streaming and `respond` genuinely is undefined.
    console.error(
      "[commerce] cannot settle this interrupt — respond() is not available yet",
      { message },
    );
    return "I couldn't hand that back to the assistant — it wasn't ready to receive it yet. Try again.";
  }
  try {
    await respond(message);
    return null;
  } catch (error) {
    console.error("[commerce] settling the interrupt failed", error);
    return `I couldn't hand that back to the assistant: ${describeError(error)}. Try again.`;
  }
}

// ══ The plain-tool-handler half ════════════════════════════════════════════

/**
 * BEAT 5's partial-progress journal.
 *
 * The stored procedure is THREE separate tool calls against ONE order — hold it,
 * post the note, notify the customer. They land independently, so a transport
 * failure on the second leaves the ledger half-mutated, and the agent (which sees
 * nothing but tool results) cannot say so unless a result tells it. This map is
 * that memory: `narrateWrite` records each write that actually LANDED against the
 * record it landed on, and a later failure on the SAME record recites them.
 *
 * Module-level and unbounded, and neither is a leak:
 *
 *  - It is keyed by record id, so a failure only ever recites writes made against
 *    the record that failure was about. There is no "everything that ever
 *    happened" recital.
 *  - The presenter reset clears it EXPLICITLY — `resetLandedWrites()` in
 *    `runPresenterReset` (layout.tsx) — and then hard-navigates, a real document
 *    load which drops this module and the map with it.
 *
 * That second bullet used to read "the reset finishes with
 * `window.location.assign`, so there is no path that wipes the ledger and leaves
 * the journal behind", and it was FALSE. The reset route wipes the store as its
 * first act and can still answer 502 (memory wiped, not fully re-seeded) or throw
 * mid-sweep, and the old handler navigated on `res.ok` ALONE — so on exactly the
 * paths where the ledger had gone back to seed, the journal survived and the next
 * failure on one of those records recited writes the reset had taken away. Both
 * halves are now unconditional (see `runPresenterReset`), and the explicit clear
 * is what makes it true even if the navigation never lands.
 *
 * THE INVARIANT IT CAN CLAIM, precisely: a journal entry outlives the store only
 * through a wipe THIS DOCUMENT NEVER SAW — a `curl`/Playwright POST to
 * `dev/reset`, or a dev-server restart re-initialising the in-memory store. No
 * client-side code can observe either, and neither is on a presenter's path.
 */
const landedWrites = new Map<string, string[]>();

/** Every write `narrateWrite` saw land on `subject`, in the order they landed. */
export const landedWritesOn = (subject: string): readonly string[] =>
  landedWrites.get(subject) ?? [];

/**
 * Empty the journal.
 *
 * Two callers, and the first is production: `runPresenterReset` (layout.tsx)
 * calls it on every path where the server store was — or may have been — wiped,
 * because a journal entry whose record no longer exists is a recital of writes
 * that were reset away.
 *
 * The second is tests: the map is module-level, so it outlives an individual
 * `it` and one case's landed writes would otherwise be recited by the next
 * case's failure.
 */
export const resetLandedWrites = (): void => landedWrites.clear();

/** Opens every line `narrateWrite` emits for a write that did not complete. */
export const WRITE_FAILED_PREFIX = "Could not complete ";

/**
 * Every opening this skin's write handlers use to say the write did NOT happen:
 * the server refused it (`REFUSED…`), it was rejected on the wire
 * (`WRITE_FAILED_PREFIX`, a subset of `Could not…`), the route answered non-2xx
 * (`Could not hold the order (HTTP 500).`), or the record was never found at all
 * (`No order matches "9999".`).
 *
 * A closed set matched by prefix, because these lines are also read by the agent
 * and every one of them is written in this file's sibling `tools.tsx`. Adding a
 * handler with a fifth phrasing means adding it here.
 */
const WRITE_FAILURE_OPENING = /^(REFUSED\b|Could not\b|No [a-z]+ matches\b)/;

/**
 * True when a write tool's result reports that the write did NOT happen.
 *
 * The receipts use it to pick their tone. A failure line rendered under a green
 * tick is the same lie as showing no error at all: from the back of a room the
 * tick is what registers, not the sentence.
 */
export function isWriteFailureLine(result: unknown): boolean {
  return WRITE_FAILURE_OPENING.test(String(result ?? ""));
}

/**
 * What already landed on this record, for a failure that landed nothing itself.
 * Beat 5's value: "held the order, but could not post the note" is both more
 * useful on stage and more honest than a bare failure — the ledger really is
 * half-mutated, and nothing was rolled back.
 *
 * "and still stand" is an assertion about the SERVER, so it is only as true as
 * the journal's lifetime rule above: nothing rolls a landed write back, and the
 * presenter reset — the one thing that does take them away — empties this map
 * before it navigates. Do not soften this line into a hedge; make the clearing
 * hold instead. An unconditional "may or may not still stand" would gut the beat
 * for the sake of a case (an out-of-band `dev/reset`) that no presenter path
 * reaches.
 */
function priorWritesNote(subject: string | undefined): string {
  const prior = subject ? landedWritesOn(subject) : [];
  if (prior.length === 0) return "";
  return ` Earlier steps on this record did land and still stand: ${prior.join(", ")}.`;
}

/**
 * Run one write handler's body and ALWAYS resolve with a line the agent can
 * narrate — on success, on a refusal, and on a transport failure.
 *
 * Every handler in `tools.tsx` checked `!res.ok` and stopped there, which covers
 * a server that answered and nothing else. A `fetch` that REJECTS — offline
 * browser, dev server restarted mid-call, connection dropped — threw straight out
 * of the handler, so the agent got no result for that step at all. On beat 5's
 * chain that is the worst available shape of failure: one write visibly landed,
 * the next silently vanished, and nothing on screen or in the transcript says
 * which.
 *
 * ONE wrapper rather than seven try/catches, because seven copies is how the
 * eighth handler ships without one.
 *
 * @param attempt.action Noun phrase naming the write, completing "Could not
 * complete …" — e.g. `"the note on order 4463"`.
 * @param attempt.subject The record the write is against (an order id). Supply it
 * only where a CHAIN of writes shares one record; that shared key is the whole
 * reason the partial-progress recital means anything.
 * @param run The handler body. It is handed `landed`, which it MUST call the
 * moment the write is confirmed and MUST NOT call on a refusal: that call is the
 * only thing separating "never happened" from "happened, then the follow-up
 * broke", and the two get opposite receipts.
 */
export async function narrateWrite(
  attempt: { action: string; subject?: string },
  run: (landed: (what: string) => void) => Promise<string>,
): Promise<string> {
  // An object rather than a bare `let`: TypeScript narrows a variable that is
  // only ever assigned inside a closure to its initializer at the read site,
  // which would make the branch below unreachable in the type system.
  const state = { landed: false };
  const landed = (what: string) => {
    state.landed = true;
    if (!attempt.subject) return;
    const prior = landedWrites.get(attempt.subject) ?? [];
    // Re-running a step (the presenter repeats beat 5, or the agent retries)
    // must not list it twice.
    if (!prior.includes(what)) {
      landedWrites.set(attempt.subject, [...prior, what]);
    }
  };

  try {
    return await run(landed);
  } catch (error) {
    console.error(`[commerce] ${attempt.action} did not complete`, error);
    const reason = describeError(error);
    if (state.landed) {
      // The write itself is done and only what follows it broke. Reporting a
      // failure here would be a receipt AGAINST a write that really landed — the
      // mirror image of the replay bug `tools.tsx` calls out, and just as
      // dishonest. Note this line deliberately does NOT match
      // `isWriteFailureLine`.
      return `Completed ${attempt.action}, but the follow-up failed: ${reason}. The change itself did land.`;
    }
    return (
      `${WRITE_FAILED_PREFIX}${attempt.action}: ${reason}. Nothing came back, so treat it as not applied.` +
      priorWritesNote(attempt.subject)
    );
  }
}
