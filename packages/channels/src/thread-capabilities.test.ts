import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

describe("onThreadStarted routing", () => {
  it("invokes registered handlers with the thread and user", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const seen: { user?: string; platform: string }[] = [];
    channel.onThreadStarted(({ thread, user }) => {
      seen.push({ user: user?.id, platform: thread.platform });
    });
    await channel.start();

    await fake.emitThreadStarted({ user: { id: "U1", name: "Ada" } });
    expect(seen).toEqual([{ user: "U1", platform: "fake" }]);
  });

  it("invokes every registered handler in order", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const order: number[] = [];
    channel.onThreadStarted(() => {
      order.push(1);
    });
    channel.onThreadStarted(() => {
      order.push(2);
    });
    await channel.start();
    await fake.emitThreadStarted();
    expect(order).toEqual([1, 2]);
  });

  it("is a no-op when no handler is registered", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    await channel.start();
    // Should not throw.
    await expect(
      Promise.resolve(fake.emitThreadStarted()),
    ).resolves.toBeUndefined();
  });
});

describe("Thread.setSuggestedPrompts / setTitle capability gating", () => {
  it("delegates to the adapter when supported", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const results: { ok: boolean; error?: string }[] = [];
    channel.onThreadStarted(async ({ thread }) => {
      results.push(
        await thread.setSuggestedPrompts(
          [{ title: "Triage", message: "Triage my issues" }],
          { title: "Try" },
        ),
      );
      results.push(await thread.setTitle("My conversation"));
    });
    await channel.start();
    await fake.emitThreadStarted({ replyTarget: { channel: "D1" } });

    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(fake.suggestedPromptsCalls).toHaveLength(1);
    expect(fake.suggestedPromptsCalls[0]).toMatchObject({
      target: { channel: "D1" },
      prompts: [{ title: "Triage", message: "Triage my issues" }],
      opts: { title: "Try" },
    });
    expect(fake.threadTitleCalls).toEqual([
      { target: { channel: "D1" }, title: "My conversation" },
    ]);
  });

  it("returns { ok: false } without throwing when unsupported", async () => {
    const fake = new FakeAdapter({ paneMethods: false });
    const channel = createChannel({ adapters: [fake] });
    const results: { ok: boolean; error?: string }[] = [];
    channel.onThreadStarted(async ({ thread }) => {
      results.push(await thread.setSuggestedPrompts([]));
      results.push(await thread.setTitle("nope"));
    });
    await channel.start();
    await fake.emitThreadStarted();

    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toMatch(/does not support suggested prompts/);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.error).toMatch(/does not support thread titles/);
    expect(fake.suggestedPromptsCalls).toHaveLength(0);
    expect(fake.threadTitleCalls).toHaveLength(0);
  });
});
