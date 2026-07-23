import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";

const originalWindow = (globalThis as { window?: unknown }).window;

const infoResponseWithIntelligence = {
  version: "1.0.0",
  agents: {},
  audioFileTranscriptionEnabled: false,
  mode: "intelligence",
  intelligence: { wsUrl: "wss://gw.example.com/client" },
};

const infoResponseWithoutIntelligence = {
  version: "1.0.0",
  agents: {},
  audioFileTranscriptionEnabled: false,
  mode: "sse",
};

beforeEach(() => {
  // Simulate a browser environment so `updateRuntimeConnection` proceeds past
  // the SSR guard (`typeof window === "undefined"` check in agent-registry).
  (globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("stable singleton: getMemoryStore() returns the same instance on repeated calls", () => {
  const core = new CopilotKitCore({});

  const a = core.getMemoryStore();
  const b = core.getMemoryStore();

  expect(a).toBe(b);
});

test("context set when connected + intelligence configured: getState().context is not null after /info resolves with intelligence.wsUrl", async () => {
  const runtimeUrl = "https://runtime.example.com";

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(infoResponseWithIntelligence), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = fetchMock;

  const core = new CopilotKitCore({
    runtimeUrl,
    runtimeTransport: "rest",
  });

  await vi.waitFor(() => {
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  const store = core.getMemoryStore();

  expect(store.getState().context).not.toBeNull();
  expect(store.getState().context?.wsUrl).toBe("wss://gw.example.com/client");
  expect(store.getState().context?.runtimeUrl).toBe(runtimeUrl);
});

test("context null without intelligence / not connected: getState().context is null when no intelligence is present", async () => {
  const runtimeUrl = "https://runtime.example.com/no-intelligence";

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(infoResponseWithoutIntelligence), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = fetchMock;

  const core = new CopilotKitCore({
    runtimeUrl,
    runtimeTransport: "rest",
  });

  await vi.waitFor(() => {
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  const store = core.getMemoryStore();

  expect(store.getState().context).toBeNull();
});
