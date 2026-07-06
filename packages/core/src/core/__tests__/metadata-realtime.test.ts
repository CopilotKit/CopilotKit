import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { MockSocket } from "../../__tests__/test-utils";

// Phoenix mock harness: `ɵcreateMetadataRealtimeConnection` opens a real
// Phoenix socket via `ɵphoenixSocket$`, so the `phoenix` module is mocked
// here (mirrors `memory.test.ts` / `threads.test.ts`). `phoenix.sockets`
// captures every socket constructed so tests could inspect it if needed.
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
const { ɵcreateMetadataRealtimeConnection } =
  await import("../metadata-realtime");

describe("ɵcreateMetadataRealtimeConnection", () => {
  it("does not fetch the subscription or connect until socket$ is subscribed", () => {
    const fetchSubscription = vi
      .fn()
      .mockResolvedValue({ joinToken: "t", joinCode: "R" });
    const conn = ɵcreateMetadataRealtimeConnection({
      wsUrl: "wss://gw/client",
      fetchSubscription,
    });

    expect(fetchSubscription).not.toHaveBeenCalled(); // lazy

    conn.dispose();
  });

  it("fetches the subscription exactly once across multiple socket$ subscribers", async () => {
    const fetchSubscription = vi
      .fn()
      .mockResolvedValue({ joinToken: "t", joinCode: "R" });
    const conn = ɵcreateMetadataRealtimeConnection({
      wsUrl: "wss://gw/client",
      fetchSubscription,
    });

    const s1 = conn.socket$.subscribe();
    const s2 = conn.socket$.subscribe();
    await Promise.resolve();

    expect(fetchSubscription).toHaveBeenCalledTimes(1); // shared, refCount:false

    s1.unsubscribe();
    s2.unsubscribe();
    conn.dispose();
  });

  it("replays joinCode R to late subscribers", async () => {
    const conn = ɵcreateMetadataRealtimeConnection({
      wsUrl: "wss://gw/client",
      fetchSubscription: async () => ({ joinToken: "t", joinCode: "R" }),
    });

    await firstValueFrom(conn.socket$); // trigger the fetch
    await expect(firstValueFrom(conn.joinCode$)).resolves.toBe("R");

    conn.dispose();
  });
});
