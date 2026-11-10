import { describe, expect, it } from "vitest";
import { buildAttachmentParts } from "../attachments.js";
import type { ResendReceivedAttachment } from "../client.js";

function fakeClient(
  attachments: ResendReceivedAttachment[],
  files: Record<string, Uint8Array>,
) {
  const downloads: string[] = [];
  return {
    downloads,
    client: {
      listReceivedAttachments: async () => attachments,
      download: async (url: string, maxBytes: number) => {
        downloads.push(url);
        const bytes = files[url];
        if (!bytes) throw new Error("not found");
        if (bytes.byteLength > maxBytes) throw new Error("too big");
        return bytes;
      },
    },
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("buildAttachmentParts", () => {
  it("turns text files into text parts and other files into data parts", async () => {
    const { client } = fakeClient(
      [
        {
          id: "a1",
          filename: "notes.txt",
          content_type: "text/plain; charset=utf-8",
          size: 5,
          download_url: "u1",
        },
        {
          id: "a2",
          filename: "photo.png",
          content_type: "image/png",
          size: 3,
          download_url: "u2",
        },
        {
          id: "a3",
          filename: "report.pdf",
          content_type: "application/pdf",
          size: 3,
          download_url: "u3",
        },
      ],
      {
        u1: bytes("hello"),
        u2: new Uint8Array([1, 2, 3]),
        u3: new Uint8Array([4, 5, 6]),
      },
    );
    const { parts, notes } = await buildAttachmentParts("e1", client);
    expect(notes).toEqual([]);
    expect(parts).toEqual([
      { type: "text", text: "Attachment notes.txt:\nhello" },
      {
        type: "image",
        source: { type: "data", value: "AQID", mimeType: "image/png" },
      },
      {
        type: "document",
        source: { type: "data", value: "BAUG", mimeType: "application/pdf" },
      },
    ]);
  });

  it("skips large files without downloading them, and caps the count", async () => {
    const { client, downloads } = fakeClient(
      [
        { id: "big", filename: "big.bin", size: 10_000, download_url: "big" },
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `f${i}`,
          filename: `f${i}.txt`,
          content_type: "text/plain",
          size: 1,
          download_url: `f${i}`,
        })),
      ],
      { f0: bytes("0"), f1: bytes("1"), f2: bytes("2") },
    );
    const { parts, notes } = await buildAttachmentParts("e1", client, {
      maxBytesPerFile: 1000,
      maxFiles: 2,
    });
    expect(downloads).toEqual(["f0"]);
    expect(parts).toHaveLength(1);
    expect(notes).toEqual([
      "big.bin skipped: larger than 1000 bytes",
      "2 more attachments skipped (limit 2)",
    ]);
  });

  it("skips inline attachments unless asked, and cuts long text", async () => {
    const list: ResendReceivedAttachment[] = [
      {
        id: "logo",
        filename: "logo.png",
        content_type: "image/png",
        content_disposition: "inline",
        size: 1,
        download_url: "logo",
      },
      {
        id: "t",
        filename: "t.txt",
        content_type: "text/plain",
        size: 10,
        download_url: "t",
      },
    ];
    const files = { logo: new Uint8Array([1]), t: bytes("0123456789") };
    const skipped = await buildAttachmentParts(
      "e1",
      fakeClient(list, files).client,
      {
        maxTextBytes: 4,
      },
    );
    expect(skipped.parts).toEqual([
      { type: "text", text: "Attachment t.txt:\n0123" },
    ]);
    const included = await buildAttachmentParts(
      "e1",
      fakeClient(list, files).client,
      {
        includeInline: true,
      },
    );
    expect(included.parts).toHaveLength(2);
  });
});
