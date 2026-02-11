import {
  ClaimAction,
  resolveClaim,
  selectSnapshot,
  type ClaimsByMessageId,
  type SnapshotCaches,
  type StateRenderContext,
} from "../use-coagent-state-render-bridge.helpers";

describe("useCoAgentStateRenderBridge helpers", () => {
  describe("resolveClaim", () => {
    it("updates runId for an existing claim", () => {
      const claims: ClaimsByMessageId = {
        msg1: { stateRenderId: "render-a", runId: "pending" },
      };
      const context: StateRenderContext = {
        agentId: "agent-1",
        stateRenderId: "render-a",
        messageId: "msg1",
        runId: "run-123",
      };

      const result = resolveClaim({ claims, context, stateSnapshot: { step: 1 } });
      expect(result.action).toBe(ClaimAction.Existing);
      expect(result.canRender).toBe(true);
      expect(result.updateRunId).toBe("run-123");
    });

    it("overrides when a newer message index arrives", () => {
      const claims: ClaimsByMessageId = {
        msg1: {
          stateRenderId: "render-a",
          runId: "run-1",
          messageIndex: 0,
          stateSnapshot: { step: 2 },
        },
      };
      const context: StateRenderContext = {
        agentId: "agent-1",
        stateRenderId: "render-a",
        messageId: "msg2",
        runId: "run-1",
        messageIndex: 1,
      };

      const result = resolveClaim({ claims, context, stateSnapshot: { step: 2 } });
      expect(result.action).toBe(ClaimAction.Override);
      expect(result.canRender).toBe(true);
      expect(result.nextClaim).toMatchObject({
        stateRenderId: "render-a",
        runId: "run-1",
        messageIndex: 1,
      });
      expect(result.lockOthers).toBe(true);
    });

  });

  describe("selectSnapshot", () => {
    const caches: SnapshotCaches = {
      byStateRenderAndRun: {},
      byMessageId: {},
    };

    it("prefers the explicit state snapshot prop", () => {
      const result = selectSnapshot({
        messageId: "msg1",
        stateRenderId: "render-a",
        effectiveRunId: "run-1",
        stateSnapshotProp: "{\"phase\":\"planning\"}",
        agentState: { phase: "ignored" },
        agentMessages: [{ id: "assistant-1", role: "assistant" }],
        caches,
      });

      expect(result.snapshot).toEqual({ phase: "planning" });
      expect(result.hasSnapshotKeys).toBe(true);
    });

    it("falls back to cached snapshots for non-latest assistant messages", () => {
      const result = selectSnapshot({
        messageId: "msg-old",
        stateRenderId: "render-a",
        effectiveRunId: "run-1",
        agentState: { phase: "live" },
        agentMessages: [{ id: "assistant-latest", role: "assistant" }],
        caches: {
          byStateRenderAndRun: {
            "render-a::run-1": { phase: "cached" },
          },
          byMessageId: {},
        },
      });

      expect(result.snapshot).toBeUndefined();
      expect(result.cachedSnapshot).toEqual({ phase: "cached" });
      expect(result.snapshotForClaim).toEqual({ phase: "cached" });
    });
  });
});
