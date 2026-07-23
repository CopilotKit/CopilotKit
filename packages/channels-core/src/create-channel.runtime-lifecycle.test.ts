import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

/**
 * The Channel lifecycle (`start`/`stop`/`addAdapter`) lives on the internal
 * `ɵruntime` surface (plan §2 / A1). The public `Channel.start/stop/addAdapter`
 * methods have been removed — the runner (or a custom ChannelRunner) drives
 * `ɵruntime` directly.
 */
describe("Channel ɵruntime lifecycle", () => {
  it("ɵruntime.addAdapter attaches an adapter before start", async () => {
    const channel = createChannel({ name: "support" });
    const adapter = new FakeAdapter();
    channel.ɵruntime.addAdapter(adapter);
    expect(channel.adapters).toContain(adapter);
  });

  it("ɵruntime.start starts every attached adapter", async () => {
    const adapter = new FakeAdapter();
    const channel = createChannel({ name: "support", adapters: [adapter] });
    await channel.ɵruntime.start();
    expect(adapter.started).toBe(true);
  });

  it("ɵruntime.stop stops every attached adapter", async () => {
    const adapter = new FakeAdapter();
    let stopped = false;
    const origStop = adapter.stop.bind(adapter);
    adapter.stop = async () => {
      stopped = true;
      await origStop();
    };
    const channel = createChannel({ name: "support", adapters: [adapter] });
    await channel.ɵruntime.start();
    await channel.ɵruntime.stop();
    expect(stopped).toBe(true);
  });

  it("does not expose a public start/stop/addAdapter surface", () => {
    const channel = createChannel({ name: "support" });
    // The public lifecycle API was removed (A1); only the ɵruntime seam remains.
    expect(
      (channel as unknown as Record<string, unknown>).start,
    ).toBeUndefined();
    expect(
      (channel as unknown as Record<string, unknown>).stop,
    ).toBeUndefined();
    expect(
      (channel as unknown as Record<string, unknown>).addAdapter,
    ).toBeUndefined();
    expect(
      (channel as unknown as Record<string, unknown>).provider,
    ).toBeUndefined();
  });
});
