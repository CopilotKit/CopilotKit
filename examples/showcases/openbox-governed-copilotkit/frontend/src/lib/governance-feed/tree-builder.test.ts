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

  it("renders a resume with no matching approval as its own top-level action", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({
          id: "resume",
          runId: "run-1",
          action: "issue_large_refund",
          verdict: "allow",
          status: "executed",
          approvalId: "ap-orphan",
          isResume: true,
        }),
      ]),
    );
    // No approval_required node for ap-orphan: the resume is neither nested
    // nor dropped — it stands on its own at the top level.
    expect(tree[0].actions).toHaveLength(1);
    const node = tree[0].actions[0];
    expect(node.id).toBe("resume");
    expect(node.isResume).toBe(true);
    expect(node.continuation).toBeUndefined();
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

  it("collapses a started/finished pair for the same key into one step (finished wins)", () => {
    const tree = buildExecutionTree(
      snapshot(
        [result({ id: "a", runId: "run-1", action: "review_data_handoff" })],
        [
          timing({
            action: "review_data_handoff",
            key: "policy",
            phase: "started",
            ms: undefined,
          }),
          timing({
            action: "review_data_handoff",
            key: "policy",
            phase: "finished",
            ms: 12,
          }),
        ],
      ),
    );
    const action = tree[0].actions[0];
    // Same action+key collapses to a single step...
    expect(action.steps).toHaveLength(1);
    // ...and finished wins, so the surviving step is not pending.
    expect(action.steps[0].id).toBe("review_data_handoff:policy");
    expect(action.steps[0].pending).toBe(false);
    expect(action.steps[0].ms).toBe(12);
  });

  it("treats step pending asymmetrically by phase and ms", () => {
    const tree = buildExecutionTree(
      snapshot(
        [result({ id: "a", runId: "run-1", action: "review_data_handoff" })],
        [
          // started WITH a numeric ms -> not pending
          timing({
            action: "review_data_handoff",
            key: "started-with-ms",
            phase: "started",
            ms: 5,
          }),
          // finished -> not pending
          timing({
            action: "review_data_handoff",
            key: "done",
            phase: "finished",
            ms: 8,
          }),
          // started with NO ms -> pending
          timing({
            action: "review_data_handoff",
            key: "started-no-ms",
            phase: "started",
            ms: undefined,
          }),
        ],
      ),
    );
    const steps = tree[0].actions[0].steps;
    const byKey = (k: string) => steps.find((s) => s.id.endsWith(`:${k}`));
    expect(byKey("started-with-ms")?.pending).toBe(false);
    expect(byKey("done")?.pending).toBe(false);
    expect(byKey("started-no-ms")?.pending).toBe(true);
  });

  it("produces one RunNode per distinct real runId, ordered by arrival", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({ id: "a", runId: "run-late", arrivalIndex: 1 }),
        result({ id: "b", runId: "run-early", arrivalIndex: 0 }),
      ]),
    );
    expect(tree).toHaveLength(2);
    // Runs are ordered by the arrival of their first record.
    expect(tree.map((r) => r.id)).toEqual(["run-early", "run-late"]);
  });

  it("does not consume a resume when the matching approvalId resolves to a non-approval verdict", () => {
    const tree = buildExecutionTree(
      snapshot([
        result({
          id: "blocked",
          runId: "run-1",
          action: "issue_large_refund",
          verdict: "block",
          status: "blocked",
          approvalId: "ap1",
        }),
        result({
          id: "resume",
          runId: "run-1",
          action: "issue_large_refund",
          verdict: "allow",
          status: "executed",
          approvalId: "ap1",
          isResume: true,
        }),
      ]),
    );
    // The record with approvalId "ap1" is a block, not an approval, so the
    // r.verdict === "approval" guard keeps the resume from being skipped.
    const node = tree[0].actions.find((a) => a.id === "resume");
    expect(node).toBeDefined();
    expect(node?.isResume).toBe(true);
    // The blocked record carries no continuation (it isn't an approval node).
    const blocked = tree[0].actions.find((a) => a.id === "blocked");
    expect(blocked?.continuation).toBeUndefined();
    expect(tree[0].actions).toHaveLength(2);
  });
});
