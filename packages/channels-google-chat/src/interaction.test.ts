import { describe, expect, it } from "vitest";
import { decodeInteraction } from "./interaction.js";
import { addOnClick, legacyClick } from "./__fixtures__/events.js";

describe("decodeInteraction", () => {
  it("reads the action id and JSON value from an add-on click", () => {
    const evt = decodeInteraction(
      addOnClick({ actionId: "ck:abc", value: JSON.stringify({ ok: true }) }),
    );
    expect(evt).toMatchObject({
      id: "ck:abc",
      value: { ok: true },
      rawValue: '{"ok":true}',
      conversationKey: "gchat:spaces/ROOM1/threads/T1",
      replyTarget: {
        space: "spaces/ROOM1",
        thread: "spaces/ROOM1/threads/T1",
      },
      messageRef: { id: "spaces/ROOM1/messages/BOTMSG" },
      actor: { id: "users/111", kind: "human" },
      identityContext: { trigger: "interaction" },
    });
  });

  it("falls back to the function name on a legacy click without actionId", () => {
    const evt = decodeInteraction(legacyClick({}, "ck:fn"));
    expect(evt?.id).toBe("ck:fn");
    expect(evt?.value).toBeUndefined();
  });

  it("prefers the actionId parameter over the legacy function name", () => {
    const evt = decodeInteraction(legacyClick({ actionId: "ck:param" }));
    expect(evt?.id).toBe("ck:param");
  });

  it("reads a dropdown choice from the form input named after the action", () => {
    const evt = decodeInteraction(
      addOnClick(
        { actionId: "ck:sel" },
        { "ck:sel": { stringInputs: { value: ["blue"] } } },
      ),
    );
    expect(evt).toMatchObject({
      id: "ck:sel",
      value: "blue",
      rawValue: "blue",
      values: { "ck:sel": "blue" },
    });
  });

  it("returns every choice of a multi-select", () => {
    const evt = decodeInteraction(
      addOnClick(
        { actionId: "ck:sel", multi: "true" },
        { "ck:sel": { stringInputs: { value: ["a", "b"] } } },
      ),
    );
    expect(evt?.value).toEqual(["a", "b"]);
  });

  it("ignores anything that is not a click", () => {
    expect(decodeInteraction({ type: "MESSAGE" })).toBeUndefined();
    expect(decodeInteraction({})).toBeUndefined();
  });
});
