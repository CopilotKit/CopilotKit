// packages/channels/src/open-modal.test.tsx
import { describe, it, expect } from "vitest";
import { Modal, TextInput } from "@copilotkit/channels-ui";
import { createBot } from "./create-bot.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const view = (
  <Modal callbackId="triage" title="Triage">
    <TextInput id="summary" label="Summary" />
  </Modal>
);

describe("ctx.openModal", () => {
  it("opens a modal from an interaction when a triggerId is present", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    let res: unknown;
    bot.onInteraction("ck:open", async (ctx) => {
      res = await ctx.openModal!(view);
    });
    await bot.start();
    fake.emitInteraction({ id: "ck:open", triggerId: "T123" });
    await tick();
    expect(res).toEqual({ ok: true });
    expect(fake.openedModals).toHaveLength(1);
    expect(fake.openedModals[0]!.triggerId).toBe("T123");
    expect(fake.openedModals[0]!.ir[0]!.type).toBe("modal");
  });

  it("opens a modal from a command", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    let res: unknown;
    bot.onCommand("triage", async (ctx) => {
      res = await ctx.openModal!(view);
    });
    await bot.start();
    await fake.emitCommand({ command: "triage", triggerId: "T999" });
    expect(res).toEqual({ ok: true });
    expect(fake.openedModals[0]!.triggerId).toBe("T999");
  });

  it("omits openModal when no triggerId is present", async () => {
    const fake = new FakeAdapter();
    const bot = createBot({ adapters: [fake] });
    let hasOpen = true;
    bot.onInteraction("ck:noop", (ctx) => {
      hasOpen = typeof ctx.openModal === "function";
    });
    await bot.start();
    fake.emitInteraction({ id: "ck:noop" });
    await tick();
    expect(hasOpen).toBe(false);
  });

  it("omits openModal when the adapter has no modal support", async () => {
    const fake = new FakeAdapter({ modals: false });
    const bot = createBot({ adapters: [fake] });
    let hasOpen = true;
    bot.onInteraction("ck:x", (ctx) => {
      hasOpen = typeof ctx.openModal === "function";
    });
    await bot.start();
    fake.emitInteraction({ id: "ck:x", triggerId: "T1" });
    await tick();
    expect(hasOpen).toBe(false);
  });
});
