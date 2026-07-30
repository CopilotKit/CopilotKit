import { describe, it, expect } from "vitest";
import { emoji } from "@copilotkit/channels-ui";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

describe("Thread.react / unreact", () => {
  it("delegates to the adapter when supported", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const results: { ok: boolean }[] = [];
    channel.onMessage(async ({ thread, message }) => {
      results.push(await thread.react(message.ref, emoji.thumbs_up));
      results.push(await thread.unreact(message.ref, emoji.thumbs_up));
    });
    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "hi" });
    await new Promise((r) => setTimeout(r, 0));

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(fake.reactionsAdded).toEqual([
      { ref: { id: "" }, emoji: "thumbs_up" },
    ]);
    expect(fake.reactionsRemoved).toEqual([
      { ref: { id: "" }, emoji: "thumbs_up" },
    ]);
  });

  it("returns { ok: false } without throwing when unsupported", async () => {
    const fake = new FakeAdapter({ reactions: false });
    const channel = createChannel({ adapters: [fake] });
    let res: { ok: boolean; error?: string } | undefined;
    channel.onMessage(async ({ thread, message }) => {
      res = await thread.react(message.ref, emoji.heart);
    });
    await channel.ɵruntime.start();
    fake.emitTurn({ userText: "hi" });
    await new Promise((r) => setTimeout(r, 0));

    expect(res!.ok).toBe(false);
    expect(res!.error).toMatch(/does not support reactions/);
  });
});
