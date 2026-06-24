import { describe, it, expect } from "vitest";
import { FakeAdapter } from "./testing/fake-adapter.js";

describe("FakeAdapter", () => {
  it("records posts and drives ingress", async () => {
    const a = new FakeAdapter();
    let got: string | undefined;
    await a.start({
      onTurn: (t) => {
        got = t.userText;
      },
      onInteraction: () => {},
      onCommand: () => {},
      onThreadStarted: () => {},
      onReaction: () => {},
      onModalSubmit: async () => {},
      onModalClose: () => {},
    });
    a.emitTurn({ userText: "hi" });
    expect(got).toBe("hi");
    await a.post({}, [{ type: "text", props: { value: "x" } }]);
    expect(a.posted.length).toBe(1);
  });

  it("delivers interactions to the sink", async () => {
    const a = new FakeAdapter();
    let id: string | undefined;
    await a.start({
      onTurn: () => {},
      onInteraction: (e) => {
        id = e.id;
      },
      onCommand: () => {},
      onThreadStarted: () => {},
      onReaction: () => {},
      onModalSubmit: async () => {},
      onModalClose: () => {},
    });
    a.emitInteraction({ id: "ck:abc" });
    expect(id).toBe("ck:abc");
  });
});
