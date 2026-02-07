import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore } from "../core";
import { waitForCondition } from "./test-utils";

describe("CopilotKitCore credentials", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as any).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock window to simulate browser environment
    (global as any).window = {};
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
    }
    // Restore window
    if (originalWindow === undefined) {
      delete (global as any).window;
    } else {
      (global as any).window = originalWindow;
    }
  });

  it("does not include credentials in fetch when not configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      // NO credentials configured
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBeUndefined();
  });

  it("includes credentials: 'include' in fetch when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      credentials: "include",
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  it("includes credentials: 'same-origin' in fetch when configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      credentials: "same-origin",
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("same-origin");
  });

  it("uses updated credentials for subsequent runtime requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      // Initially no credentials
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    // First call should not have credentials
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(firstInit.credentials).toBeUndefined();

    // Update credentials
    core.setCredentials("include");

    // Trigger a new runtime request by resetting URL
    core.setRuntimeUrl(undefined);
    core.setRuntimeUrl("https://runtime.example");

    await waitForCondition(() => fetchMock.mock.calls.length >= 2);

    // Second call should have credentials
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(secondInit.credentials).toBe("include");
  });

  it("propagates credentials to remote agents created from runtime info", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        version: "1.0.0",
        agents: {
          remote: {
            name: "Remote Agent",
            description: "Remote description",
          },
        },
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      credentials: "include",
    });

    await waitForCondition(() => core.getAgent("remote") !== undefined);

    // The remote agent should have credentials configured
    const remoteAgent = core.getAgent("remote") as any;
    expect(remoteAgent).toBeDefined();
    expect(remoteAgent.credentials).toBe("include");
  });

  it("works with single-endpoint transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: "1.0.0", agents: {} }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      runtimeTransport: "single",
      credentials: "include",
    });

    await waitForCondition(() => fetchMock.mock.calls.length >= 1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://runtime.example"); // Single endpoint, no /info suffix
    expect(init.credentials).toBe("include");
  });
});
