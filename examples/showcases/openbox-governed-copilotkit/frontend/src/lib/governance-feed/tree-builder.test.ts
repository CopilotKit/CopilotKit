import { describe, it, expect } from "vitest";
import { buildExecutionTree } from "./tree-builder";
import type {
  FeedResultRecord,
  FeedTimingRecord,
  FeedStoreSnapshot,
} from "./types";

function result(
  over: Partial<FeedResultRecord> & Pick<FeedResultRecord, "id">,
): FeedResultRecord {
  return {
    kind: "result",
    action: "review_data_handoff",
    request: "req",
    verdict: "allow",
    status: "executed",
    reason: "",
    message: "",
    hasGuardrailsSignal: false,
    isResume: false,
    arrivalIndex: 0,
    emittedAtMs: 0,
    raw: {},
    ...over,
  };
}

function timing(
  over: Partial<FeedTimingRecord> & Pick<FeedTimingRecord, "action" | "key">,
): FeedTimingRecord {
  return {
    kind: "timing",
    request: "req",
    label: over.key,
    timingKind: "tool",
    phase: "finished",
    startedAtMs: 0,
    ms: 10,
    arrivalIndex: 0,
    ...over,
  } as FeedTimingRecord;
}

function snapshot(
  results: FeedResultRecord[],
  timings: FeedTimingRecord[] = [],
): FeedStoreSnapshot {
  return { results, timings, halted: false, revision: 1 };
}

describe("buildExecutionTree", () => {
  it("groups actions under a Run keyed by runId", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({ id: "a", runId: "run-1", action: "create_support_ticket" }),
        result({
          id: "b",
          runId: "run-1",
          action: "send_public_status_update",
        }),
      ]),
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("run-1");
    expect(tree[0].synthetic).toBe(false);
    expect(tree[0].actions).toHaveLength(2);
  });

  it("falls back to workflowId, then to a synthetic run id", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({ id: "a", workflowId: "wf-9" }),
        result({ id: "b" }), // no run/workflow -> synthetic
      ]),
    );
    const ids = tree.map((r) => r.id);
    expect(ids).toContain("wf-9");
    expect(tree.some((r) => r.synthetic)).toBe(true);
  });

  it("attaches timing sub-steps to the matching action", () => {
    const tree = buildExecutionTree(
      snapshot(
        [result({ id: "a", runId: "run-1", action: "review_data_handoff" })],
        [
          timing({ action: "review_data_handoff", key: "policy", ms: 12 }),
          timing({
            action: "review_data_handoff",
            key: "guardrails",
            phase: "started",
            ms: undefined,
          }),
        ],
      ),
    );
    const action = tree[0].actions[0];
    expect(action.steps).toHaveLength(2);
    expect(action.steps.find((s) => s.id.includes("guardrails"))?.pending).toBe(
      true,
    );
  });

  it("joins a resume result onto the matching approval node as a continuation", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({
          id: "appr",
          runId: "run-1",
          action: "issue_large_refund",
          verdict: "approval",
          status: "approval_required",
          approvalId: "ap-1",
        }),
        result({
          id: "resume",
          runId: "run-1",
          action: "issue_large_refund",
          verdict: "allow",
          status: "executed",
          approvalId: "ap-1",
          isResume: true,
        }),
      ]),
    );
    // Only the approval node remains at top level; resume is nested.
    expect(tree[0].actions).toHaveLength(1);
    const node = tree[0].actions[0];
    expect(node.verdict).toBe("approval");
    expect(node.continuation?.verdict).toBe("allow");
    expect(node.continuation?.isResume).toBe(true);
  });

  it("orders runs and actions by arrivalIndex then emittedAt", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({ id: "a", runId: "run-1", arrivalIndex: 2, emittedAtMs: 200 }),
        result({ id: "b", runId: "run-1", arrivalIndex: 1, emittedAtMs: 100 }),
      ]),
    );
    expect(tree[0].actions.map((a) => a.id)).toEqual(["b", "a"]);
  });
});
