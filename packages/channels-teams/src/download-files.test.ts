import { describe, it, expect, vi, afterEach } from "vitest";
import { buildFileContentParts } from "./download-files.js";
import type { TeamsAttachmentRef } from "./download-files.js";

const FILE_DOWNLOAD_INFO = "application/vnd.microsoft.teams.file.download.info";

function mockFetch(
  body: string | Uint8Array,
  init: { ok?: boolean; status?: number } = {},
): void {
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: init.ok ?? true,
      status: init.status ?? 200,
      arrayBuffer: async () => bytes.buffer,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildFileContentParts (Teams)", () => {
  it("downloads a CSV file.download.info attachment as a decoded text part", async () => {
    mockFetch("a,b\n1,2\n");
    const att: TeamsAttachmentRef = {
      contentType: FILE_DOWNLOAD_INFO,
      name: "data.csv",
      content: {
        downloadUrl: "https://files.example/data.csv",
        fileType: "csv",
      },
    };

    const { parts, notes } = await buildFileContentParts([att]);

    expect(notes).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "text" });
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain('Attached file "data.csv" (text/csv)');
    expect(text).toContain("a,b\n1,2");
    expect(fetch).toHaveBeenCalledWith("https://files.example/data.csv");
  });

  it("decodes a base64 data: URI image into an image part without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const att: TeamsAttachmentRef = {
      contentType: "image/png",
      name: "chart.png",
      contentUrl: `data:image/png;base64,${png}`,
    };

    const { parts } = await buildFileContentParts([att]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(parts[0]).toMatchObject({
      type: "image",
      source: { type: "data", value: png, mimeType: "image/png" },
    });
  });

  it("fetches an https image attachment and passes it through as binary", async () => {
    mockFetch(new Uint8Array([1, 2, 3, 4]));
    const att: TeamsAttachmentRef = {
      contentType: "image/jpeg",
      name: "photo.jpg",
      contentUrl: "https://smba.example/v3/attachments/123",
    };

    const { parts } = await buildFileContentParts([att]);

    expect(parts[0]).toMatchObject({
      type: "image",
      source: { type: "data", mimeType: "image/jpeg" },
    });
  });

  it("notes a download failure instead of throwing", async () => {
    mockFetch("", { ok: false, status: 404 });
    const att: TeamsAttachmentRef = {
      contentType: FILE_DOWNLOAD_INFO,
      name: "data.csv",
      content: { downloadUrl: "https://files.example/missing.csv" },
    };

    const { parts, notes } = await buildFileContentParts([att]);

    expect(parts).toEqual([]);
    expect(notes[0]).toContain("download failed (HTTP 404)");
  });

  it("skips an Adaptive Card attachment (no downloadable source)", async () => {
    const att: TeamsAttachmentRef = {
      contentType: "application/vnd.microsoft.card.adaptive",
      content: { type: "AdaptiveCard" },
    };

    const { parts, notes } = await buildFileContentParts([att]);

    expect(parts).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("caps the number of files processed", async () => {
    mockFetch("x");
    const make = (i: number): TeamsAttachmentRef => ({
      contentType: FILE_DOWNLOAD_INFO,
      name: `f${i}.txt`,
      content: { downloadUrl: `https://files.example/f${i}.txt` },
    });
    const atts = Array.from({ length: 7 }, (_, i) => make(i));

    const { parts, notes } = await buildFileContentParts(atts, { maxFiles: 3 });

    expect(parts).toHaveLength(3);
    expect(notes.some((n) => n.includes("only the first 3 of 7"))).toBe(true);
  });
});
