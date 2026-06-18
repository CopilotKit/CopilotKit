import { describe, it, expect } from "vitest";
import { decodeInteraction } from "./interaction.js";

describe("decodeInteraction", () => {
  it("decodes a CARD_CLICKED event into an InteractionEvent", () => {
    const evt = decodeInteraction({
      type: "CARD_CLICKED",
      space: { name: "spaces/A", type: "ROOM" },
      message: {
        name: "spaces/A/messages/M1",
        thread: { name: "spaces/A/threads/T1" },
      },
      user: { name: "users/9", displayName: "Ada" },
      common: {
        invokedFunction: "ck:z",
        parameters: [{ key: "value", value: '{"ok":1}' }],
      },
    });
    expect(evt!.id).toBe("ck:z");
    expect(evt!.conversationKey).toBe("spaces/A::spaces/A/threads/T1");
    expect(evt!.value).toEqual({ ok: 1 });
    expect((evt!.messageRef as any).id).toBe("spaces/A/messages/M1");
    expect(evt!.user).toEqual({ id: "users/9", name: "Ada" });
  });

  it("returns undefined for non-CARD_CLICKED events", () => {
    expect(decodeInteraction({ type: "MESSAGE" })).toBeUndefined();
  });

  it("leaves value undefined when there is no `value` parameter", () => {
    const evt = decodeInteraction({
      type: "CARD_CLICKED",
      space: { name: "spaces/A", type: "ROOM" },
      message: {
        name: "spaces/A/messages/M1",
        thread: { name: "spaces/A/threads/T1" },
      },
      common: { invokedFunction: "ck:novalue", parameters: [] },
    });
    expect(evt!.id).toBe("ck:novalue");
    expect(evt!.value).toBeUndefined();
  });

  it('surfaces a present-but-empty `value` parameter as undefined (not "")', () => {
    const evt = decodeInteraction({
      type: "CARD_CLICKED",
      space: { name: "spaces/A", type: "ROOM" },
      message: {
        name: "spaces/A/messages/M1",
        thread: { name: "spaces/A/threads/T1" },
      },
      common: {
        invokedFunction: "ck:empty",
        parameters: [{ key: "value", value: "" }],
      },
    });
    expect(evt!.id).toBe("ck:empty");
    expect(evt!.value).toBeUndefined();
  });

  it("uses the DM scope when the space is a DM", () => {
    const evt = decodeInteraction({
      type: "CARD_CLICKED",
      space: { name: "spaces/D", type: "DM" },
      message: { name: "spaces/D/messages/M2" },
      common: { invokedFunction: "ck:y", parameters: [] },
    });
    expect(evt!.conversationKey).toBe("spaces/D::dm");
  });
});
