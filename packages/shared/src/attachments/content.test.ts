import { describe, expect, it } from "vitest";
import { createAttachmentContent } from "./content";

describe("createAttachmentContent", () => {
  it.each(["image", "audio", "video", "document"] as const)(
    "preserves %s bytes, source, and metadata precedence",
    (type) => {
      const source = {
        type: "data",
        value: "AAEC",
        mimeType: "application/octet-stream",
      } as const;
      const part = createAttachmentContent({
        type,
        source,
        filename: "upload.bin",
        metadata: { filename: "custom.bin", custom: { value: 1 } },
      });
      expect(part).toEqual({
        type,
        source,
        metadata: { filename: "custom.bin", custom: { value: 1 } },
      });
      expect("source" in part && part.source).toBe(source);
    },
  );

  it("preserves URL sources and always includes metadata", () => {
    const source = {
      type: "url",
      value: "https://example.test/image.png",
    } as const;
    expect(
      createAttachmentContent({ type: "image", source, filename: "" }),
    ).toEqual({
      type: "image",
      source,
      metadata: {},
    });
    expect(
      createAttachmentContent({ type: "image", source, filename: "image.png" }),
    ).toEqual({
      type: "image",
      source,
      metadata: { filename: "image.png" },
    });
  });
});
