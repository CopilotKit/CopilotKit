import { expect, test, vi } from "vitest";
import { emitInspectorActiveThread } from "@copilotkit/core";
import { WebInspectorElement } from "../index.js";

vi.mock("../lib/notification-loader.js", async () => {
  const { fetchNotificationFixture } =
    await import("./notification-fixture.js");
  return { loadNotificationFeed: fetchNotificationFixture };
});

// The bridge has no public state API; inspect only the state its event changes.
type BridgeState = {
  activeViewInAppRequestId: string | null;
  inAppThreadId: string | null;
};

test("changing to product-only mode detaches the development thread bridge and restores it on return", async () => {
  const inspector = new WebInspectorElement();
  const state = inspector as unknown as BridgeState;
  document.body.append(inspector);
  try {
    await inspector.updateComplete;
    state.activeViewInAppRequestId = "selected-thread";
    emitInspectorActiveThread({
      requestId: "selected-thread",
      threadId: "before",
      agentId: "support",
      source: "override",
    });
    expect(state.inAppThreadId).toBe("before");
    inspector.intelligenceOnly = true;
    await inspector.updateComplete;
    emitInspectorActiveThread({
      requestId: "selected-thread",
      threadId: "late-development-event",
      agentId: "support",
      source: "override",
    });
    expect(state.inAppThreadId).not.toBe("late-development-event");
    inspector.intelligenceOnly = false;
    await inspector.updateComplete;
    state.activeViewInAppRequestId = "returned-thread";
    emitInspectorActiveThread({
      requestId: "returned-thread",
      threadId: "after",
      agentId: "support",
      source: "override",
    });
    expect(state.inAppThreadId).toBe("after");
    inspector.remove();
    emitInspectorActiveThread({
      requestId: "returned-thread",
      threadId: "disconnected",
      agentId: "support",
      source: "override",
    });
    expect(state.inAppThreadId).toBe("after");
  } finally {
    inspector.remove();
  }
});
