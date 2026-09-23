import { defineComponent } from "vue";
import { render, cleanup } from "@testing-library/vue";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { useAgent } from "../use-agent";

const HINT =
  "If the runtime runs in intelligence mode (with `intelligence` options), /info only exposes agents when a runtime-level `identifyUser` is configured.";

/**
 * An intelligence-mode runtime without a runtime-level `identifyUser` answers
 * /info with no agents. The "not found" error names that cause only when it
 * can apply.
 */
describe("useAgent not-found error", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  function mockRuntimeInfo(info: Record<string, unknown>) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "1.0.0",
        audioFileTranscriptionEnabled: false,
        ...info,
      }),
    });
  }

  async function notFoundMessage(): Promise<string> {
    const capturedErrors: Error[] = [];
    const Consumer = defineComponent({
      setup() {
        useAgent();
        return {};
      },
      template: "<div />",
    });
    const Host = defineComponent({
      components: { CopilotKitProvider, Consumer },
      template: `
        <CopilotKitProvider runtime-url="http://localhost:3000/api">
          <Consumer />
        </CopilotKitProvider>
      `,
    });
    render(Host, {
      global: {
        config: {
          errorHandler: (error) => {
            capturedErrors.push(error as Error);
          },
        },
      },
    });
    await vi.waitFor(() => expect(capturedErrors.length).toBeGreaterThan(0));
    return capturedErrors[0]!.message;
  }

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

  it("names identifyUser when an intelligence runtime reports no agents", async () => {
    mockRuntimeInfo({ mode: "intelligence", agents: {} });
    const message = await notFoundMessage();
    expect(message).toContain(
      "useAgent: Agent 'default' not found after runtime sync (runtimeUrl=http://localhost:3000/api). No agents registered. Verify your runtime /info and/or agents__unsafe_dev_only.",
    );
    expect(message).toContain(HINT);
  });

  it("leaves the hint out for a runtime that is not in intelligence mode", async () => {
    mockRuntimeInfo({ agents: {} });
    const message = await notFoundMessage();
    expect(message).toContain("Agent 'default' not found after runtime sync");
    expect(message).not.toContain("identifyUser");
  });
});
