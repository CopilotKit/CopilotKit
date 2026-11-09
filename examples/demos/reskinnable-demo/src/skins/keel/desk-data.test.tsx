import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { KeelLedger, Persona, Run } from "@/skins/keel/data/types";

/**
 * `useKeelDesk` — the hook that replaced `data/use-data.ts`.
 *
 * Two things are being pinned, and only the second is new:
 *
 *  1. THE DERIVATIONS SURVIVED THE MOVE. `approvals`, `approvalsForMe`, `kpis`
 *     and the `summaryKey` churn guard came across from `useKeelData` unchanged.
 *     They were always pure functions of a run list and a persona; nothing about
 *     them cared where the runs came from, and this asserts that.
 *
 *  2. THE WRITES ARE HONEST ACROSS A NETWORK. Every mutation is now a POST
 *     followed by a re-read, which introduces a third outcome an in-memory store
 *     could not have: the write LANDED and the re-read did not. Reporting that as
 *     a plain success is indistinguishable from a slow network, so `stale` is a
 *     first-class result and a refusal's message is relayed VERBATIM (the routes
 *     write those to be read — the approve gate distinguishes "not found" from
 *     "already advanced" from "wrong role", and flattening them costs exactly the
 *     information that says whether to retry, switch persona, or stop).
 */

const PERSONA: Persona = {
  id: "sam-okafor",
  name: "Sam Okafor",
  role: "Privacy Officer",
  unit: "Privacy Office",
};

vi.mock("@/skins/keel/role-context", () => ({
  useRole: () => ({
    persona: PERSONA,
    personas: [PERSONA],
    setPersonaId: () => {},
  }),
  RoleProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/** Swapped per test so the hook sees whichever snapshot the case needs. */
const ledger: { data: KeelLedger; refreshResult: boolean; refreshes: number } =
  {
    data: emptyLedger(),
    refreshResult: true,
    refreshes: 0,
  };

function emptyLedger(): KeelLedger {
  return {
    documents: [],
    runs: [],
    playbooks: [],
    personas: [PERSONA],
    variances: [],
    impactBriefs: [],
    asOf: "2026-08-12T09:00:00.000Z",
  };
}

vi.mock("@/skins/keel/ledger-context", () => ({
  KeelLedgerProvider: ({ children }: { children: React.ReactNode }) => children,
  useKeelLedger: () => ({
    data: ledger.data,
    ready: true,
    refresh: () => {
      ledger.refreshes += 1;
      return Promise.resolve(ledger.refreshResult);
    },
  }),
}));

import { useKeelDesk } from "@/skins/keel/desk-data";
import type {
  DeskMutationResult,
  KeelDesk,
  StartRunOutcome,
} from "@/skins/keel/desk-data";

/** Mount the hook and hand back the latest committed value. */
function mountDesk(): { latest: () => KeelDesk } {
  let current: KeelDesk | undefined;
  function Harness() {
    current = useKeelDesk();
    return null;
  }
  render(<Harness />);
  return {
    latest: () => {
      if (!current) throw new Error("the desk hook never committed");
      return current;
    },
  };
}

const blockedRun = (over: Partial<Run> = {}): Run => ({
  id: "RUN-1000",
  playbookId: "pb",
  title: "PHI access request",
  subject: "Priya Raman — Radiology contractor",
  requestedBy: "Ana Reyes",
  createdAt: "2026-08-12T08:00:00.000Z",
  status: "blocked",
  steps: [
    {
      id: "gate",
      title: "Privacy review",
      role: "Privacy Office",
      requiresApproval: true,
      approverRole: "Privacy Officer",
      durationMs: 1000,
      status: "awaiting_approval",
      startedAt: "2026-08-12T08:30:00.000Z",
    },
  ],
  ...over,
});

const stubFetch = (
  response: { ok: boolean; status?: number; body?: unknown } | "throw",
) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (response === "throw") return Promise.reject(new Error("offline"));
      return Promise.resolve({
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 409),
        json: () => Promise.resolve(response.body ?? {}),
      });
    }),
  );
  return calls;
};

beforeEach(() => {
  ledger.data = emptyLedger();
  ledger.refreshResult = true;
  ledger.refreshes = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useKeelDesk — the derivations that came across from useKeelData", () => {
  it("derives the approval queue and flags what THIS persona may act on", () => {
    ledger.data = {
      ...emptyLedger(),
      runs: [
        blockedRun(),
        blockedRun({
          id: "RUN-1001",
          steps: [
            {
              id: "gate",
              title: "Security review",
              role: "Security",
              requiresApproval: true,
              approverRole: "Security Officer",
              durationMs: 1000,
              status: "awaiting_approval",
            },
          ],
        }),
      ],
    };
    const desk = mountDesk();

    expect(desk.latest().approvals.map((a) => a.run.id)).toEqual([
      "RUN-1000",
      "RUN-1001",
    ]);
    // Actionability is a role match, exactly as the engine decides it — the two
    // layers must never disagree about who may clear a gate.
    expect(desk.latest().approvalsForMe.map((a) => a.run.id)).toEqual([
      "RUN-1000",
    ]);
    expect(desk.latest().kpis.approvalsForMe).toBe(1);
    expect(desk.latest().kpis.blockedRuns).toBe(2);
    expect(desk.latest().kpis.openRuns).toBe(2);
  });

  it("publishes the register collections the ledger carries", () => {
    ledger.data = {
      ...emptyLedger(),
      documents: [
        {
          docId: "d",
          ref: "POL-114",
          title: "PHI Access",
          space: "privacy",
          owner: "Privacy Office",
          status: "published",
          lastReviewed: "2025-01-01",
          reviewDue: "2026-01-01",
          attestation: { assigned: 10, completed: 5 },
        },
      ],
    };
    const desk = mountDesk();
    expect(desk.latest().documents).toHaveLength(1);
    expect(desk.latest().asOf).toBe("2026-08-12T09:00:00.000Z");
    expect(desk.latest().ready).toBe(true);
  });

  /**
   * THE CHURN GUARD. The ledger poll hands back a NEW snapshot every 900 ms while
   * a run is live, so `summaryKey` is what keeps the agent-context readables from
   * being rewritten on every one of them. It must be keyed on the transition
   * tuples ONLY — never on a timestamp.
   */
  it("keeps summaryKey stable when only elapsed timestamps move", () => {
    const run = blockedRun();
    ledger.data = { ...emptyLedger(), runs: [run] };
    const desk = mountDesk();
    const before = desk.latest().summaryKey;

    cleanup();
    ledger.data = {
      ...emptyLedger(),
      // A brand-new snapshot object, a later `asOf`, a later step clock — and the
      // SAME (runId, status, currentStepId) tuple.
      asOf: "2026-08-12T09:00:00.900Z",
      runs: [
        {
          ...run,
          steps: [{ ...run.steps[0], startedAt: "2026-08-12T08:30:01.000Z" }],
        },
      ],
    };
    const after = mountDesk().latest().summaryKey;
    expect(after).toBe(before);
  });

  it("changes summaryKey on a real transition", () => {
    ledger.data = { ...emptyLedger(), runs: [blockedRun()] };
    const before = mountDesk().latest().summaryKey;
    cleanup();

    ledger.data = {
      ...emptyLedger(),
      runs: [blockedRun({ status: "cancelled" })],
    };
    expect(mountDesk().latest().summaryKey).not.toBe(before);
  });
});

describe("useKeelDesk — writes cross a network, and say so honestly", () => {
  it("POSTs an approval to the run's step route with the persona and note", async () => {
    ledger.data = { ...emptyLedger(), runs: [blockedRun()] };
    const calls = stubFetch({ ok: true, body: {} });
    const desk = mountDesk();

    let outcome: DeskMutationResult | undefined;
    await act(async () => {
      outcome = await desk.latest().approveStep("RUN-1000", "gate", "Looks ok");
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/keel/v1/runs/RUN-1000/steps/gate/approve");
    // `personaId` is added by the hook, never asked of the caller — the server
    // derives the approver from it, so a caller-supplied name would be a name
    // somebody typed.
    expect(calls[0].body).toEqual({ note: "Looks ok", personaId: PERSONA.id });
    expect(outcome).toEqual({ ok: true, reason: undefined, stale: undefined });
    // And the ledger was re-read, or the queue on screen would still show the
    // gate the operator just cleared.
    expect(ledger.refreshes).toBe(1);
  });

  it("relays a refusal's message VERBATIM and does not re-read", async () => {
    const message = "That approval gate already advanced.";
    stubFetch({ ok: false, status: 409, body: { message } });
    const desk = mountDesk();

    let outcome: DeskMutationResult | undefined;
    await act(async () => {
      outcome = await desk.latest().approveStep("RUN-1000", "gate");
    });

    expect(outcome).toEqual({ ok: false, reason: message, stale: undefined });
    // Nothing changed server-side, so there is nothing to re-read — and a
    // refresh here would hide the failure behind a repaint.
    expect(ledger.refreshes).toBe(0);
  });

  /**
   * The outcome that only exists once the write crosses a network. It must be
   * distinguishable from success: the approval LANDED, and the rows on screen are
   * still the ones from before it.
   */
  it("reports a stale success when the write lands but the re-read fails", async () => {
    stubFetch({ ok: true, body: {} });
    ledger.refreshResult = false;
    const desk = mountDesk();

    let outcome: DeskMutationResult | undefined;
    await act(async () => {
      outcome = await desk.latest().approveStep("RUN-1000", "gate");
    });

    expect(outcome).toMatchObject({ ok: true, stale: true });
    expect(String(outcome?.reason)).toContain("could not be refreshed");
  });

  it("reports an unreachable desk without claiming anything was recorded", async () => {
    stubFetch("throw");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const desk = mountDesk();

    let outcome: DeskMutationResult | undefined;
    await act(async () => {
      outcome = await desk.latest().cancelRun("RUN-1000");
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(String(outcome?.reason)).toContain("Nothing was recorded");
    expect(ledger.refreshes).toBe(0);
  });

  it("hands back the run the server created, so nothing narrates an unissued id", async () => {
    const created = blockedRun({ id: "RUN-1042", status: "running" });
    const calls = stubFetch({ ok: true, status: 201, body: created });
    const desk = mountDesk();

    let outcome: StartRunOutcome | undefined;
    await act(async () => {
      outcome = await desk
        .latest()
        .startRun("phi-access-request", { subject: "Priya Raman" });
    });

    expect(calls[0].url).toBe("/api/keel/v1/runs");
    expect(calls[0].body).toMatchObject({
      playbookId: "phi-access-request",
      subject: "Priya Raman",
      personaId: PERSONA.id,
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome?.run?.id).toBe("RUN-1042");
  });

  it("routes reject and cancel to their own endpoints", async () => {
    const calls = stubFetch({ ok: true, body: {} });
    const desk = mountDesk();

    await act(async () => {
      await desk.latest().rejectStep("RUN-1000", "gate", "No");
      await desk.latest().cancelRun("RUN-1000");
    });

    expect(calls.map((c) => c.url)).toEqual([
      "/api/keel/v1/runs/RUN-1000/steps/gate/reject",
      "/api/keel/v1/runs/RUN-1000/cancel",
    ]);
  });

  it("percent-encodes ids so a stray id cannot forge a path segment", async () => {
    const calls = stubFetch({ ok: true, body: {} });
    const desk = mountDesk();

    await act(async () => {
      await desk.latest().approveStep("RUN-1/../x", "step 1");
    });

    expect(calls[0].url).toBe(
      "/api/keel/v1/runs/RUN-1%2F..%2Fx/steps/step%201/approve",
    );
  });
});
