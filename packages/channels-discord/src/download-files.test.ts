import { describe, it, expect, vi } from "vitest";
import { buildFileContentParts } from "./download-files.js";

describe("buildFileContentParts", () => {
  it("turns an image attachment into an image content part", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/x.png",
          name: "x.png",
          contentType: "image/png",
          size: 3,
        },
      ],
      { fetchImpl },
    );
    expect(parts[0]).toMatchObject({ type: "image" });
  });

  it("decodes a text/csv attachment into a text content part", async () => {
    const csv = "a,b\n1,2";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/x.csv",
          name: "x.csv",
          contentType: "text/csv",
          size: csv.length,
        },
      ],
      { fetchImpl },
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(parts[0])).toContain("a,b");
  });

  it("skips a file over the size cap without fetching (notes the skip)", async () => {
    const fetchImpl = vi.fn() as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/big.bin",
          name: "big.bin",
          contentType: "application/octet-stream",
          size: 99_000_000,
        },
      ],
      { fetchImpl, maxBytes: 10_000_000 },
    );
    // The file is gated pre-fetch but surfaced to the model as a skip note.
    expect(parts).toHaveLength(1);
    const note = parts[0] as { type: "text"; text: string };
    expect(note.type).toBe("text");
    expect(note.text).toContain("skipped");
    expect(note.text).toContain("big.bin");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips a file whose downloaded body exceeds the cap (reported size lied)", async () => {
    // Reported size is under the cap, so it gets fetched — but the actual body
    // is larger than maxBytes and must be dropped post-fetch.
    const big = new Uint8Array(100);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => big.buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/x.png",
          name: "x.png",
          contentType: "image/png",
          size: 3,
        },
      ],
      { fetchImpl, maxBytes: 10 },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    // Dropped post-fetch but surfaced to the model as a skip note.
    expect(parts).toHaveLength(1);
    const note = parts[0] as { type: "text"; text: string };
    expect(note.type).toBe("text");
    expect(note.text).toContain("skipped");
    expect(note.text).toContain("x.png");
  });

  it("truncates a text body larger than maxTextBytes", async () => {
    // Use a payload char that never appears in the surrounding framing so the
    // count of retained body bytes is unambiguous.
    const big = "Z".repeat(500);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(big).buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/big.log",
          name: "big.log",
          contentType: "text/plain",
          size: big.length,
        },
      ],
      { fetchImpl, maxTextBytes: 100 },
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    const text = (parts[0] as { type: "text"; text: string }).text;
    expect(text).toContain("truncated");
    expect(text).toContain("…(truncated)");
    // Exactly 100 body bytes retained out of the original 500.
    expect(text.match(/Z/g)?.length).toBe(100);
  });

  it("processes at most maxFiles attachments per message (default 5)", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as any;
    // 7 attachments, default maxFiles is 5 → only the first 5 are processed.
    const attachments = Array.from({ length: 7 }, (_, i) => ({
      url: `https://cdn/x${i}.png`,
      name: `x${i}.png`,
      contentType: "image/png",
      size: 3,
    }));
    const parts = await buildFileContentParts(attachments, { fetchImpl });
    expect(parts).toHaveLength(5);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("surfaces an oversize skip as a note while still emitting a co-attached valid image", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => pngBytes.buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/big.png",
          name: "big.png",
          contentType: "image/png",
          size: 50, // exceeds the tiny maxBytes below
        },
        {
          url: "https://cdn/ok.png",
          name: "ok.png",
          contentType: "image/png",
          size: pngBytes.length,
        },
      ],
      { fetchImpl, maxBytes: 10 },
    );
    // The oversize file becomes a skip note; the valid one still becomes image.
    const note = parts.find(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    expect(note).toBeDefined();
    expect(note!.text).toContain("skipped");
    expect(note!.text).toContain("big.png");
    expect(parts.some((p) => p.type === "image")).toBe(true);
    // Only the valid file was fetched — the oversize one was gated pre-fetch.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("surfaces an unsupported binary type as a note", async () => {
    const fetchImpl = vi.fn() as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/app.bin",
          name: "app.bin",
          contentType: "application/octet-stream",
          size: 3,
        },
      ],
      { fetchImpl },
    );
    expect(parts).toHaveLength(1);
    const note = parts[0] as { type: "text"; text: string };
    expect(note.type).toBe("text");
    expect(note.text).toContain("unsupported type");
    expect(note.text).toContain("app.bin");
    // Unsupported types are gated pre-fetch.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("decodes a .csv reported as application/octet-stream as a text part", async () => {
    const csv = "a,b\n1,2";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [
        {
          url: "https://cdn/data.csv",
          name: "data.csv",
          contentType: "application/octet-stream",
          size: csv.length,
        },
      ],
      { fetchImpl },
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(parts[0])).toContain("a,b");
  });
});
