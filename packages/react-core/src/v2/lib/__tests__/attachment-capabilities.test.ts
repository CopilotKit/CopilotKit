import { describe, expect, it } from "vitest";
import { attachmentAcceptFromCapabilities } from "../attachment-capabilities";

describe("attachmentAcceptFromCapabilities", () => {
  it("preserves app defaults when input support is unknown or partial", () => {
    expect(attachmentAcceptFromCapabilities(undefined)).toBeUndefined();
    expect(attachmentAcceptFromCapabilities({})).toBeUndefined();
    expect(
      attachmentAcceptFromCapabilities({
        multimodal: { input: { image: true } },
      }),
    ).toBeUndefined();
  });

  it.each([
    [
      { image: true, pdf: true, audio: false, video: false, file: false },
      "image/*,application/pdf",
    ],
    [
      { image: false, pdf: false, audio: true, video: true, file: false },
      "audio/*,video/*",
    ],
    [
      { image: false, pdf: false, audio: false, video: false, file: true },
      "*/*",
    ],
    [{ image: false, pdf: false, audio: false, video: false, file: false }, ""],
  ] as const)(
    "uses only explicitly declared support: %j",
    (input, expected) => {
      expect(attachmentAcceptFromCapabilities({ multimodal: { input } })).toBe(
        expected,
      );
    },
  );
});
