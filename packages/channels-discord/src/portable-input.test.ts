import { describe, expect, it } from "vitest";
import {
  decodePortableInputControl,
  decodePortableInputModalAction,
  encodePortableInputControl,
  renderPortableInputModal,
} from "./portable-input.js";

describe("portable Discord input controls", () => {
  it("round-trips action IDs that contain colons", () => {
    const customId = encodePortableInputControl("ck:action", true);
    expect(customId).toBe("ck-input:ck:action:1");
    expect(decodePortableInputControl(customId)).toEqual({
      actionId: "ck:action",
      multiline: true,
    });
    expect(decodePortableInputModalAction("ck-input-modal:ck:action")).toBe(
      "ck:action",
    );
  });

  it.each(["button", "ck-input::1", "ck-input:ck:action:x"])(
    "rejects malformed control ID %s",
    (customId) => {
      expect(decodePortableInputControl(customId)).toBeUndefined();
    },
  );

  it("bounds the modal label and falls back for blank labels", () => {
    const long = renderPortableInputModal({
      actionId: "ck:long",
      label: "x".repeat(100),
      multiline: false,
    }).toJSON();
    const blank = renderPortableInputModal({
      actionId: "ck:blank",
      label: "   ",
      multiline: false,
    }).toJSON();

    expect((long.components[0] as any).components[0].label).toHaveLength(45);
    expect((blank.components[0] as any).components[0].label).toBe(
      "Enter response",
    );
  });
});
