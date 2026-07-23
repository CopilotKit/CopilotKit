import { describe, it, expect } from "vitest";
import { buildFileContentParts } from "../download-files.js";
import type { SlackFileRef, FileDownloader } from "../download-files.js";
import type { SlackConnectorDownloadResult } from "../slack-connector.js";

/**
 * A `FileDownloader` (the `SlackConnector.downloadFile` shape) backed by a
 * url→result map — standing in for a real connector's credentialed fetch
 * without a bot token or global `fetch` stub in sight (Task 3/T3s-4a: the
 * bearer-token download moved behind the connector).
 */
function fakeDownloader(
  bodyByUrl: Record<string, { ok?: boolean; status?: number; bytes?: Buffer }>,
): FileDownloader {
  return async (url: string): Promise<SlackConnectorDownloadResult> => {
    const e = bodyByUrl[url];
    if (!e) return { ok: false, status: 404 };
    return {
      ok: e.ok ?? true,
      status: e.status ?? 200,
      bytes: e.bytes ?? Buffer.from(""),
    };
  };
}

const img: SlackFileRef = {
  name: "shot.png",
  mimetype: "image/png",
  url_private: "https://files.slack.com/shot.png",
};
const csv: SlackFileRef = {
  name: "data.csv",
  mimetype: "text/csv",
  url_private: "https://files.slack.com/data.csv",
};

describe("buildFileContentParts", () => {
  it("turns an image into a base64 image part", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const { parts, notes } = await buildFileContentParts(
      [img],
      fakeDownloader({ [img.url_private!]: { bytes } }),
    );
    expect(notes).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "image",
      source: {
        type: "data",
        mimeType: "image/png",
        value: bytes.toString("base64"),
      },
    });
  });

  it("decodes a text/csv file into a text part", async () => {
    const bytes = Buffer.from("a,b\n1,2\n", "utf8");
    const { parts } = await buildFileContentParts(
      [csv],
      fakeDownloader({ [csv.url_private!]: { bytes } }),
    );
    expect(parts[0]?.type).toBe("text");
    expect((parts[0] as { text: string }).text).toContain("data.csv");
    expect((parts[0] as { text: string }).text).toContain("a,b");
  });

  it("truncates large text files", async () => {
    const bytes = Buffer.from("x".repeat(5000), "utf8");
    const { parts } = await buildFileContentParts(
      [csv],
      fakeDownloader({ [csv.url_private!]: { bytes } }),
      { maxTextBytes: 100 },
    );
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("truncated");
    expect(text.length).toBeLessThan(400);
  });

  it("turns a PDF into a document part", async () => {
    const bytes = Buffer.from("%PDF-1.7 ...", "utf8");
    const pdf: SlackFileRef = {
      name: "report.pdf",
      mimetype: "application/pdf",
      url_private: "https://files.slack.com/report.pdf",
    };
    const { parts, notes } = await buildFileContentParts(
      [pdf],
      fakeDownloader({ [pdf.url_private!]: { bytes } }),
    );
    expect(notes).toEqual([]);
    expect(parts[0]).toMatchObject({
      type: "document",
      source: {
        type: "data",
        mimeType: "application/pdf",
        value: bytes.toString("base64"),
      },
    });
  });

  it.each([
    { name: "memo.mp3", mimetype: "audio/mpeg", expected: "audio" },
    { name: "clip.mp4", mimetype: "video/mp4", expected: "video" },
  ])(
    "passes $mimetype through as a $expected part",
    async ({ name, mimetype, expected }) => {
      const bytes = Buffer.from([9, 8, 7, 6]);
      const file: SlackFileRef = {
        name,
        mimetype,
        url_private: `https://files.slack.com/${name}`,
      };
      const { parts, notes } = await buildFileContentParts(
        [file],
        fakeDownloader({ [file.url_private!]: { bytes } }),
      );
      expect(notes).toEqual([]);
      expect(parts[0]).toMatchObject({
        type: expected,
        source: {
          type: "data",
          mimeType: mimetype,
          value: bytes.toString("base64"),
        },
      });
    },
  );

  it("skips genuinely unsupported types with a note", async () => {
    const zip: SlackFileRef = {
      name: "a.zip",
      mimetype: "application/zip",
      url_private: "u",
    };
    const { parts, notes } = await buildFileContentParts(
      [zip],
      fakeDownloader({}),
    );
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("unsupported");
  });

  it("skips files over the size cap (by reported size) without downloading", async () => {
    const big: SlackFileRef = { ...img, size: 99_999_999 };
    let called = false;
    const downloadFile: FileDownloader = async (url) => {
      called = true;
      return fakeDownloader({})(url);
    };
    const { parts, notes } = await buildFileContentParts([big], downloadFile, {
      maxBytesPerFile: 10,
    });
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("exceeds");
    expect(called).toBe(false);
  });

  it("skips on a failed download with a note", async () => {
    const { parts, notes } = await buildFileContentParts(
      [img],
      fakeDownloader({ [img.url_private!]: { ok: false, status: 403 } }),
    );
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("403");
  });

  it("caps the number of files processed", async () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      ...csv,
      url_private: `u${i}`,
    }));
    const { parts, notes } = await buildFileContentParts(
      files,
      fakeDownloader(
        Object.fromEntries(
          files.map((f) => [f.url_private!, { bytes: Buffer.from("x") }]),
        ),
      ),
      { maxFiles: 3 },
    );
    expect(parts).toHaveLength(3);
    expect(notes.some((n) => n.includes("first 3 of 8"))).toBe(true);
  });
});
