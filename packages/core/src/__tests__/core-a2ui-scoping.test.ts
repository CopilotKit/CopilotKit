/**
 * Tests that the per-agent A2UI scoping advertised by the runtime's /info
 * response is preserved on the client instead of being flattened into an
 * endpoint-wide boolean.
 *
 * Regression for #5369: `a2uiEnabled: !!runtime.a2ui` discarded
 * `runtime.a2ui.agents`, so the client injected the full A2UI catalog
 * context (~30KB) into every agent's runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

describe("A2UI runtime info scoping (#5369)", () => {
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
      delete (global as unknown as { fetch?: typeof fetch }).fetch;
    }
    if (originalWindow === undefined) {
      delete (global as unknown as { window?: unknown }).window;
    } else {
      (global as unknown as { window?: unknown }).window = originalWindow;
    }
  });

  function mockRuntimeInfo(info: Record<string, unknown>) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        version: "1.0.0",
        agents: { default: { description: "assistant", capabilities: {} } },
        ...info,
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  async function connectedCore(): Promise<CopilotKitCore> {
    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.runtimeVersion !== undefined);
    return core;
  }

  it("parses the scoped a2ui info object", async () => {
    mockRuntimeInfo({
      a2uiEnabled: true,
      a2ui: { enabled: true, agents: ["agentic_chat", "agentic_genui"] },
    });

    const core = await connectedCore();

    expect(core.a2uiEnabled).toBe(true);
    expect(core.a2uiAgents).toEqual(["agentic_chat", "agentic_genui"]);
  });

  it("treats a2ui info without an agents list as endpoint-wide", async () => {
    mockRuntimeInfo({ a2uiEnabled: true, a2ui: { enabled: true } });

    const core = await connectedCore();

    expect(core.a2uiEnabled).toBe(true);
    expect(core.a2uiAgents).toBeUndefined();
  });

  it("falls back to the legacy a2uiEnabled boolean from older runtimes", async () => {
    mockRuntimeInfo({ a2uiEnabled: true });

    const core = await connectedCore();

    expect(core.a2uiEnabled).toBe(true);
    expect(core.a2uiAgents).toBeUndefined();
  });

  it("reports a2ui disabled when the runtime does not configure it", async () => {
    mockRuntimeInfo({ a2uiEnabled: false });

    const core = await connectedCore();

    expect(core.a2uiEnabled).toBe(false);
    expect(core.a2uiAgents).toBeUndefined();
  });
});
