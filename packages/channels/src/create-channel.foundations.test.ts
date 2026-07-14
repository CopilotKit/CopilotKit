import { describe, it, expect, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { MemoryStore } from "./state/memory-store.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createChannel — optional adapters + addAdapter", () => {
  it("starts with no adapters and runs one added before start()", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ agent: () => new FakeAgent() });
    channel.addAdapter(fake);
    await channel.start();
    expect(fake.started).toBe(true);
  });

  it("throws when addAdapter is called after start()", async () => {
    const channel = createChannel({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
    });
    await channel.start();
    expect(() => channel.addAdapter(new FakeAdapter())).toThrow(/start/i);
  });

  it("is idempotent: a second start() does not re-start adapters or rebuild state", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    const startSpy = vi.spyOn(fake, "start");
    await channel.start();
    const transcriptsAfterFirst = channel.transcripts;
    await channel.start(); // second call must be a no-op
    expect(startSpy).toHaveBeenCalledTimes(1);
    // Same transcript-store instance → state (locks/dedup/actions) not wiped.
    expect(channel.transcripts).toBe(transcriptsAfterFirst);
  });

  it("allows a real restart after stop() (start → stop → start re-inits)", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    const startSpy = vi.spyOn(fake, "start");
    await channel.start();
    await channel.stop();
    await channel.start(); // stop() cleared `started`, so this is a real restart
    expect(startSpy).toHaveBeenCalledTimes(2);
  });
});

describe("createChannel — transcripts deferred to start()", () => {
  it("throws if channel.transcripts is accessed before start()", () => {
    const channel = createChannel({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
      store: {
        adapter: new MemoryStore(),
        identity: () => "u@x.com",
        transcripts: {},
      },
    });
    expect(() => channel.transcripts).toThrow(/start/i);
  });
});

describe("createChannel — store resolution", () => {
  it("uses an adapter-provided stateStore when no explicit store.adapter", async () => {
    const adapterStore = new MemoryStore();

    // Seed the adapter's store via a throwaway channel so we can prove the real
    // channel reads from that exact instance.
    const seeder = createChannel({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
      store: {
        adapter: adapterStore,
        identity: () => "u@x.com",
        transcripts: {},
      },
    });
    await seeder.start();
    await seeder.transcripts.append(
      { platform: "fake", conversationKey: "c" },
      { role: "user", text: "seeded" },
      { userKey: "u@x.com" },
    );

    const fake = new FakeAdapter();
    fake.stateStore = adapterStore;
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: { identity: () => "u@x.com", transcripts: {} },
    });
    await channel.start();

    const entries = await channel.transcripts.list({ userKey: "u@x.com" });
    expect(entries.map((e) => e.text)).toContain("seeded");
  });

  it("explicit store.adapter wins over an adapter-provided one, silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = new FakeAdapter();
    fake.stateStore = new MemoryStore();
    const explicit = new MemoryStore();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: {
        adapter: explicit,
        identity: () => "u@x.com",
        transcripts: {},
      },
    });
    await channel.start();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when ≥2 adapters provide a stateStore", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = new FakeAdapter({ platform: "a" });
    a.stateStore = new MemoryStore();
    const b = new FakeAdapter({ platform: "b" });
    b.stateStore = new MemoryStore();
    const channel = createChannel({
      adapters: [a, b],
      agent: () => new FakeAgent(),
    });
    await channel.start();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("state store"));
    warn.mockRestore();
  });
});

describe("createChannel — id propagation to handler context", () => {
  it("threads turnId/deliveryId from IncomingTurn onto message", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    let seen: { turnId?: string; deliveryId?: string; eventId?: string } = {};
    channel.onMessage(async ({ message }) => {
      seen = {
        turnId: message.turnId,
        deliveryId: message.deliveryId,
        eventId: message.eventId,
      };
    });
    await channel.start();
    fake.emitTurn({
      userText: "hi",
      conversationKey: "c1",
      eventId: "e1",
      turnId: "t1",
      deliveryId: "d1",
    });
    await tick();
    expect(seen).toEqual({ turnId: "t1", deliveryId: "d1", eventId: "e1" });
  });
});
