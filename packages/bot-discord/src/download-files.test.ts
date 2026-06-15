import { describe, it, expect, vi } from "vitest";
import { buildFileContentParts } from "./download-files.js";

describe("buildFileContentParts", () => {
  it("turns an image attachment into an image content part", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [{ url: "https://cdn/x.png", name: "x.png", contentType: "image/png", size: 3 }],
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
      [{ url: "https://cdn/x.csv", name: "x.csv", contentType: "text/csv", size: csv.length }],
      { fetchImpl },
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(parts[0])).toContain("a,b");
  });

  it("skips a file over the size cap without fetching", async () => {
    const fetchImpl = vi.fn();
    const parts = await buildFileContentParts(
      [{ url: "https://cdn/big.bin", name: "big.bin", contentType: "application/octet-stream", size: 99_000_000 }],
      { fetchImpl, maxBytes: 10_000_000 },
    );
    expect(parts).toEqual([]);
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
      [{ url: "https://cdn/x.png", name: "x.png", contentType: "image/png", size: 3 }],
      { fetchImpl, maxBytes: 10 },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(parts).toEqual([]);
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
      [{ url: "https://cdn/big.log", name: "big.log", contentType: "text/plain", size: big.length }],
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

  it("decodes a .csv reported as application/octet-stream as a text part", async () => {
    const csv = "a,b\n1,2";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(csv).buffer,
    })) as any;
    const parts = await buildFileContentParts(
      [{ url: "https://cdn/data.csv", name: "data.csv", contentType: "application/octet-stream", size: csv.length }],
      { fetchImpl },
    );
    expect(parts[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(parts[0])).toContain("a,b");
  });
});
