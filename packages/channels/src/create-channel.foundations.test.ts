import { describe, it, expect, vi } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";
import { FakeAgent } from "./testing/fake-agent.js";
import { MemoryStore } from "./state/memory-store.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createChannel — optional adapters + addAdapter", () => {
  it("starts with no adapters and runs one added before start()", async () => {
    const fake = new FakeAdapter();
    const bot = createChannel({ agent: () => new FakeAgent() });
    bot.addAdapter(fake);
    await bot.start();
    expect(fake.started).toBe(true);
  });

  it("throws when addAdapter is called after start()", async () => {
    const bot = createChannel({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
    });
    await bot.start();
    expect(() => bot.addAdapter(new FakeAdapter())).toThrow(/start/i);
  });

  it("is idempotent: a second start() does not re-start adapters or rebuild state", async () => {
    const fake = new FakeAdapter();
    const bot = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    const startSpy = vi.spyOn(fake, "start");
    await bot.start();
    const transcriptsAfterFirst = bot.transcripts;
    await bot.start(); // second call must be a no-op
    expect(startSpy).toHaveBeenCalledTimes(1);
    // Same transcript-store instance → state (locks/dedup/actions) not wiped.
    expect(bot.transcripts).toBe(transcriptsAfterFirst);
  });

  it("allows a real restart after stop() (start → stop → start re-inits)", async () => {
    const fake = new FakeAdapter();
    const bot = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    const startSpy = vi.spyOn(fake, "start");
    await bot.start();
    await bot.stop();
    await bot.start(); // stop() cleared `started`, so this is a real restart
    expect(startSpy).toHaveBeenCalledTimes(2);
  });
});

describe("createChannel — transcripts deferred to start()", () => {
  it("throws if bot.transcripts is accessed before start()", () => {
    const bot = createChannel({
      adapters: [new FakeAdapter()],
      agent: () => new FakeAgent(),
      store: {
        adapter: new MemoryStore(),
        identity: () => "u@x.com",
        transcripts: {},
      },
    });
    expect(() => bot.transcripts).toThrow(/start/i);
  });
});

describe("createChannel — store resolution", () => {
  it("uses an adapter-provided stateStore when no explicit store.adapter", async () => {
    const adapterStore = new MemoryStore();

    // Seed the adapter's store via a throwaway bot so we can prove the real
    // bot reads from that exact instance.
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
    const bot = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: { identity: () => "u@x.com", transcripts: {} },
    });
    await bot.start();

    const entries = await bot.transcripts.list({ userKey: "u@x.com" });
    expect(entries.map((e) => e.text)).toContain("seeded");
  });

  it("explicit store.adapter wins over an adapter-provided one, silently", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fake = new FakeAdapter();
    fake.stateStore = new MemoryStore();
    const explicit = new MemoryStore();
    const bot = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
      store: {
        adapter: explicit,
        identity: () => "u@x.com",
        transcripts: {},
      },
    });
    await bot.start();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when ≥2 adapters provide a stateStore", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = new FakeAdapter({ platform: "a" });
    a.stateStore = new MemoryStore();
    const b = new FakeAdapter({ platform: "b" });
    b.stateStore = new MemoryStore();
    const bot = createChannel({
      adapters: [a, b],
      agent: () => new FakeAgent(),
    });
    await bot.start();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("state store"));
    warn.mockRestore();
  });
});

describe("createChannel — id propagation to handler context", () => {
  it("threads turnId/deliveryId from IncomingTurn onto message", async () => {
    const fake = new FakeAdapter();
    const bot = createChannel({
      adapters: [fake],
      agent: () => new FakeAgent(),
    });
    let seen: { turnId?: string; deliveryId?: string; eventId?: string } = {};
    bot.onMessage(async ({ message }) => {
      seen = {
        turnId: message.turnId,
        deliveryId: message.deliveryId,
        eventId: message.eventId,
      };
    });
    await bot.start();
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
