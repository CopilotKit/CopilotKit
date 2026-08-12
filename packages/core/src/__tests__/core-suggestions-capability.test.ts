/**
 * Tests that the stateless `suggestions` capability advertised by the
 * runtime's /info response is surfaced on the client, mirroring how the
 * sibling `intelligence`/`threadEndpoints` capabilities are threaded through
 * the agent registry to a public `CopilotKitCore` getter.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

describe("suggestions runtime info capability", () => {
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
        mode: "sse",
        agents: {},
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

  it("surfaces suggestions:true from /info", async () => {
    mockRuntimeInfo({ suggestions: true });

    const core = await connectedCore();

    expect(core.suggestions).toBe(true);
  });

  it("leaves suggestions undefined when the runtime omits it", async () => {
    mockRuntimeInfo({});

    const core = await connectedCore();

    expect(core.suggestions).toBeUndefined();
  });

  it("surfaces an explicit suggestions:false from /info", async () => {
    // A runtime that explicitly advertises `false` must NOT enable the
    // stateless path. This pins the strict `=== true` gate in
    // `generateSuggestions` against a future truthy-check regression that would
    // treat `false` (or any non-`true` value) as capable.
    mockRuntimeInfo({ suggestions: false });

    const core = await connectedCore();

    expect(core.suggestions).toBe(false);
  });
});
