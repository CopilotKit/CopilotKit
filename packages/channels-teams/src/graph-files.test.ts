import { describe, it, expect, vi, afterEach } from "vitest";
import { incoming, mockHttps, publicDns } from "./attachment-test-helpers.js";
import { buildChannelFileContentParts } from "./graph-files.js";
import type { GraphCredentials, ChannelMessageRef } from "./graph-files.js";

const creds: GraphCredentials = {
  clientId: "app-1",
  clientSecret: "secret",
  tenantId: "tenant-1",
};
const ref: ChannelMessageRef = {
  teamId: "team-1",
  channelId: "19:abc@thread.tacv2",
  messageId: "100",
  rootId: "100",
};

/**
 * Route fetch by URL: the token endpoint, the Graph message read, and the
 * SharePoint download all hit different hosts/paths.
 */
function routeFetch(handlers: {
  message: { attachments?: unknown[] };
  download?: { ok?: boolean; status?: number; body?: Uint8Array };
}) {
  publicDns();
  mockHttps(() =>
    incoming(handlers.download?.body ?? "", handlers.download?.status ?? 200),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return Response.json({ access_token: "tok", expires_in: 3600 });
      }
      return Response.json(handlers.message);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildChannelFileContentParts (Graph)", () => {
  it("does not start a metadata request after token bytes exhaust the message budget", async () => {
    vi.resetModules();
    const { buildChannelFileContentParts: freshBuilder } =
      await import("./graph-files.js");
    const token = JSON.stringify({ access_token: "synthetic", expires_in: 0 });
    const fetch = vi.fn(async (url: string) =>
      url.includes("/oauth2/v2.0/token")
        ? new Response(token)
        : Response.json({ attachments: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await freshBuilder(ref, creds, {
      maxBytesPerMessage: Buffer.byteLength(token),
    });
    expect(result.parts).toEqual([]);
    expect(result.notes[0]).toContain("byte cap");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("downloads a Graph redirect without sending its bearer to the file host", async () => {
    publicDns();
    const request = mockHttps((options) => {
      if (request.mock.calls.length === 1) {
        expect(options.hostname).toBe("graph.microsoft.com");
        expect(options.path).toMatch(
          /^\/v1\.0\/shares\/u!.*\/driveItem\/content$/,
        );
        expect(options.headers).toHaveProperty("Authorization", "Bearer tok");
        return incoming("", 302, {
          location: "https://download.files.1drv.com/file?sig=private",
        });
      }
      expect(options.hostname).toBe("download.files.1drv.com");
      expect(options.headers).not.toHaveProperty("Authorization");
      return incoming("a,b\n1,2");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        expect(options.redirect).toBe("error");
        expect(options.signal).toBeInstanceOf(AbortSignal);
        if (url.includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        return Response.json({
          attachments: [
            {
              contentType: "reference",
              name: "data.csv",
              contentUrl: "https://contoso.sharepoint.com/data.csv",
            },
          ],
        });
      }),
    );
    const result = await buildChannelFileContentParts(ref, creds);
    expect(result.notes).toEqual([]);
    expect(result.parts).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels an oversized Graph metadata stream before attempting a download", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel,
    });
    const request = mockHttps(() => incoming("unexpected"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        return new Response(stream);
      }),
    );
    const result = await buildChannelFileContentParts(ref, creds);
    expect(result.parts).toEqual([]);
    expect(result.notes[0]).toContain("byte cap");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("aborts a stalled Graph metadata response within the download deadline", async () => {
    let signal: AbortSignal | null | undefined;
    const request = mockHttps(() => incoming("unexpected"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: "tok", expires_in: 3600 });
        }
        signal = options.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              signal!.addEventListener(
                "abort",
                () => controller.error(signal!.reason),
                { once: true },
              );
            },
          }),
        );
      }),
    );
    const result = await buildChannelFileContentParts(ref, creds, {
      downloadTimeoutMs: 10,
    });
    expect(result.parts).toEqual([]);
    expect(result.notes[0]).toContain("timed out");
    expect(signal?.aborted).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads a channel message's reference attachment and downloads the CSV", async () => {
    routeFetch({
      message: {
        attachments: [
          {
            contentType: "reference",
            contentUrl:
              "https://contoso.sharepoint.com/sites/team/Shared Documents/incidents.csv",
            name: "incidents.csv",
          },
        ],
      },
      download: { body: new TextEncoder().encode("severity,count\nSev1,4") },
    });

    const { parts, notes } = await buildChannelFileContentParts(ref, creds);

    expect(notes).toEqual([]);
    expect(parts).toHaveLength(1);
    const text = (parts[0] as { type: string; text: string }).text;
    expect(text).toContain('Attached file "incidents.csv" (text/csv)');
    expect(text).toContain("severity,count");
  });

  it("ignores non-file (mention/html) attachments", async () => {
    routeFetch({
      message: {
        attachments: [
          { contentType: "messageReference", content: "{}" },
          { contentType: "reference" }, // no contentUrl
        ],
      },
    });
    const { parts, notes } = await buildChannelFileContentParts(ref, creds);
    expect(parts).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("notes a download permission failure (so the caller can react)", async () => {
    routeFetch({
      message: {
        attachments: [
          {
            contentType: "reference",
            contentUrl: "https://contoso.sharepoint.com/sites/team/x.csv",
            name: "x.csv",
          },
        ],
      },
      download: { ok: false, status: 403 },
    });
    const { parts, notes } = await buildChannelFileContentParts(ref, creds);
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("Files.Read.All");
  });

  it("notes when the channel-message read fails (e.g. RSC not granted)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/oauth2/v2.0/token")) {
          return Response.json({ access_token: "t", expires_in: 3600 });
        }
        return new Response("forbidden", { status: 403 });
      }),
    );
    const { parts, notes } = await buildChannelFileContentParts(ref, creds);
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("ChannelMessage.Read.Group");
  });
});
