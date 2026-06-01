import React from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ThreadsProvider, useThreads } from "../threads-context";

function ThreadIdViewer() {
  const { threadId, isThreadIdExplicit } = useThreads();
  return (
    <>
      <div data-testid="threadId">{threadId}</div>
      <div data-testid="isExplicit">{String(isThreadIdExplicit)}</div>
    </>
  );
}

// Exposes setThreadId to the test so it can trigger the auto→explicit flip.
function ThreadIdController({ nextId }: { nextId: string }) {
  const { setThreadId } = useThreads();
  return (
    <button data-testid="setThread" onClick={() => setThreadId(nextId)}>
      set
    </button>
  );
}

describe("ThreadsProvider", () => {
  it("updates threadId when explicit prop becomes available", () => {
    const { rerender } = render(
      <ThreadsProvider>
        <ThreadIdViewer />
      </ThreadsProvider>,
    );

    expect(screen.getByTestId("threadId").textContent).toBe("mock-thread-id");

    rerender(
      <ThreadsProvider threadId="customer-thread">
        <ThreadIdViewer />
      </ThreadsProvider>,
    );

    expect(screen.getByTestId("threadId").textContent).toBe("customer-thread");
  });

  describe("isThreadIdExplicit", () => {
    it("is false on first mount when no threadId prop is supplied", () => {
      // Auto-minted UUID — the backend has never seen it, so downstream
      // consumers (e.g. /connect) must NOT treat this as a real thread.
      render(
        <ThreadsProvider>
          <ThreadIdViewer />
        </ThreadsProvider>,
      );

      expect(screen.getByTestId("threadId").textContent).toBe("mock-thread-id");
      expect(screen.getByTestId("isExplicit").textContent).toBe("false");
    });

    it("is true when threadId prop is supplied on mount", () => {
      render(
        <ThreadsProvider threadId="customer-thread">
          <ThreadIdViewer />
        </ThreadsProvider>,
      );

      expect(screen.getByTestId("threadId").textContent).toBe(
        "customer-thread",
      );
      expect(screen.getByTestId("isExplicit").textContent).toBe("true");
    });

    it("flips from false to true after setThreadId() is called", () => {
      render(
        <ThreadsProvider>
          <ThreadIdViewer />
          <ThreadIdController nextId="user-picked-thread" />
        </ThreadsProvider>,
      );

      expect(screen.getByTestId("isExplicit").textContent).toBe("false");

      act(() => {
        screen.getByTestId("setThread").click();
      });

      expect(screen.getByTestId("threadId").textContent).toBe(
        "user-picked-thread",
      );
      expect(screen.getByTestId("isExplicit").textContent).toBe("true");
    });

    it("reverts to false when an explicit prop is removed and setThreadId was never called", () => {
      // Current contract: explicitness via the `threadId` prop is prop-derived,
      // so removing the prop returns the provider to its auto-minted state.
      // Pinning this guards against an accidental "sticky explicit" regression.
      const { rerender } = render(
        <ThreadsProvider threadId="customer-thread">
          <ThreadIdViewer />
        </ThreadsProvider>,
      );

      expect(screen.getByTestId("isExplicit").textContent).toBe("true");

      rerender(
        <ThreadsProvider>
          <ThreadIdViewer />
        </ThreadsProvider>,
      );

      expect(screen.getByTestId("threadId").textContent).toBe("mock-thread-id");
      expect(screen.getByTestId("isExplicit").textContent).toBe("false");
    });

    it("stays true after prop is removed if setThreadId was called while prop was present", () => {
      // Once the caller has touched setThreadId, explicitness is sticky —
      // the internal "user picked a thread" flag outlives any prop churn.
      const { rerender } = render(
        <ThreadsProvider threadId="customer-thread">
          <ThreadIdViewer />
          <ThreadIdController nextId="user-picked-thread" />
        </ThreadsProvider>,
      );

      act(() => {
        screen.getByTestId("setThread").click();
      });

      rerender(
        <ThreadsProvider>
          <ThreadIdViewer />
          <ThreadIdController nextId="user-picked-thread" />
        </ThreadsProvider>,
      );

      expect(screen.getByTestId("threadId").textContent).toBe(
        "user-picked-thread",
      );
      expect(screen.getByTestId("isExplicit").textContent).toBe("true");
    });
  });
});
