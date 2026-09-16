import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runPresenterReset } from "./layout";
import { landedWritesOn, narrateWrite, resetLandedWrites } from "./settle";

/**
 * The presenter's Reset button is the control whose whole job is recovering
 * under time pressure, on stage — so the one thing it may never do is leave the
 * room looking at a state that no longer exists.
 *
 * `store.reset()` runs in the route BEFORE anything that can fail, and nothing
 * rolls it back. So a 502 (memory wiped but not fully re-seeded) and an
 * exception mid-sweep both mean THE STORE IS GONE. The pre-fix handler branched
 * on `res.ok` alone: on either of those it neither navigated nor refreshed, so
 *
 *   - the page kept rendering pre-reset rows over a wiped store, and
 *   - the module-level teach-mode journal in `settle.ts` survived, so a later
 *     failure recited writes the reset had taken away, and
 *   - the route's `memoryError` sentence — the only warning that beat 6 may
 *     start out already taught — was thrown away and replaced with a bare
 *     "HTTP 502".
 *
 * Two independent narrators (the screen, and the agent's recital) asserting a
 * world that is gone. These assertions pin each half.
 */

const respond = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

/** A body no JSON parser can read — a Next error page, a proxy, an empty 500. */
const unreadable = (status: number): Response =>
  ({
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  }) as unknown as Response;

/** The exact shape of the route's partial-memory failure. */
const PARTIAL_502 = {
  ok: false,
  reset: ["store"],
  memory: "partial",
  seeded: 1,
  expectedSeeds: 4,
  memoryError:
    "memory wipe did not finish (1 of 2 bucket(s), 3 row(s) failed to delete); " +
    "a surviving memory can leave beat 6 already taught",
};

const io = (post: () => Promise<Response>, confirmed = true) => {
  /** Every call in order, so "warned THEN left" can be asserted as an order. */
  const calls: string[] = [];
  const spies = {
    confirm: vi.fn((message: string) => {
      calls.push(`confirm:${message}`);
      return confirmed;
    }),
    notify: vi.fn((message: string) => {
      calls.push(`notify:${message}`);
    }),
    navigate: vi.fn(() => {
      calls.push("navigate");
    }),
    post,
  };
  return { ...spies, calls };
};

/** Land a write on one order so the journal has something to lose. */
const journalOneWrite = async () => {
  await narrateWrite(
    { action: "the hold on order 4463", subject: "ord-4463" },
    async (landed) => {
      landed("put on hold");
      return "Order 4463 is on hold.";
    },
  );
  expect(landedWritesOn("ord-4463")).toEqual(["put on hold"]);
};

beforeEach(() => {
  resetLandedWrites();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("runPresenterReset — the happy path", () => {
  it("navigates to the skin root and drops the journal", async () => {
    await journalOneWrite();
    const deps = io(async () =>
      respond(200, { ok: true, reset: ["store", "memory"], memory: "seeded" }),
    );

    await runPresenterReset(deps);

    expect(deps.navigate).toHaveBeenCalledTimes(1);
    // Nothing to warn about, so no modal stands between the presenter and a
    // clean app.
    expect(deps.notify).not.toHaveBeenCalled();
    expect(landedWritesOn("ord-4463")).toEqual([]);
  });

  it("does nothing at all when the confirm is declined", async () => {
    const post = vi.fn(async () =>
      respond(200, { ok: true, reset: ["store"] }),
    );
    const deps = io(post, false);

    await runPresenterReset(deps);

    expect(post).not.toHaveBeenCalled();
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe("runPresenterReset — 502 with the store already wiped", () => {
  it("navigates anyway, because the rows on screen no longer exist", async () => {
    const deps = io(async () => respond(502, PARTIAL_502));

    await runPresenterReset(deps);

    // THE FINDING: the pre-fix handler stopped at the alert, leaving a wiped
    // store rendered as pre-reset data.
    expect(deps.navigate).toHaveBeenCalledTimes(1);
  });

  it("shows the route's memoryError sentence, not just a status code", async () => {
    const deps = io(async () => respond(502, PARTIAL_502));

    await runPresenterReset(deps);

    const warning = deps.notify.mock.calls[0]?.[0] ?? "";
    // The sentence exists precisely so the presenter knows beat 6 may start out
    // already taught. Discarding it for "HTTP 502" is the loss this pins.
    expect(warning).toContain("beat 6 already taught");
    expect(warning).toContain("memory wipe did not finish");
    // And it must still say the store DID go, or the presenter cannot tell
    // whether the demo data is seeded.
    expect(warning).toMatch(/WAS reset/i);
  });

  it("warns BEFORE it leaves, so the sentence is readable", async () => {
    const deps = io(async () => respond(502, PARTIAL_502));

    await runPresenterReset(deps);

    const notifyAt = deps.calls.findIndex((c) => c.startsWith("notify:"));
    const navigateAt = deps.calls.indexOf("navigate");
    expect(notifyAt).toBeGreaterThanOrEqual(0);
    expect(navigateAt).toBeGreaterThan(notifyAt);
  });

  it("clears the teach-mode journal, so no recital survives the wipe", async () => {
    await journalOneWrite();
    const deps = io(async () => respond(502, PARTIAL_502));

    await runPresenterReset(deps);

    // Belt and braces with the navigate: the journal must be gone even if the
    // document load never lands. Otherwise the next failure on order 4463
    // recites "put on hold … still stand" about a store that was emptied.
    expect(landedWritesOn("ord-4463")).toEqual([]);
  });
});

describe("runPresenterReset — the request never came back", () => {
  it("reloads and says so instead of trusting the screen", async () => {
    await journalOneWrite();
    const deps = io(async () => {
      throw new TypeError("Failed to fetch");
    });

    await runPresenterReset(deps);

    // The store is in-memory, so the likeliest cause — the dev server
    // restarting mid-call — has itself already reset it. Keeping the page is
    // the one option that can be wrong in the demo-destroying direction.
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    expect(deps.notify.mock.calls[0]?.[0] ?? "").toContain("Failed to fetch");
    expect(landedWritesOn("ord-4463")).toEqual([]);
  });

  it("reloads when the body cannot be read at all", async () => {
    const deps = io(async () => unreadable(500));

    await runPresenterReset(deps);

    // Unreadable body = the client cannot tell whether the store went. It runs
    // AFTER the gate, so "assume wiped" is the only safe reading.
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});

describe("runPresenterReset — refused before the store was touched", () => {
  it("keeps the page when the route says it never reset anything", async () => {
    await journalOneWrite();
    const deps = io(async () =>
      respond(403, {
        error: "FORBIDDEN",
        message: "Not available in production.",
      }),
    );

    await runPresenterReset(deps);

    // Nothing on screen is stale, so throwing away a working demo would be its
    // own failure. The journal is still true, too.
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(deps.notify.mock.calls[0]?.[0] ?? "").toContain(
      "Not available in production.",
    );
    expect(landedWritesOn("ord-4463")).toEqual(["put on hold"]);
  });
});
