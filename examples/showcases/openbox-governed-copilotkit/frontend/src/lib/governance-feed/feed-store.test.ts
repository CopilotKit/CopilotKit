import { describe, it, expect, beforeEach } from "vitest";
import {
  resetFeed,
  getFeedSnapshot,
  ingestResultsFromMessages,
  ingestTimingFromState,
  ingestHalt,
} from "./feed-store";

const RESULT_SCHEMA = "openbox.copilotkit.result.v1";

function toolMessage(id: string, body: Record<string, unknown>) {
  return {
    role: "tool",
    tool_call_id: id,
    content: JSON.stringify({ schemaVersion: RESULT_SCHEMA, ...body }),
  };
}

describe("feed-store (append-only)", () => {
  beforeEach(() => resetFeed());

  it("ingests governed result tool messages and dedupes by id", () => {
    const messages = [
      toolMessage("tc1", {
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
      [{ role: "tool", tool_call_id: "x", content: '{"foo":1}' }],
      { messages: [] },
    );
    expect(getFeedSnapshot().results).toHaveLength(0);
  });

  it("does NOT wipe on a new ingest (append-only)", () => {
    ingestResultsFromMessages([toolMessage("a", { status: "executed" })], {
      messages: [],
    });
    ingestResultsFromMessages([toolMessage("b", { status: "blocked" })], {
      messages: [],
    });
    expect(getFeedSnapshot().results).toHaveLength(2);
  });

  it("ingests timing.v1 from agent state and dedupes by action+key+phase", () => {
    const state = {
      openboxTimingEvent: {
        schemaVersion: "openbox.copilotkit.timing.v1",
        action: "review_data_handoff",
        request: "req",
        event: {
          phase: "finished",
          key: "policy",
          label: "Policy check",
          kind: "tool",
          ms: 12,
        },
        emittedAt: new Date().toISOString(),
      },
    };
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
    ingestResultsFromMessages([toolMessage("a", { status: "executed" })], {
      messages: [],
    });
    ingestHalt();
    resetFeed();
    const snap = getFeedSnapshot();
    expect(snap.results).toHaveLength(0);
    expect(snap.halted).toBe(false);
  });

  it("bumps revision on mutation", () => {
    const before = getFeedSnapshot().revision;
    ingestResultsFromMessages([toolMessage("a", { status: "executed" })], {
      messages: [],
    });
    expect(getFeedSnapshot().revision).toBeGreaterThan(before);
  });
});
