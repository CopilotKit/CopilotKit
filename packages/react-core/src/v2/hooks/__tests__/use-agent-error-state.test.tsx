import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { useAgent } from "../use-agent";

describe("useAgent error state", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    // Leave the jsdom window intact (React 17's scheduler/renderer relies on
    // window.addEventListener and window.HTMLIFrameElement during commit) and
    // only shadow location so CopilotKitProvider's localhost auto-open-inspector
    // heuristic skips.
    if (originalWindow && typeof originalWindow === "object") {
      Object.defineProperty(originalWindow, "location", {
        value: undefined,
        configurable: true,
        writable: true,
      });
    }
    // Mock fetch to reject (simulates runtime unreachable)
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("returns a provisional agent instead of throwing when runtime is in error state", async () => {
    function TestComponent() {
      const { agent } = useAgent({ agentId: "nonexistent" });
      return <div data-testid="agent-id">{agent.agentId}</div>;
    }

    render(
      <CopilotKitProvider runtimeUrl="http://localhost:59999/nonexistent">
        <TestComponent />
      </CopilotKitProvider>,
    );

    // Should render without crashing — agent is provisional
    const el = await screen.findByTestId("agent-id");
    expect(el.textContent).toBe("nonexistent");
  });
});
