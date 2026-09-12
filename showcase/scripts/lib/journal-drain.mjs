// Journal-drain barrier for aimock fixture capture.
//
// A probe marks a cell satisfied as soon as the tool card meets the assertion,
// but the POST-tool-result LLM turn can still be draining (aimock still
// proxying upstream + writing the fixture) after the probe process exits. If a
// capture flow moves fixtures / restarts aimock at that instant, the late
// fixture lands in the NEXT run's directory. This module lets any capture flow
// (D5's `record-d5-fixtures.mjs`, or a hand-run D4 proxy-capture — see
// `showcase/aimock/README.md`) block until the run has fully drained first.
//
// Kept as plain `.mjs` (no TS) so it is importable both from the plain-`node`
// recorder CLI and from vitest without a transpile step.

// Host-side URL of the aimock request journal. docker-compose.local.yml maps
// the aimock container's port 4010 to localhost:4010, so a recorder driving a
// capture reaches the journal here. Overridable for tests / non-default
// topologies via AIMOCK_URL.
const AIMOCK_BASE_URL = process.env.AIMOCK_URL ?? "http://localhost:4010";
export const JOURNAL_URL = `${AIMOCK_BASE_URL.replace(/\/+$/, "")}/__aimock/journal`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True when a journal entry represents a fully-DRAINED upstream turn — aimock
 * has finished serving the request AND written any fixture it produced to disk.
 *
 * The ONLY sound journal signal for that is the RECORD (proxy) path:
 *   - RECORD mode: no fixture matched, aimock proxied to the real provider,
 *     awaited the ENTIRE upstream stream, wrote the fixture to disk, and only
 *     THEN appended the journal entry with `response.source === "proxy"`
 *     (verified in aimock `server.ts`: the `source:"proxy"` `journal.add` runs
 *     AFTER `await proxyAndRecord(...)`, which awaits the full upstream body).
 *     So a `source:"proxy"` entry proves the turn drained and its fixture is on
 *     disk — exactly the guarantee this barrier needs.
 *
 * A REPLAY entry is deliberately NOT counted as drained. On a fixture hit aimock
 * appends the journal entry (`status:200`, `fixture` set, `source` UNSET) BEFORE
 * it streams the response — verified in aimock `server.ts`, where the replay
 * `journal.add(... response:{status:200, fixture})` runs BEFORE
 * `await writeSSEStream(...)`; the entry is only mutated afterward if the stream
 * is interrupted. So `fixture != null` means "replay started / matched," NOT
 * "fully drained," and gating on it would let the barrier settle while a slow
 * replay is still streaming. Replay therefore has NO sound journal-based
 * completion signal; this barrier's "drained" definition is scoped to the
 * record path on purpose. The D5/D4 proxy-capture flows that use this barrier
 * run aimock in `--record` mode, where every genuine upstream turn is a
 * `source:"proxy"` entry, so this scoping is exactly right for them.
 *
 * Anything else (in-flight has no entry yet, errors, chaos fallbacks, or a
 * bare replay hit) is not a settled upstream-record turn.
 */
export function isCompletedTurn(entry) {
  const r = entry?.response;
  if (!r || r.status !== 200) return false;
  return r.source === "proxy";
}

/**
 * Count the completed upstream turns in a journal entries array. Tolerant of
 * non-array / malformed input (returns 0) so a transient bad journal read
 * cannot throw out of the drain loop.
 */
export function countCompletedTurns(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter(isCompletedTurn).length;
}

/**
 * Journal-drain barrier. Poll aimock's request journal until the run has fully
 * drained before the caller moves fixtures or restarts aimock.
 *
 * Why this exists: a probe marks a cell satisfied as soon as the tool card
 * meets the assertion, but the POST-tool-result LLM turn can still be draining
 * (aimock still proxying upstream + writing the fixture) after the probe
 * process exits. If we move fixtures / restart aimock at that instant, the late
 * fixture lands in the NEXT run's directory — observed as a run-3 follow-up
 * landing under run 4, and a run-4 EMPTY initial-weather fixture landing under
 * run 5 (weather then went red on replay).
 *
 * "Drained" here = the drained-turn count (record-path `source:"proxy"`
 * entries — see `isCompletedTurn`) has reached `expectedTurns` AND has stopped
 * growing for `quiesceMs`. Both conditions are REQUIRED and neither is
 * sufficient alone:
 *
 *   - The count floor alone is not enough: a run can momentarily sit at the
 *     floor between turns.
 *   - Quiescence alone is NOT sound, which is why `expectedTurns` is REQUIRED
 *     and must be the REAL number of upstream turns. An in-flight upstream
 *     request is INVISIBLE in the journal until it completes (aimock appends the
 *     `source:"proxy"` entry only AFTER the full upstream drain). So during the
 *     gap between the (N-1)th turn finishing and the Nth turn landing, the count
 *     is quiescent at N-1 while the slow final turn is still in flight. Waiting
 *     "purely for quiescence" (the old `expectedTurns: 0` behavior) would settle
 *     prematurely at N-1 and move fixtures out from under the Nth turn. Requiring
 *     the count to reach a real `expectedTurns` closes that hole.
 *
 * `expectedTurns` is REQUIRED — there is no default. It must be the true number
 * of upstream turns the captured flow drives (e.g. the built-in-agent D4 weather
 * flow expects 3: greeting, tool-call turn, post-tool-result turn). Omitting it
 * throws, rather than silently degrading to unsound quiescence-only draining.
 *
 * Rejects with a clear error if the journal never drains within `timeoutMs`.
 *
 * The injectable `fetchImpl` is deliberately typed to the MINIMAL journal-fetch
 * seam this barrier actually uses — a `(url) => Promise<{ ok, status, json() }>`
 * — NOT the full DOM `fetch` signature. Tests inject a tiny fake shaped exactly
 * to this seam; typing it here (rather than to `fetch`) keeps them from having
 * to satisfy `RequestInfo | URL` / `Response`.
 *
 * @typedef {{ ok?: boolean, status: number, json: () => Promise<unknown> }} JournalResponse
 * @param {object} opts
 * @param {number} opts.expectedTurns REQUIRED — the true number of upstream turns.
 * @param {string} [opts.journalUrl]
 * @param {(url: string) => Promise<JournalResponse>} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.pollIntervalMs]
 * @param {number} [opts.quiesceMs]
 * @returns {Promise<{ completed: number }>}
 */
export async function waitForJournalDrain({
  expectedTurns,
  journalUrl = JOURNAL_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120000,
  pollIntervalMs = 500,
  quiesceMs = 2000,
} = {}) {
  // expectedTurns is REQUIRED and must be a real turn count. Defaulting it to 0
  // (the old behavior) degrades the barrier to unsound quiescence-only draining
  // that settles prematurely while a slow final upstream turn is still in flight
  // (invisible in the journal until it completes). Fail loudly instead.
  if (expectedTurns === undefined) {
    throw new Error(
      "waitForJournalDrain: expectedTurns is required — pass the real number of " +
        "upstream turns the captured flow drives. Quiescence alone is not a sound " +
        "drain signal (an in-flight turn is invisible in the journal until it lands).",
    );
  }
  if (!Number.isInteger(expectedTurns) || expectedTurns < 0) {
    throw new Error(
      `waitForJournalDrain: expectedTurns must be a non-negative integer, got ${expectedTurns}`,
    );
  }
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let lastChangeAt = Date.now();
  let observed = 0;
  for (;;) {
    let entries = [];
    try {
      const res = await fetchImpl(journalUrl);
      if (!res.ok)
        throw new Error(`journal endpoint returned HTTP ${res.status}`);
      const body = await res.json();
      // aimock may return the entries array directly or wrapped in { entries }.
      entries = Array.isArray(body)
        ? body
        : Array.isArray(body?.entries)
          ? body.entries
          : [];
    } catch {
      // Transient read failure (e.g. aimock mid-restart) — treat as not-yet-
      // drained and keep polling until the timeout.
      entries = [];
    }
    observed = countCompletedTurns(entries);
    const now = Date.now();
    if (observed !== lastCount) {
      lastCount = observed;
      lastChangeAt = now;
    }
    const quiesced = now - lastChangeAt >= quiesceMs;
    if (observed >= expectedTurns && quiesced) {
      return { completed: observed };
    }
    if (now >= deadline) {
      throw new Error(
        `waitForJournalDrain: journal did not drain within ${timeoutMs}ms — ` +
          `expected >= ${expectedTurns} completed upstream turns (quiescent for ` +
          `${quiesceMs}ms) but observed ${observed}. A late post-tool-result turn ` +
          `may still be in flight; moving fixtures now risks landing it in the ` +
          `next run's directory.`,
      );
    }
    await sleep(pollIntervalMs);
  }
}
