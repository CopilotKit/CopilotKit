import { describe, it, expect } from "vitest";
import { buildFileContentParts } from "./download-files.js";
import type { DownloadedMedia } from "./client.js";

const fakeClient = (media: Record<string, DownloadedMedia>) => ({
  downloadMedia: async (id: string) => media[id],
});

describe("buildFileContentParts", () => {
  it("converts an image media into an image data part", async () => {
    const client = fakeClient({
      M1: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    });
    const { parts, notes } = await buildFileContentParts(
      [{ id: "M1", mime_type: "image/png" }],
      client as any,
      {},
    );
    expect(notes).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "image",
      source: { type: "data", mimeType: "image/png" },
    });
  });

  it("decodes a text media into a text part", async () => {
    const client = fakeClient({
      M2: { bytes: new TextEncoder().encode("hello"), mimeType: "text/plain" },
    });
    const { parts } = await buildFileContentParts(
      [{ id: "M2", mime_type: "text/plain" }],
      client as any,
      {},
    );
    expect(parts[0]).toEqual({ type: "text", text: "hello" });
  });

  it("skips an oversized file with a note", async () => {
    const client = fakeClient({
      M3: { bytes: new Uint8Array(10), mimeType: "image/png" },
    });
    const { parts, notes } = await buildFileContentParts(
      [{ id: "M3", mime_type: "image/png" }],
      client as any,
      { maxBytesPerFile: 5 },
    );
    expect(parts).toEqual([]);
    expect(notes[0]).toMatch(/too large/i);
  });
});
