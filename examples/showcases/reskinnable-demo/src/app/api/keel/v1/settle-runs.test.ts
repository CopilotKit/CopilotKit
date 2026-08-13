import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readLedger } from "./ledger/route";
import { GET as readRun } from "./runs/[runId]/route";
import { settleRuns } from "./settle-runs";
import * as store from "@/skins/keel/data/store";
import type { KeelLedger, Run } from "@/skins/keel/data/types";

/**
 * THE TWO-CLOCKS GUARD.
 *
 * Keel's runs used to be advanced by a 900 ms `setInterval` in the client's
 * `useKeelData`, while the server held them as state only. Once the pages moved
 * onto the REST ledger that was two clocks over one set of runs — the client
 * painting progress the server had never heard of, and the next `refresh()`
 * rewinding it. The fix is that time lives on the SERVER: both read routes settle
 * runs through the pure `engine.tick` and COMMIT the result, and the client's
 * interval only re-reads.
 *
 * Nothing else can catch a regression here. A route that stopped settling would
 * still return 200 with a well-formed run; the only symptom is a started run that
 * never moves, or a run-detail page that disagrees with the Runs table — both of
 * which look like a slow server for the length of a demo.
 *
 * `runs/[runId]` is tested alongside `ledger` on purpose: settling ONE of them is
 * the more likely half-fix, and it is strictly worse than settling neither,
 * because the two pages then contradict each other in front of the room.
 */

/** The playbook whose first step RUNS rather than gating, so a fresh run ticks. */
const AUTOMATIC_FIRST = store
  .playbooks()
  .find((pb) => pb.steps[0]?.requiresApproval === false);

/** Start a run and hand back the run plus the ms its first step takes. */
const startTickingRun = (): { run: Run; firstStepMs: number } => {
  expect(AUTOMATIC_FIRST).toBeDefined();
  const playbook = AUTOMATIC_FIRST!;
  const started = store.startRun(
    playbook.id,
    { subject: "Two-clocks fixture" },
    "Sam Okafor",
  );
  expect(started.ok).toBe(true);
  expect(started.run?.status).toBe("running");
  return {
    run: started.run!,
    firstStepMs: playbook.steps[0]!.durationMs,
  };
};

const ledger = async (): Promise<KeelLedger> => (await readLedger()).json();

const runDetail = async (runId: string): Promise<{ run: Run }> =>
  (
    await readRun(new Request(`http://test/api/keel/v1/runs/${runId}`), {
      params: Promise.resolve({ runId }),
    })
  ).json();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-12T09:00:00.000Z"));
  store.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("settleRuns", () => {
  it("advances a running run by the elapsed wall clock", () => {
    const { run, firstStepMs } = startTickingRun();
    expect(store.findRun(run.id)?.steps[0]?.status).toBe("running");

    vi.advanceTimersByTime(firstStepMs + 1000);
    settleRuns();

    expect(store.findRun(run.id)?.steps[0]?.status).toBe("done");
  });

  it("COMMITS the settlement rather than recomputing it per read", () => {
    const { run, firstStepMs } = startTickingRun();
    vi.advanceTimersByTime(firstStepMs + 1000);
    settleRuns();

    // Freeze the clock and read the store DIRECTLY — no settle in between. If the
    // advance had only been computed for the response body, the store would still
    // hold the pre-tick step and the next mutation would compose on stale steps.
    expect(store.findRun(run.id)?.steps[0]?.status).toBe("done");
    expect(store.findRun(run.id)?.steps[0]?.completedAt).toBeDefined();
  });

  it("leaves the store untouched when nothing has elapsed", () => {
    const { run } = startTickingRun();
    const before = store.findRun(run.id);
    settleRuns();
    // Reference-equal: `tick`'s fast path returns the same array, so an idle read
    // must not churn the store (or every 900ms poll would rewrite it).
    expect(store.findRun(run.id)).toBe(before);
  });
});

describe("both read routes settle on read", () => {
  it("GET /ledger returns the settled run", async () => {
    const { run, firstStepMs } = startTickingRun();
    vi.advanceTimersByTime(firstStepMs + 1000);

    const snapshot = await ledger();
    const settled = snapshot.runs.find((r) => r.id === run.id);
    expect(settled?.steps[0]?.status).toBe("done");
  });

  it("GET /runs/<runId> returns the settled run", async () => {
    const { run, firstStepMs } = startTickingRun();
    vi.advanceTimersByTime(firstStepMs + 1000);

    const detail = await runDetail(run.id);
    expect(detail.run.steps[0]?.status).toBe("done");
  });

  /**
   * The half-fix this file exists to prevent: the two routes must describe the
   * SAME moment of the same run, so a read through either one settles for both.
   */
  it("agrees with each other on one run, whichever is read first", async () => {
    const { run, firstStepMs } = startTickingRun();
    vi.advanceTimersByTime(firstStepMs + 1000);

    const detailFirst = await runDetail(run.id);
    const snapshot = await ledger();
    const fromLedger = snapshot.runs.find((r) => r.id === run.id);

    expect(fromLedger?.status).toBe(detailFirst.run.status);
    expect(fromLedger?.steps.map((s) => s.status)).toEqual(
      detailFirst.run.steps.map((s) => s.status),
    );
  });

  it("a 404 for an unknown run still settles the rest of the register's runs", async () => {
    const { run, firstStepMs } = startTickingRun();
    vi.advanceTimersByTime(firstStepMs + 1000);

    const res = await readRun(
      new Request("http://test/api/keel/v1/runs/nope"),
      {
        params: Promise.resolve({ runId: "nope" }),
      },
    );
    expect(res.status).toBe(404);
    // Settling happens BEFORE the lookup, so a miss is not a silent skip: the
    // register is left in the state the clock says it is in.
    expect(store.findRun(run.id)?.steps[0]?.status).toBe("done");
  });
});
