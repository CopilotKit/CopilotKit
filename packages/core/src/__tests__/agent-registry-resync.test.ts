import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

/**
 * `setRuntimeTransport` must be idempotent on the requested transport MODE.
 * Auto-detect resolves "auto" → a concrete transport ("rest"/"single") and
 * writes that back, so a guard comparing the resolved value would treat a
 * re-applied "auto" (which the provider effect does on every render) as a
 * change and re-run the entire `/info` handshake — needlessly rebuilding the
 * runtime agents mid-session. Guard on the requested mode instead.
 */
describe("CopilotKitCore runtime re-sync", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as unknown as { window?: unknown }).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (global as unknown as { window?: unknown }).window = {};
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as { fetch?: typeof fetch }).fetch;
    }
    if (originalWindow === undefined) {
      delete (global as unknown as { window?: unknown }).window;
    } else {
      (global as unknown as { window?: unknown }).window = originalWindow;
    }
  });

  it("re-applying the 'auto' transport after auto-detect does not refetch /info", async () => {
    // `setRuntimeTransport` must be idempotent on the requested MODE. Auto-detect
    // resolves "auto" → a concrete transport ("rest") and writes that back; the
    // guard must not treat a re-applied "auto" as a change (which would re-run
    // the whole /info handshake every time the provider effect re-renders).
    const info = {
      version: "1.0.0",
      agents: { default: { description: "assistant", capabilities: {} } },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(info),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // Default transport is "auto" → first connect auto-detects and resolves to REST.
    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => fetchMock.mock.calls.length >= 1);
    const callsAfterConnect = fetchMock.mock.calls.length;

    // The provider effect re-applies the SAME requested mode on every render.
    core.setRuntimeTransport("auto");
    core.setRuntimeTransport("auto");
    await new Promise((r) => setTimeout(r, 30));

    // No additional /info handshake was triggered.
    expect(fetchMock.mock.calls.length).toBe(callsAfterConnect);
  });
});
