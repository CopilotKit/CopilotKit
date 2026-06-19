import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFileContentParts } from "../download-files.js";

describe("buildFileContentParts", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: (_name: string) => null },
        arrayBuffer: async () => new TextEncoder().encode("PNGDATA").buffer,
      })) as any,
    );
  });
  it("downloads an image as a base64 data part", async () => {
    const { parts } = await buildFileContentParts(
      [{ fileId: "f1", mimeType: "image/png" }],
      "tok",
      async () => "photos/f1.png",
    );
    expect(parts[0]).toMatchObject({
      type: "image",
      source: { type: "data", mimeType: "image/png" },
    });
  });
  it("notes files over the size cap", async () => {
    const { parts, notes } = await buildFileContentParts(
      [{ fileId: "big", mimeType: "image/png", size: 99_000_000 }],
      "tok",
      async () => "x",
      { maxBytesPerFile: 10 },
    );
    expect(parts).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/too large|skipped/i);
  });

  it("redacts the bot token from fetch error notes", async () => {
    const SECRET_TOKEN = "1234567890:AABBCCDDEEFF";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(
          `fetch failed: connect ECONNREFUSED https://api.telegram.org/file/bot${SECRET_TOKEN}/photos/f1.png`,
        );
      }) as any,
    );
    const { parts, notes } = await buildFileContentParts(
      [{ fileId: "f1", mimeType: "image/png" }],
      SECRET_TOKEN,
      async () => "photos/f1.png",
    );
    expect(parts).toHaveLength(0);
    const noteText = notes.join(" ");
    expect(noteText).not.toContain(SECRET_TOKEN);
    expect(noteText).toContain("<redacted>");
  });

  it("handles non-Error fetch rejections without crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "plain string error";
      }) as any,
    );
    const { parts, notes } = await buildFileContentParts(
      [{ fileId: "f2", mimeType: "image/png" }],
      "tok",
      async () => "photos/f2.png",
    );
    expect(parts).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/skipped/i);
  });

  it("skips via Content-Length before buffering when header exceeds cap", async () => {
    const arrayBuffer = vi.fn(
      async () => new TextEncoder().encode("PNGDATA").buffer,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: {
          get: (name: string) =>
            name === "content-length" ? "99000000" : null,
        },
        arrayBuffer,
      })) as any,
    );

    const { parts, notes } = await buildFileContentParts(
      // No `size` field — simulates a photo ref where Telegram omits size
      [{ fileId: "bigphoto", mimeType: "image/jpeg" }],
      "tok",
      async () => "photos/bigphoto.jpg",
      { maxBytesPerFile: 10 },
    );

    expect(parts).toHaveLength(0);
    expect(notes.join(" ")).toMatch(/too large|skipped/i);
    // The body must NOT have been read — the pre-check should have aborted
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
