import { firstValueFrom } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockSocket } from "../../__tests__/test-utils";

// Phoenix mock harness: `ɵcreateMetadataSocket` opens a real Phoenix socket
// via `ɵphoenixSocket$`, so the `phoenix` module is mocked here (mirrors
// `memory.test.ts` / `threads.test.ts`). `phoenix.sockets` captures every
// socket constructed so tests can inspect it.
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

// Must come after vi.mock so phoenix is mocked when the module is loaded.
const { ɵcreateMetadataSocket, ɵMETADATA_MAX_SOCKET_RETRIES } =
  await import("../metadata-realtime");

describe("ɵcreateMetadataSocket", () => {
  beforeEach(() => {
    phoenix.sockets.length = 0;
  });

  it("opens exactly one socket with the given join_token and yields the session", async () => {
    const handle = ɵcreateMetadataSocket({
      wsUrl: "wss://gw/client",
      joinToken: "tok-123",
    });

    const session = await firstValueFrom(handle.socket.socket$);

    expect(phoenix.sockets).toHaveLength(1);
    expect(phoenix.sockets[0]!.opts.params).toEqual({ join_token: "tok-123" });
    expect(session.socket).toBe(phoenix.sockets[0]);

    handle.dispose();
  });

  it("shares ONE socket across multiple socket$ subscribers", async () => {
    const handle = ɵcreateMetadataSocket({
      wsUrl: "wss://gw/client",
      joinToken: "tok-123",
    });

    const s1 = handle.socket.socket$.subscribe();
    const s2 = handle.socket.socket$.subscribe();
    await Promise.resolve();

    expect(phoenix.sockets).toHaveLength(1); // shared, refCount:false

    s1.unsubscribe();
    s2.unsubscribe();
    handle.dispose();
  });

  it("dispose() disconnects the socket and is idempotent", () => {
    const handle = ɵcreateMetadataSocket({
      wsUrl: "wss://gw/client",
      joinToken: "tok-123",
    });

    // Eager health subscribe opens the socket at creation.
    expect(phoenix.sockets).toHaveLength(1);
    expect(phoenix.sockets[0]!.disconnected).toBe(false);

    handle.dispose();
    expect(phoenix.sockets[0]!.disconnected).toBe(true);

    // Idempotent: a second call must not throw.
    expect(() => handle.dispose()).not.toThrow();
  });

  it("socketFatal$ emits once after MAX consecutive errors and replays to late subscribers", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handle = ɵcreateMetadataSocket({
      wsUrl: "wss://gw/client",
      joinToken: "tok-123",
    });

    let earlyEmissions = 0;
    const early = handle.socket.socketFatal$.subscribe(() => {
      earlyEmissions += 1;
    });

    const socket = phoenix.sockets[0];
    if (!socket) {
      throw new Error("expected a phoenix socket to exist");
    }

    // Drive MAX consecutive transport errors with no intervening `open`.
    for (let i = 0; i < ɵMETADATA_MAX_SOCKET_RETRIES; i += 1) {
      socket.triggerError();
    }

    expect(earlyEmissions).toBe(1);
    expect(warn).toHaveBeenCalled();

    // A LATE subscriber (after the give-up) still receives it via the latch.
    await expect(
      firstValueFrom(handle.socket.socketFatal$),
    ).resolves.toBeUndefined();

    early.unsubscribe();
    warn.mockRestore();
    handle.dispose();
  });

  it("hands out a consumer view with no dispose (only socket$ and socketFatal$)", () => {
    const handle = ɵcreateMetadataSocket({
      wsUrl: "wss://gw/client",
      joinToken: "tok-123",
    });

    expect(Object.keys(handle.socket).sort()).toEqual([
      "socket$",
      "socketFatal$",
    ]);
    expect("dispose" in handle.socket).toBe(false);

    handle.dispose();
  });
});
