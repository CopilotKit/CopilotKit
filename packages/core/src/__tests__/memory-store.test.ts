import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MockSocket } from "./test-utils";

// Phoenix mock harness: seeding the shared metadata socket
// (`core.ɵgetMetadataSocket(joinToken)`) constructs a real
// `ɵcreateMetadataSocket`, which connects through the mocked `phoenix` module
// below. `phoenix.sockets` captures every socket constructed so tests can
// assert the underlying socket was disposed (`disconnected`) on
// disconnect/header-change.
const phoenix = vi.hoisted(() => ({
  sockets: [] as MockSocket[],
}));

vi.mock("phoenix", () => ({
  Socket: class extends MockSocket {
    constructor(url = "", opts: Record<string, any> = {}) {
      super(url, opts);
      phoenix.sockets.push(this);
    }
  },
}));

// Dynamic import (mirrors memory.test.ts): the `../core` module transitively
// loads `phoenix-observable` -> `phoenix`, so it must be imported AFTER the
// `vi.mock("phoenix", ...)` factory's captured variables are initialized.
const { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } =
  await import("../core");

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
  phoenix.sockets.splice(0);
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
  expect(typeof store.getState().context?.getMetadataSocket).toBe("function");
  expect(store.getState().context?.runtimeUrl).toBe(runtimeUrl);
});

test("ɵgetMetadataSocket(): seeds ONE memoized socket while connected; undefined before connected", async () => {
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

  // Before the `/info` fetch resolves the runtime is not yet connected, so no
  // shared socket can be seeded.
  expect(core.ɵgetMetadataSocket("t1")).toBeUndefined();

  await vi.waitFor(() => {
    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
  });

  // The socket is seeded from the FIRST consumer's joinToken and memoized: a
  // second call with a DIFFERENT token returns the SAME socket (the token arg
  // is ignored after the first seed — the socket is already authenticated).
  const a = core.ɵgetMetadataSocket("t1");
  const b = core.ɵgetMetadataSocket("t2");

  expect(a).toBeDefined();
  expect(a).toBe(b);
  // Exactly one underlying phoenix socket was constructed.
  expect(phoenix.sockets.length).toBe(1);
});

test("B6: disposes the shared socket when the runtime disconnects", async () => {
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

  // Seed the shared socket.
  const s = core.ɵgetMetadataSocket("jt");
  expect(s).toBeDefined();
  expect(phoenix.sockets.length).toBe(1);
  const underlying = phoenix.sockets[0];
  expect(underlying).toBeDefined();
  if (!underlying) throw new Error("expected a seeded phoenix socket");

  // Real disconnect: dropping the runtime URL moves the connection status to
  // Disconnected and fires `onRuntimeConnectionStatusChanged`, which disposes
  // the shared metadata socket (tearing down the underlying phoenix socket).
  core.setRuntimeUrl(undefined);

  await vi.waitFor(() => {
    expect(underlying.disconnected).toBe(true);
  });

  expect(core.runtimeConnectionStatus).toBe(
    CopilotKitCoreRuntimeConnectionStatus.Disconnected,
  );
  // No socket can be seeded while disconnected.
  expect(core.ɵgetMetadataSocket("jt")).toBeUndefined();
});

test("B7: setHeaders tears down the socket and the next consumer re-seeds a fresh one", async () => {
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

  const first = core.ɵgetMetadataSocket("jt1");
  expect(first).toBeDefined();
  expect(phoenix.sockets.length).toBe(1);

  // A header change re-mints the join token, so the shared socket is torn down;
  // the next consumer re-seeds a fresh socket with the fresh token.
  core.setHeaders({ Authorization: "Bearer rotated" });

  const second = core.ɵgetMetadataSocket("jt2");
  expect(second).toBeDefined();
  // A DIFFERENT instance — the old one was disposed and a fresh socket seeded.
  expect(second).not.toBe(first);
  expect(phoenix.sockets.length).toBe(2);
  // The first underlying socket was disconnected on the header change.
  const firstUnderlying = phoenix.sockets[0];
  expect(firstUnderlying).toBeDefined();
  expect(firstUnderlying?.disconnected).toBe(true);
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
