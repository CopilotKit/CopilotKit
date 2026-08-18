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
 * True when a journal entry represents a COMPLETED upstream turn — i.e. aimock
 * has fully served the request and appended the entry (so any fixture it
 * produced is already written to disk).
 *
 * Two completion shapes exist, both observed live on this aimock build:
 *   - RECORD mode: no fixture matched, aimock proxied to the real provider and
 *     wrote a fixture. The entry carries `response.source === "proxy"`.
 *   - REPLAY: a fixture served the request. `response.fixture` is populated but
 *     `response.source` is UNSET (aimock does not stamp source:"fixture" on a
 *     normal replay), so we MUST gate on `status === 200 && fixture != null`
 *     and never on `source === "fixture"`.
 *
 * Both are 200s; anything else (in-flight has no entry yet, errors, chaos
 * fallbacks) is not a settled upstream turn.
 */
export function isCompletedTurn(entry) {
  const r = entry?.response;
  if (!r || r.status !== 200) return false;
  return r.source === "proxy" || r.fixture != null;
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
 * "Drained" here = the completed-turn count has reached `expectedTurns` AND has
 * stopped growing for `quiesceMs` (nothing else is in flight). Because the
 * journal only appends an entry once a turn is fully served, a turn still
 * draining is simply absent from the count; requiring the count to hold steady
 * for a quiescence window is how we know no further turn is about to land.
 *
 * `expectedTurns` is a floor (e.g. the built-in-agent D4 weather flow expects 3:
 * greeting, tool-call turn, post-tool-result turn); pass 0 to wait purely for
 * quiescence when the exact turn count for a demo is not known ahead of time.
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
 * @param {object} [opts]
 * @param {number} [opts.expectedTurns]
 * @param {string} [opts.journalUrl]
 * @param {(url: string) => Promise<JournalResponse>} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.pollIntervalMs]
 * @param {number} [opts.quiesceMs]
 * @returns {Promise<{ completed: number }>}
 */
export async function waitForJournalDrain({
  expectedTurns = 0,
  journalUrl = JOURNAL_URL,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120000,
  pollIntervalMs = 500,
  quiesceMs = 2000,
} = {}) {
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
