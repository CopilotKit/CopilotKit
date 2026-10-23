import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import type { LookupFunction } from "node:net";
import { downloadAttachment, DownloadBudget } from "./attachment-download.js";
import { incoming, mockHttps, publicDns } from "./attachment-test-helpers.js";

const URL = "https://contoso.sharepoint.com/file?sig=synthetic-secret";
afterEach(() => vi.restoreAllMocks());

describe("bounded attachment download", () => {
  it("checks elapsed time when synchronous work finishes before the timeout callback runs", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const budget = new DownloadBudget({ downloadTimeoutMs: 10 });
    await expect(
      budget.run(async () => {
        now = 11;
        return "late";
      }),
    ).rejects.toThrow(/timed out/);
  });
  it("applies the per-download deadline to inline data decoding", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const decoded = Buffer.from("a");
    vi.spyOn(Buffer, "from").mockImplementationOnce(() => {
      now = 11;
      return decoded;
    });
    await expect(
      downloadAttachment(
        "data:text/plain;base64,YQ==",
        new DownloadBudget({ downloadTimeoutMs: 10 }),
      ),
    ).rejects.toThrow(/timed out/);
  });
  it.each([
    "169.254.169.254",
    "127.0.0.1",
    "10.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
  ])(
    "does not connect when an allowed hostname resolves to %s",
    async (address) => {
      publicDns().mockResolvedValue([
        { address, family: address.includes(":") ? 6 : 4 },
      ] as never);
      const request = mockHttps(() => incoming("secret"));
      await expect(
        downloadAttachment(URL, new DownloadBudget()),
      ).rejects.toThrow(/nonpublic/);
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects mixed public/private DNS answers", async () => {
    publicDns().mockResolvedValue([
      { address: "13.107.136.9", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ] as never);
    const request = mockHttps(() => incoming());
    await expect(downloadAttachment(URL, new DownloadBudget())).rejects.toThrow(
      /nonpublic/,
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("pins the socket lookup and preserves the TLS hostname", async () => {
    const lookup = publicDns();
    mockHttps((options) => {
      expect(options.hostname).toBe("contoso.sharepoint.com");
      expect(options.servername).toBe("contoso.sharepoint.com");
      expect(options.rejectUnauthorized).toBe(true);
      const callback = vi.fn();
      (options.lookup as LookupFunction)(
        "contoso.sharepoint.com",
        { all: true },
        callback,
      );
      expect(callback).toHaveBeenCalledWith(null, [
        { address: "13.107.136.9", family: 4 },
      ]);
      // A second OS lookup would now return metadata. The socket must never do it.
      lookup.mockResolvedValue([
        { address: "169.254.169.254", family: 4 },
      ] as never);
      return incoming("ok");
    });
    expect(
      (await downloadAttachment(URL, new DownloadBudget())).toString(),
    ).toBe("ok");
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("revalidates redirects before connecting to the target", async () => {
    publicDns();
    const response = incoming("", 302, {
      location: "https://169.254.169.254/secret",
    });
    const request = mockHttps(() => response);
    await expect(downloadAttachment(URL, new DownloadBudget())).rejects.toThrow(
      /not an allowed/,
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(response.destroyed).toBe(true);
  });
  it("rechecks DNS even on a same-host redirect", async () => {
    publicDns()
      .mockResolvedValueOnce([{ address: "13.107.136.9", family: 4 }] as never)
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
    const request = mockHttps(() => incoming("", 302, { location: "/next" }));
    await expect(downloadAttachment(URL, new DownloadBudget())).rejects.toThrow(
      /nonpublic/,
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("drops Graph authorization permanently at the first redirect", async () => {
    publicDns();
    const request = mockHttps((options) => {
      if (request.mock.calls.length === 1) {
        expect(options.headers).toMatchObject({
          Authorization: "Bearer synthetic-token",
        });
        return incoming("", 302, {
          location: "https://download.files.1drv.com/preauth",
        });
      }
      expect(options.headers).not.toHaveProperty("Authorization");
      return incoming("csv");
    });
    expect(
      (
        await downloadAttachment(
          "https://graph.microsoft.com/v1.0/shares/id/driveItem/content",
          new DownloadBudget(),
          "synthetic-token",
        )
      ).toString(),
    ).toBe("csv");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not attach a Graph bearer token to an arbitrary allowed attachment host", async () => {
    publicDns();
    const request = mockHttps(() => incoming());
    await expect(
      downloadAttachment(URL, new DownloadBudget(), "token"),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("bounds redirect chains", async () => {
    publicDns();
    const request = mockHttps(() => incoming("", 302, { location: "/again" }));
    await expect(downloadAttachment(URL, new DownloadBudget())).rejects.toThrow(
      /redirect limit/,
    );
    expect(request).toHaveBeenCalledTimes(6);
  });
  it.each([undefined, "1"])(
    "cancels oversized streaming data even with Content-Length %s",
    async (declared) => {
      publicDns();
      let pulled = 0;
      const body = Readable.from(
        (function* () {
          for (let i = 0; i < 100; i++) {
            pulled++;
            yield Buffer.alloc(8);
          }
        })(),
        { highWaterMark: 1 },
      );
      mockHttps(() =>
        incoming(body, 200, declared ? { "content-length": declared } : {}),
      );
      await expect(
        downloadAttachment(URL, new DownloadBudget({ maxBytesPerFile: 16 })),
      ).rejects.toThrow(/byte cap/);
      expect(pulled).toBeLessThan(100);
      expect(body.destroyed).toBe(true);
    },
  );
  it("rejects an oversized Content-Length without reading the body", async () => {
    publicDns();
    const body = new Readable({ read: vi.fn() });
    mockHttps(() => incoming(body, 200, { "content-length": "100" }));
    await expect(
      downloadAttachment(URL, new DownloadBudget({ maxBytesPerFile: 16 })),
    ).rejects.toThrow(/byte cap/);
    expect(body.destroyed).toBe(true);
  });
  it("times out during DNS and never opens a socket afterward", async () => {
    let finish!: (value: never) => void;
    publicDns().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = mockHttps(() => incoming());
    await expect(
      downloadAttachment(URL, new DownloadBudget({ downloadTimeoutMs: 10 })),
    ).rejects.toThrow(/timed out/);
    finish([{ address: "13.107.136.9", family: 4 }] as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(request).not.toHaveBeenCalled();
  });
  it("times out and destroys a stalled body", async () => {
    publicDns();
    const body = new Readable({ read() {} });
    mockHttps(() => incoming(body));
    await expect(
      downloadAttachment(URL, new DownloadBudget({ downloadTimeoutMs: 10 })),
    ).rejects.toThrow(/timed out/);
    expect(body.destroyed).toBe(true);
  });
  it.each([
    "data:text/plain;base64," + "YQ==".repeat(100),
    "data:text/plain," + "%61".repeat(100),
  ])("bounds data URIs before decoding", async (url) => {
    const spy = vi.spyOn(Buffer, "from");
    await expect(
      downloadAttachment(url, new DownloadBudget({ maxBytesPerFile: 16 })),
    ).rejects.toThrow(/byte cap/);
    expect(spy).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "data:text/plain;base64,=",
    "data:text/plain,%GG",
    "data:text/plain,%FF",
  ])("refuses malformed input %s", async (source) => {
    await expect(
      downloadAttachment(source, new DownloadBudget()),
    ).rejects.toThrow();
  });
  it.each([
    "data:text/plain,hello%20world",
    "data:text/plain;base64,aGVsbG8gd29ybGQ=",
  ])("keeps valid inline data working", async (source) => {
    expect(
      (await downloadAttachment(source, new DownloadBudget())).toString(),
    ).toBe("hello world");
  });
  it("does not reset the message deadline for a subsequent file", async () => {
    const budget = new DownloadBudget({ maxDownloadTimeMs: 10 });
    await downloadAttachment("data:text/plain,a", budget);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await expect(
      downloadAttachment("data:text/plain,b", budget),
    ).rejects.toThrow(/timed out/);
  });
  it("refuses HTTPS downgrades without making a second request", async () => {
    publicDns();
    const request = mockHttps(() =>
      incoming("", 302, { location: "http://contoso.sharepoint.com/file" }),
    );
    await expect(
      downloadAttachment(URL, new DownloadBudget()),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("shares byte and file-attempt limits between downloads", async () => {
    const budget = new DownloadBudget({ maxBytesPerMessage: 4 });
    expect(
      (await downloadAttachment("data:text/plain,abc", budget)).toString(),
    ).toBe("abc");
    await expect(
      downloadAttachment("data:text/plain,de", budget),
    ).rejects.toThrow(/byte cap/);
    const files = new DownloadBudget({ maxFiles: 1 });
    await expect(
      downloadAttachment("https://evil.example/", files),
    ).rejects.toThrow();
    await expect(
      downloadAttachment("data:text/plain,ok", files),
    ).rejects.toThrow(/file limit/);
  });
});
