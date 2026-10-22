import { describe, it, expect, vi, afterEach } from "vitest";
import { buildFileContentParts } from "../download-files.js";
import type { SlackFileRef } from "../download-files.js";

function fakeFetch(
  bodyByUrl: Record<string, { ok?: boolean; status?: number; bytes?: Buffer }>,
) {
  return vi.fn(async (url: string) => {
    const e = bodyByUrl[url];
    if (!e) return { ok: false, status: 404 } as never;
    return {
      ok: e.ok ?? true,
      status: e.status ?? 200,
      arrayBuffer: async () =>
        (e.bytes ?? Buffer.from("")).buffer.slice(
          (e.bytes ?? Buffer.from("")).byteOffset,
          (e.bytes ?? Buffer.from("")).byteOffset +
            (e.bytes ?? Buffer.from("")).byteLength,
        ),
    } as never;
  });
}

afterEach(() => vi.unstubAllGlobals());

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
  it("never sends the bot token to a non-Slack host", async () => {
    const fetchSpy = fakeFetch({});
    vi.stubGlobal("fetch", fetchSpy);
    const { parts, notes } = await buildFileContentParts(
      [
        { ...img, url_private: "https://attacker.example/x.png" },
        { ...img, url_private: "http://files.slack.com/x.png" },
        { ...img, url_private: "https://files.slack.com.attacker.example/x" },
      ],
      "xoxb-tok",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(parts).toEqual([]);
    expect(notes).toHaveLength(3);
  });

  it("accepts Slack's apex file host and handles redirects itself", async () => {
    const apex = {
      ...img,
      url_private: "https://slack.com/files-pri/T1-F1/x.png",
    };
    const fetchSpy = fakeFetch({
      [apex.url_private]: { bytes: Buffer.from([1]) },
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { parts } = await buildFileContentParts([apex], "xoxb-tok");
    expect(parts).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      apex.url_private,
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows Slack-hosted redirects with the token and refuses others", async () => {
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://files-edge.slack.com/x.png"))
      .mockResolvedValueOnce(new Response(new Uint8Array([7])))
      .mockResolvedValueOnce(redirect("https://cdn.attacker.example/x.png"));
    vi.stubGlobal("fetch", fetchSpy);

    const ok = await buildFileContentParts([img], "xoxb-tok");
    expect(ok.parts).toHaveLength(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://files-edge.slack.com/x.png",
      expect.objectContaining({
        headers: { Authorization: "Bearer xoxb-tok" },
      }),
    );

    const off = await buildFileContentParts([img], "xoxb-tok");
    expect(off.parts).toEqual([]);
    expect(off.notes[0]).toContain("redirected off Slack");
    // The off-Slack location is never requested.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("gives up after three redirects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://files.slack.com/again" },
          }),
      ),
    );
    const { parts, notes } = await buildFileContentParts([img], "xoxb-tok");
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("too many redirects");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("turns an image into a base64 image part", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    vi.stubGlobal("fetch", fakeFetch({ [img.url_private!]: { bytes } }));
    const { parts, notes } = await buildFileContentParts([img], "xoxb-tok");
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
    vi.stubGlobal("fetch", fakeFetch({ [csv.url_private!]: { bytes } }));
    const { parts } = await buildFileContentParts([csv], "tok");
    expect(parts[0]?.type).toBe("text");
    expect((parts[0] as { text: string }).text).toContain("data.csv");
    expect((parts[0] as { text: string }).text).toContain("a,b");
  });

  it("truncates large text files", async () => {
    const bytes = Buffer.from("x".repeat(5000), "utf8");
    vi.stubGlobal("fetch", fakeFetch({ [csv.url_private!]: { bytes } }));
    const { parts } = await buildFileContentParts([csv], "tok", {
      maxTextBytes: 100,
    });
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
    vi.stubGlobal("fetch", fakeFetch({ [pdf.url_private!]: { bytes } }));
    const { parts, notes } = await buildFileContentParts([pdf], "tok");
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
      vi.stubGlobal("fetch", fakeFetch({ [file.url_private!]: { bytes } }));
      const { parts, notes } = await buildFileContentParts([file], "tok");
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
    vi.stubGlobal("fetch", fakeFetch({}));
    const { parts, notes } = await buildFileContentParts([zip], "tok");
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("unsupported");
  });

  it("skips files over the size cap (by reported size) without downloading", async () => {
    const big: SlackFileRef = { ...img, size: 99_999_999 };
    const fetchSpy = fakeFetch({});
    vi.stubGlobal("fetch", fetchSpy);
    const { parts, notes } = await buildFileContentParts([big], "tok", {
      maxBytesPerFile: 10,
    });
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("exceeds");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips on a failed download with a note", async () => {
    vi.stubGlobal(
      "fetch",
      fakeFetch({ [img.url_private!]: { ok: false, status: 403 } }),
    );
    const { parts, notes } = await buildFileContentParts([img], "tok");
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("403");
  });

  it("caps the number of files processed", async () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      ...csv,
      url_private: `https://files.slack.com/u${i}`,
    }));
    vi.stubGlobal(
      "fetch",
      fakeFetch(
        Object.fromEntries(
          files.map((f) => [f.url_private!, { bytes: Buffer.from("x") }]),
        ),
      ),
    );
    const { parts, notes } = await buildFileContentParts(files, "tok", {
      maxFiles: 3,
    });
    expect(parts).toHaveLength(3);
    expect(notes.some((n) => n.includes("first 3 of 8"))).toBe(true);
  });
});
