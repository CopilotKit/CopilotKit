// packages/channels/src/modal-submit.test.ts
import { describe, it, expect } from "vitest";
import { createChannel } from "./create-channel.js";
import { FakeAdapter } from "./testing/fake-adapter.js";

describe("channel.onModalSubmit / onModalClose", () => {
  it("routes a submission by callbackId and parses values; thread present when conversation context exists", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const seen: {
      values: Record<string, unknown>;
      user?: string;
      cb: string;
      hasThread: boolean;
    }[] = [];
    channel.onModalSubmit("triage", (evt) => {
      seen.push({
        values: evt.values,
        user: evt.user?.id,
        cb: evt.callbackId,
        hasThread: !!evt.thread,
      });
    });
    await channel.start();
    const res = await fake.emitModalSubmit({
      callbackId: "triage",
      values: { summary: "boom", prio: "high" },
      user: { id: "U1" },
      conversationKey: "c",
      replyTarget: {},
    });
    expect(res).toBeUndefined(); // no errors → closes
    expect(seen).toEqual([
      {
        values: { summary: "boom", prio: "high" },
        user: "U1",
        cb: "triage",
        hasThread: true,
      },
    ]);
  });

  it("returns the handler's field errors so the adapter can keep the modal open", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    channel.onModalSubmit("triage", (evt) =>
      evt.values.summary ? undefined : { errors: { summary: "Required" } },
    );
    await channel.start();
    const res = await fake.emitModalSubmit({
      callbackId: "triage",
      values: {},
    });
    expect(res).toEqual({ errors: { summary: "Required" } });
  });

  it("ignores submissions with no registered handler", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    await channel.start();
    const res = await fake.emitModalSubmit({
      callbackId: "unknown",
      values: {},
    });
    expect(res).toBeUndefined();
  });

  it("routes a close by callbackId", async () => {
    const fake = new FakeAdapter();
    const channel = createChannel({ adapters: [fake] });
    const closed: string[] = [];
    channel.onModalClose("triage", (evt) => {
      closed.push(evt.callbackId);
    });
    await channel.start();
    await fake.emitModalClose({ callbackId: "triage", user: { id: "U2" } });
    expect(closed).toEqual(["triage"]);
  });
});
