import { describe, it, expect } from "vitest";
import { buildFileContentParts } from "../download-files.js";
import type { TelegramDownloadResult } from "../telegram-connector.js";

/** A `downloadFile` stub resolving to canned bytes. */
function stubDownload(
  bytes: string,
): (fileId: string) => Promise<TelegramDownloadResult> {
  return async () => ({ ok: true, bytes: Buffer.from(bytes) });
}

describe("buildFileContentParts", () => {
  it("downloads an image as a base64 data part", async () => {
    const { parts } = await buildFileContentParts(
      [{ fileId: "f1", mimeType: "image/png" }],
      stubDownload("PNGDATA"),
    );
    expect(parts[0]).toMatchObject({
      type: "image",
      source: { type: "data", mimeType: "image/png" },
    });
  });

  it("notes files over the size cap (known size, no download attempted)", async () => {
    const { parts, notes } = await buildFileContentParts(
      [{ fileId: "big", mimeType: "image/png", size: 99_000_000 }],
      async () => {
        throw new Error("must not be called — size cap should short-circuit");
      },
      { maxBytesPerFile: 10 },
    );
    expect(parts).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/too large|skipped/i);
  });

  it("notes files whose downloaded bytes exceed the cap (size unknown up front)", async () => {
    const { parts, notes } = await buildFileContentParts(
      // No `size` field — simulates a photo ref where Telegram omits size.
      [{ fileId: "bigphoto", mimeType: "image/jpeg" }],
      async () => ({ ok: true, bytes: Buffer.from("x".repeat(20)) }),
      { maxBytesPerFile: 10 },
    );
    expect(parts).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/too large|skipped/i);
  });

  it("notes a connector download failure (status)", async () => {
    const { parts, notes } = await buildFileContentParts(
      [{ fileId: "f1", mimeType: "image/png" }],
      async () => ({ ok: false, status: 404 }),
    );
    expect(parts).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/download failed.*404|skipped/i);
  });

  it("notes a connector download failure (error message, already redacted upstream)", async () => {
    const { parts, notes } = await buildFileContentParts(
      [{ fileId: "f1", mimeType: "image/png" }],
      async () => ({ ok: false, error: "connect ECONNREFUSED <redacted>" }),
    );
    expect(parts).toHaveLength(0);
    const noteText = notes.join(" ");
    expect(noteText).toContain("<redacted>");
  });

  it("decodes a text-like file inline instead of as a binary part", async () => {
    const { parts } = await buildFileContentParts(
      [{ fileId: "f1", mimeType: "text/csv", fileName: "data.csv" }],
      stubDownload("a,b\n1,2"),
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    expect((parts[0] as { text: string }).text).toContain("a,b");
  });

  it("caps the number of files processed and notes the overflow", async () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      fileId: `f${i}`,
      mimeType: "image/png",
    }));
    const { parts, notes } = await buildFileContentParts(
      files,
      stubDownload("X"),
      { maxFiles: 3 },
    );
    expect(parts).toHaveLength(3);
    expect(notes.join(" ")).toMatch(/only the first 3 of 8/);
  });
});
