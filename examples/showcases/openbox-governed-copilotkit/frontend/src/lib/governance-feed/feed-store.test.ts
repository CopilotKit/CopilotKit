import { describe, it, expect, beforeEach } from "vitest";
import {
  resetFeed,
  getFeedSnapshot,
  subscribeToFeed,
  ingestResultsFromMessages,
  ingestTimingFromState,
  ingestHalt,
} from "./feed-store";

const RESULT_SCHEMA = "openbox.copilotkit.result.v1";
const TIMING_SCHEMA = "openbox.copilotkit.timing.v1";

function toolMessage(id: string, body: Record<string, unknown>) {
  return {
    role: "tool",
    tool_call_id: id,
    content: JSON.stringify({ schemaVersion: RESULT_SCHEMA, ...body }),
  };
}

function timingState(
  action: string,
  key: string,
  phase: "started" | "finished",
  extra: Record<string, unknown> = {},
) {
  return {
    openboxTimingEvent: {
      schemaVersion: TIMING_SCHEMA,
      action,
      request: "req",
      event: {
        phase,
        key,
        label: `${key} label`,
        kind: "tool",
        ...extra,
      },
      emittedAt: new Date().toISOString(),
    },
  };
}

// resetFeed now PRESERVES seen-ids (durable clear), so any tool_call_id used in
// one test is permanently "seen" for the rest of the module's lifetime. To keep
// tests isolated, every test uses ids unique to that test.
describe("feed-store (append-only)", () => {
  beforeEach(() => resetFeed());

  it("ingests governed result tool messages and dedupes by id", () => {
    const messages = [
      toolMessage("dedupe-tc1", {
        action: "create_support_ticket",
        status: "executed",
        runId: "run-1",
      }),
    ];
    ingestResultsFromMessages(messages, { messages });
    ingestResultsFromMessages(messages, { messages }); // duplicate
    const snap = getFeedSnapshot();
    expect(snap.results).toHaveLength(1);
    expect(snap.results[0].verdict).toBe("allow");
    expect(snap.results[0].runId).toBe("run-1");
  });

  it("ignores non-OpenBox tool messages", () => {
    ingestResultsFromMessages(
      [{ role: "tool", tool_call_id: "nonbox-x", content: '{"foo":1}' }],
      { messages: [] },
    );
    expect(getFeedSnapshot().results).toHaveLength(0);
  });

  it("does NOT wipe on a new ingest (append-only)", () => {
    ingestResultsFromMessages(
      [toolMessage("append-a", { status: "executed" })],
      { messages: [] },
    );
    ingestResultsFromMessages(
      [toolMessage("append-b", { status: "blocked" })],
      { messages: [] },
    );
    expect(getFeedSnapshot().results).toHaveLength(2);
  });

  it("ingests timing.v1 from agent state and dedupes by action+key+phase", () => {
    const state = timingState("review_data_handoff", "policy", "finished", {
      ms: 12,
    });
    ingestTimingFromState(state);
    ingestTimingFromState(state); // duplicate phase
    const snap = getFeedSnapshot();
    expect(snap.timings).toHaveLength(1);
    expect(snap.timings[0].key).toBe("policy");
  });

  it("records a halt", () => {
    ingestHalt();
    expect(getFeedSnapshot().halted).toBe(true);
  });

  it("resetFeed clears everything", () => {
    ingestResultsFromMessages(
      [toolMessage("clearall-a", { status: "executed" })],
      { messages: [] },
    );
    ingestHalt();
    resetFeed();
    const snap = getFeedSnapshot();
    expect(snap.results).toHaveLength(0);
    expect(snap.halted).toBe(false);
  });

  it("bumps revision on mutation", () => {
    const before = getFeedSnapshot().revision;
    ingestResultsFromMessages(
      [toolMessage("bumprev-a", { status: "executed" })],
      { messages: [] },
    );
    expect(getFeedSnapshot().revision).toBeGreaterThan(before);
  });

  // --- resetFeed: monotonic + durable ---------------------------------------

  it("resetFeed is monotonic: revision strictly increases past the ingest", () => {
    ingestResultsFromMessages(
      [toolMessage("monotonic-a", { status: "executed" })],
      { messages: [] },
    );
    const afterIngest = getFeedSnapshot().revision; // N
    expect(getFeedSnapshot().results).toHaveLength(1);

    resetFeed();
    const snap = getFeedSnapshot();
    expect(snap.results).toHaveLength(0);
    expect(snap.revision).toBeGreaterThan(afterIngest); // strictly > N (not 0)
  });

  it("resetFeed is durable: a re-ingest of an already-seen message is not re-added", () => {
    const msg = [toolMessage("durable-tc1", { status: "executed" })];
    ingestResultsFromMessages(msg, { messages: [] });
    expect(getFeedSnapshot().results).toHaveLength(1);

    resetFeed();
    ingestResultsFromMessages(msg, { messages: [] }); // same id — preserved as seen
    expect(getFeedSnapshot().results).toHaveLength(0);
  });

  it("reset then a genuinely new action ingests only the new one", () => {
    ingestResultsFromMessages(
      [toolMessage("resetnew-tc1", { status: "executed" })],
      { messages: [] },
    );
    resetFeed();
    ingestResultsFromMessages(
      [toolMessage("resetnew-tc1", { status: "executed" })], // already seen
      { messages: [] },
    );
    ingestResultsFromMessages(
      [toolMessage("resetnew-tc2", { status: "blocked" })], // new
      { messages: [] },
    );
    expect(getFeedSnapshot().results).toHaveLength(1);
  });

  // --- resume detection -----------------------------------------------------

  it("flags a terminal result carrying an approvalId as a resume", () => {
    ingestResultsFromMessages(
      [
        toolMessage("resume-exec", {
          status: "executed",
          approvalId: "ap1",
        }),
      ],
      { messages: [] },
    );
    expect(getFeedSnapshot().results[0].isResume).toBe(true);
  });

  it("does not flag an approval_pending result with an approvalId as a resume", () => {
    ingestResultsFromMessages(
      [
        toolMessage("resume-pending", {
          status: "approval_pending",
          approvalId: "ap1",
        }),
      ],
      { messages: [] },
    );
    expect(getFeedSnapshot().results[0].isResume).toBe(false);
  });

  it("keeps raw clean (no synthetic __isResume key) on a resume result", () => {
    ingestResultsFromMessages(
      [
        toolMessage("rawclean-exec", {
          status: "executed",
          approvalId: "ap1",
        }),
      ],
      { messages: [] },
    );
    const result = getFeedSnapshot().results[0];
    expect(result.isResume).toBe(true);
    expect("__isResume" in result.raw).toBe(false);
  });

  // --- field extraction -----------------------------------------------------

  it("passes through governance fields and flags a guardrails signal", () => {
    ingestResultsFromMessages(
      [
        toolMessage("fields-gold", {
          status: "executed",
          riskScore: 0.7,
          trustTier: "gold",
          redactionSummary: "x",
          guardrailsResult: { redactedFields: ["ssn"] },
        }),
      ],
      { messages: [] },
    );
    const result = getFeedSnapshot().results[0];
    expect(result.riskScore).toBe(0.7);
    expect(result.trustTier).toBe("gold");
    expect(result.redactionSummary).toBe("x");
    expect(result.hasGuardrailsSignal).toBe(true);
  });

  it("accepts a numeric trustTier", () => {
    ingestResultsFromMessages(
      [
        toolMessage("fields-numeric", {
          status: "executed",
          trustTier: 3,
        }),
      ],
      { messages: [] },
    );
    expect(getFeedSnapshot().results[0].trustTier).toBe(3);
  });

  it("does not flag a guardrails signal for an empty guardrailsResult", () => {
    ingestResultsFromMessages(
      [
        toolMessage("fields-empty", {
          status: "executed",
          guardrailsResult: {},
        }),
      ],
      { messages: [] },
    );
    expect(getFeedSnapshot().results[0].hasGuardrailsSignal).toBe(false);
  });

  // --- timing dedupe distinguishes phase ------------------------------------

  it("keeps both phases of the same action+key (dedupe is by action:key:phase)", () => {
    ingestTimingFromState(timingState("phase-a", "k", "started"));
    ingestTimingFromState(timingState("phase-a", "k", "finished", { ms: 5 }));
    const snap = getFeedSnapshot();
    expect(snap.timings).toHaveLength(2);
    expect(snap.timings.map((t) => t.phase).sort()).toEqual([
      "finished",
      "started",
    ]);
  });

  // --- ingestHalt idempotency -----------------------------------------------

  it("ingestHalt is idempotent: a second call does not bump revision", () => {
    ingestHalt();
    const snap = getFeedSnapshot();
    expect(snap.halted).toBe(true);
    expect(typeof snap.haltedAtMs).toBe("number");
    const revisionAfterFirst = snap.revision;

    ingestHalt(); // early-return, no commit
    expect(getFeedSnapshot().revision).toBe(revisionAfterFirst);
  });

  // --- subscribe / notify / unsubscribe -------------------------------------

  it("notifies subscribers on a committing ingest and stops after unsubscribe", () => {
    let calls = 0;
    const unsubscribe = subscribeToFeed(() => {
      calls += 1;
    });

    ingestResultsFromMessages([toolMessage("sub-a", { status: "executed" })], {
      messages: [],
    });
    expect(calls).toBe(1);

    unsubscribe();
    ingestResultsFromMessages([toolMessage("sub-b", { status: "executed" })], {
      messages: [],
    });
    expect(calls).toBe(1); // not invoked again
  });

  // --- no-op ingest does not bump revision ----------------------------------

  it("a no-op ingest (empty array or already-seen message) leaves revision unchanged", () => {
    const baseline = getFeedSnapshot().revision;

    ingestResultsFromMessages([], { messages: [] });
    expect(getFeedSnapshot().revision).toBe(baseline);

    const msg = [toolMessage("noop-tc1", { status: "executed" })];
    ingestResultsFromMessages(msg, { messages: [] });
    const afterFirst = getFeedSnapshot().revision;
    expect(afterFirst).toBeGreaterThan(baseline);

    ingestResultsFromMessages(msg, { messages: [] }); // already seen
    expect(getFeedSnapshot().revision).toBe(afterFirst);
  });
});
