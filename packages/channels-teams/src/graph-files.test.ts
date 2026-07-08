import { describe, it, expect, vi, afterEach } from "vitest";
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
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/oauth2/v2.0/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "tok", expires_in: 3600 }),
        } as unknown as Response;
      }
      if (url.includes("/messages/")) {
        return {
          ok: true,
          status: 200,
          json: async () => handlers.message,
        } as unknown as Response;
      }
      // /shares/.../driveItem/content
      const d = handlers.download ?? {};
      return {
        ok: d.ok ?? true,
        status: d.status ?? 200,
        arrayBuffer: async () => (d.body ?? new Uint8Array()).buffer,
        text: async () => "",
      } as unknown as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("buildChannelFileContentParts (Graph)", () => {
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
          return {
            ok: true,
            json: async () => ({ access_token: "t", expires_in: 3600 }),
          } as unknown as Response;
        }
        return {
          ok: false,
          status: 403,
          text: async () => "forbidden",
        } as unknown as Response;
      }),
    );
    const { parts, notes } = await buildChannelFileContentParts(ref, creds);
    expect(parts).toEqual([]);
    expect(notes[0]).toContain("ChannelMessage.Read.Group");
  });
});
