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

describe("Slack file host check", () => {
  type Hop = { status: number; location?: string };

  /** Answers each URL as scripted; anything else is a 200 with a body. */
  function hopFetch(hops: Record<string, Hop>) {
    return vi.fn(async (url: string, _init?: RequestInit) => {
      const hop = hops[url];
      return new Response(hop ? null : "ok", {
        status: hop?.status ?? 200,
        headers: hop?.location ? { location: hop.location } : {},
      });
    });
  }

  const file = (url_private: string): SlackFileRef => ({
    name: "a.txt",
    mimetype: "text/plain",
    url_private,
  });
  const authHeaders = (fetchMock: ReturnType<typeof hopFetch>) =>
    fetchMock.mock.calls.map(([url, init]) => [
      url,
      new Headers(init?.headers).get("authorization"),
    ]);

  it.each([
    "https://files.slack.com/a.txt",
    "https://files.slack-gov.com/a.txt",
  ])("sends the token to %s", async (url) => {
    const fetchMock = hopFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const { parts, notes } = await buildFileContentParts([file(url)], "tok");
    expect(notes).toEqual([]);
    expect(parts).toHaveLength(1);
    expect(authHeaders(fetchMock)).toEqual([[url, "Bearer tok"]]);
  });

  it.each([
    "http://files.slack.com/a.txt",
    "https://other.example/a.txt",
    "https://notslack.com/a.txt",
    "https://files.slack.com.other.example/a.txt",
    "https://slack.com@other.example/a.txt",
    "https://user:pw@files.slack.com/a.txt",
    "https://files.slack.com:8443/a.txt",
    "https://acme.slack.com/a.txt",
    "https://slack.com/a.txt",
    "https://files.slack.com/api/users.list",
    "https://files.slack.com/%61pi/users.list",
    "https://files.slack.com/API",
    "https://files.slack.com/%zz",
    "https://cdn.slack-edge.com/a.txt",
    "not a url",
  ])("refuses %s without a request", async (url) => {
    const fetchMock = hopFetch({});
    vi.stubGlobal("fetch", fetchMock);
    const { parts, notes } = await buildFileContentParts([file(url)], "tok");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("not an allowed Slack file URL");
    expect(notes[0]).not.toContain("other.example");
  });

  it("follows a redirect that stays on the allowlist", async () => {
    const start = "https://files.slack.com/a.txt";
    const next = "https://files-edge.slack.com/a.txt";
    const fetchMock = hopFetch({ [start]: { status: 302, location: next } });
    vi.stubGlobal("fetch", fetchMock);
    const { parts } = await buildFileContentParts([file(start)], "tok");
    expect(parts).toHaveLength(1);
    expect(authHeaders(fetchMock)).toEqual([
      [start, "Bearer tok"],
      [next, "Bearer tok"],
    ]);
  });

  it.each([
    "https://cdn.example/a.txt",
    "http://files.slack.com/a.txt",
    "//other.example/a.txt",
  ])("stops at a redirect to %s", async (location) => {
    const start = "https://files.slack.com/a.txt";
    const fetchMock = hopFetch({ [start]: { status: 302, location } });
    vi.stubGlobal("fetch", fetchMock);
    const { parts, notes } = await buildFileContentParts([file(start)], "tok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("not an allowed Slack file URL");
  });

  it.each([
    "https://cdn.slack-edge.com/a.txt",
    "https://slack-files.com/a.txt",
  ])("fetches a redirect to %s without the token", async (next) => {
    const start = "https://files.slack.com/a.txt";
    const fetchMock = hopFetch({ [start]: { status: 302, location: next } });
    vi.stubGlobal("fetch", fetchMock);
    const { parts } = await buildFileContentParts([file(start)], "tok");
    expect(parts).toHaveLength(1);
    expect(authHeaders(fetchMock)).toEqual([
      [start, "Bearer tok"],
      [next, null],
    ]);
  });

  it("gives up on a redirect loop", async () => {
    const start = "https://files.slack.com/a.txt";
    // A broken hop cap ends here and fails the assertions below, not by hanging.
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length > 20) throw new Error("no hop cap");
      return new Response(null, { status: 302, headers: { location: url } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { parts, notes } = await buildFileContentParts([file(start)], "tok");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(parts).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("unusable download redirect");
  });

  it("asks fetch not to follow redirects itself", async () => {
    const fetchMock = hopFetch({});
    vi.stubGlobal("fetch", fetchMock);
    await buildFileContentParts([file("https://files.slack.com/a")], "tok");
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe("manual");
  });
});

describe("buildFileContentParts", () => {
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
