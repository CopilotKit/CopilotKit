import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ɵRuntimeInfoStore } from "../runtime-info";
import type { ɵRuntimeInfo } from "../runtime-info";
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";

function createInfo(overrides: Partial<ɵRuntimeInfo> = {}): ɵRuntimeInfo {
  return {
    status: CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    a2uiEnabled: false,
    a2uiAgents: undefined,
    openGenerativeUIEnabled: false,
    licenseStatus: undefined,
    runtimeEntitlements: undefined,
    runtimeEntitlementRetryPending: false,
    threadEndpoints: undefined,
    intelligence: undefined,
    audioFileTranscriptionEnabled: false,
    ...overrides,
  };
}

describe("ɵRuntimeInfoStore", () => {
  it("keeps the snapshot identity while the source is unchanged", () => {
    const store = new ɵRuntimeInfoStore(() => createInfo());
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
  });

  it("returns a new snapshot when one field changes", () => {
    let info = createInfo();
    const store = new ɵRuntimeInfoStore(() => info);
    const before = store.getSnapshot();
    info = createInfo({ licenseStatus: "valid" });
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.licenseStatus).toBe("valid");
  });

  it("notifies on refresh only when the snapshot changed", () => {
    let info = createInfo();
    const store = new ɵRuntimeInfoStore(() => info);
    const listener = vi.fn();
    store.subscribe(listener);
    store.refresh();
    expect(listener).toHaveBeenCalledTimes(0);
    info = createInfo({ a2uiEnabled: true });
    store.refresh();
    store.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies on refresh after a read already picked up the change", () => {
    let info = createInfo();
    const store = new ɵRuntimeInfoStore(() => info);
    const listener = vi.fn();
    store.subscribe(listener);
    info = createInfo({ runtimeEntitlementRetryPending: true });
    store.getSnapshot();
    store.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe and dispose", () => {
    let info = createInfo();
    const store = new ɵRuntimeInfoStore(() => info);
    const unsubscribed = vi.fn();
    const disposed = vi.fn();
    store.subscribe(unsubscribed)();
    store.subscribe(disposed);
    store.dispose();
    info = createInfo({ a2uiEnabled: true });
    store.refresh();
    expect(unsubscribed).not.toHaveBeenCalled();
    expect(disposed).not.toHaveBeenCalled();
  });
});

describe("CopilotKitCore.ɵruntimeInfo", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = global.fetch;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: "1.0.0",
          agents: {},
          a2uiEnabled: true,
          openGenerativeUIEnabled: true,
          licenseStatus: "valid",
          audioFileTranscriptionEnabled: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("reflects /info and notifies once it lands", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    const initial = core.ɵruntimeInfo;
    expect(initial.status).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Disconnected,
    );
    const listener = vi.fn();
    core.ɵsubscribeToRuntimeInfo(listener);

    core.connect();

    await vi.waitFor(() =>
      expect(core.ɵruntimeInfo.status).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      ),
    );
    expect(core.ɵruntimeInfo).toMatchObject({
      a2uiEnabled: true,
      openGenerativeUIEnabled: true,
      licenseStatus: "valid",
      audioFileTranscriptionEnabled: true,
    });
    expect(listener).toHaveBeenCalled();
    core.dispose();
  });
});
