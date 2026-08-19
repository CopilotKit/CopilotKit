import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  emitInspectorStopViewing,
  emitInspectorViewThread,
  emitInspectorViewThreadResult,
  onInspectorActiveThread,
  onInspectorViewThreadResult,
} from "@copilotkit/core";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";

function ThreadProbe() {
  const config = useCopilotChatConfiguration();
  return (
    <>
      <div data-testid="thread">{config?.threadId}</div>
      <div data-testid="explicit">{String(config?.hasExplicitThreadId)}</div>
      <div data-testid="agent">{config?.agentId}</div>
      <button
        data-testid="select"
        onClick={() => config?.setActiveThreadId("app-picked")}
      >
        select
      </button>
      <button data-testid="new" onClick={() => config?.startNewThread()}>
        new
      </button>
    </>
  );
}

describe("inspector thread override", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup();
    }
  });

  it("switches a pinned threadId when view-thread matches the agent", () => {
    render(
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId="pinned-thread"
      >
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    expect(screen.getByTestId("thread").textContent).toBe("pinned-thread");

    act(() => {
      emitInspectorViewThread({
        threadId: "saved-thread",
        agentId: "default",
      });
    });

    expect(screen.getByTestId("thread").textContent).toBe("saved-thread");
    expect(screen.getByTestId("explicit").textContent).toBe("true");
  });

  it("ignores view-thread for a different agent", () => {
    render(
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId="pinned-thread"
      >
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    act(() => {
      emitInspectorViewThread({
        threadId: "other-thread",
        agentId: "other-agent",
      });
    });

    expect(screen.getByTestId("thread").textContent).toBe("pinned-thread");
  });

  it("restores the previous thread on stop-viewing", () => {
    render(
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId="pinned-thread"
      >
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    act(() => {
      emitInspectorViewThread({
        threadId: "saved-thread",
        agentId: "default",
      });
    });
    act(() => {
      emitInspectorStopViewing({ agentId: "default" });
    });

    expect(screen.getByTestId("thread").textContent).toBe("pinned-thread");
  });

  it("keeps the original previous thread after a second view-thread", () => {
    render(
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId="pinned-thread"
      >
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    act(() => {
      emitInspectorViewThread({ threadId: "first-saved", agentId: "default" });
    });
    act(() => {
      emitInspectorViewThread({ threadId: "second-saved", agentId: "default" });
    });
    expect(screen.getByTestId("thread").textContent).toBe("second-saved");

    act(() => {
      emitInspectorStopViewing({ agentId: "default" });
    });
    expect(screen.getByTestId("thread").textContent).toBe("pinned-thread");
  });

  it("ends the override when the app picks a thread", () => {
    render(
      <CopilotChatConfigurationProvider agentId="default">
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    act(() => {
      emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("select"));
    });

    expect(screen.getByTestId("thread").textContent).toBe("app-picked");
  });

  it("rolls back when connect fails", () => {
    render(
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId="pinned-thread"
      >
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    act(() => {
      emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    });
    act(() => {
      emitInspectorViewThreadResult({
        threadId: "saved-thread",
        agentId: "default",
        ok: false,
        reason: "connect-failed",
      });
    });

    expect(screen.getByTestId("thread").textContent).toBe("pinned-thread");
  });

  it("emits applied result and active-thread on view", () => {
    const results: Array<{ ok: boolean; threadId: string }> = [];
    const actives: Array<{ source: string; threadId: string }> = [];
    cleanups.push(
      onInspectorViewThreadResult((payload) => {
        results.push({ ok: payload.ok, threadId: payload.threadId });
      }),
    );
    cleanups.push(
      onInspectorActiveThread((payload) => {
        actives.push({ source: payload.source, threadId: payload.threadId });
      }),
    );

    render(
      <CopilotChatConfigurationProvider
        agentId="default"
        threadId="pinned-thread"
      >
        <ThreadProbe />
      </CopilotChatConfigurationProvider>,
    );

    act(() => {
      emitInspectorViewThread({ threadId: "saved-thread", agentId: "default" });
    });

    expect(results).toContainEqual({ ok: true, threadId: "saved-thread" });
    expect(actives).toContainEqual({
      source: "override",
      threadId: "saved-thread",
    });
  });
});
