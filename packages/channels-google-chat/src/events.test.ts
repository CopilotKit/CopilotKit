import { describe, expect, it } from "vitest";
import { isDirectMessage, normalizeEvent } from "./events.js";
import {
  DM,
  ROOM,
  addOnAdded,
  addOnClick,
  addOnMention,
  addOnSlash,
  legacyAdded,
  legacyClick,
  legacyDm,
  legacyMention,
  legacySlash,
} from "./__fixtures__/events.js";

describe("normalizeEvent", () => {
  it("reads a legacy MESSAGE and an add-on messagePayload the same way", () => {
    const legacy = normalizeEvent(legacyMention);
    const addOn = normalizeEvent(addOnMention);
    for (const evt of [legacy, addOn]) {
      expect(evt.kind).toBe("message");
      expect(evt.space?.name).toBe(ROOM.name);
      expect(evt.message?.thread?.name).toBe("spaces/ROOM1/threads/T1");
      expect(evt.user?.name).toBe("users/111");
    }
    expect(legacy.addOn).toBe(false);
    expect(addOn.addOn).toBe(true);
  });

  it("names the slash command in either envelope", () => {
    expect(normalizeEvent(legacySlash)).toMatchObject({
      kind: "command",
      command: "summarize",
    });
    expect(normalizeEvent(addOnSlash)).toMatchObject({
      kind: "command",
      command: "summarize",
      space: { name: ROOM.name },
      message: { thread: { name: "spaces/ROOM1/threads/T1" } },
    });
  });

  it("reads click parameters from a legacy array or an add-on map", () => {
    const legacy = normalizeEvent(
      legacyClick({ actionId: "ck:1", value: "2" }),
    );
    const addOn = normalizeEvent(addOnClick({ actionId: "ck:1", value: "2" }));
    for (const evt of [legacy, addOn]) {
      expect(evt.kind).toBe("click");
      expect(evt.parameters).toEqual({ actionId: "ck:1", value: "2" });
    }
    expect(legacy.invokedFunction).toBe("ck:legacy");
  });

  it("recognizes the app being added to a space", () => {
    expect(normalizeEvent(legacyAdded)).toMatchObject({
      kind: "added",
      space: { name: DM.name },
    });
    expect(normalizeEvent(addOnAdded)).toMatchObject({
      kind: "added",
      space: { name: DM.name },
    });
  });

  it("marks anything else unknown", () => {
    expect(normalizeEvent({ type: "WIDGET_UPDATED" }).kind).toBe("unknown");
    expect(normalizeEvent(undefined).kind).toBe("unknown");
    expect(normalizeEvent({ chat: {} }).kind).toBe("unknown");
  });
});

describe("isDirectMessage", () => {
  it("accepts the legacy and current DM types", () => {
    expect(isDirectMessage({ type: "DM" })).toBe(true);
    expect(isDirectMessage({ spaceType: "DIRECT_MESSAGE" })).toBe(true);
    expect(isDirectMessage(ROOM)).toBe(false);
    expect(isDirectMessage(legacyDm.space)).toBe(true);
  });
});
