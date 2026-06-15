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
});
