import { defineComponent } from "vue";
import { render, screen, cleanup } from "@testing-library/vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { useAgent } from "../use-agent";

describe("useAgent error state", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    // Simulate browser environment
    (globalThis as { window?: unknown }).window = {};
    // Mock fetch to reject (simulates runtime unreachable)
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("returns a provisional agent instead of throwing when runtime is in error state", async () => {
    const capturedErrors: unknown[] = [];

    const TestComponent = defineComponent({
      setup() {
        const { agent } = useAgent({ agentId: "nonexistent" });
        return { agent };
      },
      template: `<div data-testid="agent-id">{{ agent.agentId }}</div>`,
    });

    const Host = defineComponent({
      components: { CopilotKitProvider, TestComponent },
      template: `
        <CopilotKitProvider runtime-url="http://localhost:59999/nonexistent">
          <TestComponent />
        </CopilotKitProvider>
      `,
    });

    render(Host, {
      global: {
        config: {
          errorHandler: (error) => {
            capturedErrors.push(error);
          },
        },
      },
    });

    // Should render without crashing — agent is provisional
    const el = await screen.findByTestId("agent-id");
    expect(el.textContent).toBe("nonexistent");
    expect(capturedErrors).toEqual([]);
  });
});
