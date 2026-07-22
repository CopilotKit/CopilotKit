import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

/**
 * The Channel lifecycle (`start`/`stop`/`addAdapter`) is relocated onto the
 * internal `ɵruntime` surface (plan §2 / A1). The public methods delegate to it
 * during the migration and are removed once all callers use `ɵruntime`.
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

  it("the public lifecycle delegates to the same ɵruntime implementation", async () => {
    const adapter = new FakeAdapter();
    const channel = createChannel({ name: "support" });
    // Public addAdapter + start still work (delegating to ɵruntime).
    channel.addAdapter(adapter);
    await channel.start();
    expect(adapter.started).toBe(true);
  });
});
