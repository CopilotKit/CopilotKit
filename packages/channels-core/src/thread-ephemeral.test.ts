import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

async function runOnMessage(
  fake: FakeAdapter,
  fn: Parameters<ReturnType<typeof createChannel>["onMessage"]>[0],
) {
  const channel = createChannel({ adapters: [fake] });
  channel.onMessage(fn);
  await channel.ɵruntime.start();
  fake.emitTurn({ userText: "hi", user: { id: "U1" } });
  await new Promise((r) => setTimeout(r, 0));
}

describe("Thread.postEphemeral", () => {
  it("posts natively when the surface supports it (usedFallback=false)", async () => {
    const fake = new FakeAdapter({ nativeEphemeral: true });
    let res: unknown;
    await runOnMessage(fake, async ({ thread, message }) => {
      res = await thread.postEphemeral(message.user, "psst", {
        fallbackToDM: false,
      });
    });
    expect(res).toMatchObject({ ok: true, usedFallback: false });
    expect(fake.ephemeralPosts).toHaveLength(1);
    // Renderable was bound to IR before reaching the adapter.
    expect(Array.isArray(fake.ephemeralPosts[0]!.ir)).toBe(true);
  });

  it("DM-falls-back when native is unsupported and fallbackToDM=true (usedFallback=true)", async () => {
    const fake = new FakeAdapter({ nativeEphemeral: false });
    let res: unknown;
    await runOnMessage(fake, async ({ thread, message }) => {
      res = await thread.postEphemeral(message.user, "psst", {
        fallbackToDM: true,
      });
    });
    expect(res).toMatchObject({ ok: true, usedFallback: true });
  });

  it("returns null when native unsupported and fallbackToDM=false", async () => {
    const fake = new FakeAdapter({ nativeEphemeral: false });
    let res: unknown = "sentinel";
    await runOnMessage(fake, async ({ thread, message }) => {
      res = await thread.postEphemeral(message.user, "psst", {
        fallbackToDM: false,
      });
    });
    expect(res).toBeNull();
  });
});
