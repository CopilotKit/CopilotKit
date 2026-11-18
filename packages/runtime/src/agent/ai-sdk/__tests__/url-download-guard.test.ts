/**
 * `createSafeUrlDownload`, used as `experimental_download` in a real
 * `streamText` call, must not let a caller aim the server's URL download at
 * an internal address. These run AG-UI messages through
 * `convertMessagesToVercelAISDKMessages` and the AI SDK's download path
 * against a local HTTP server. They include a spelling (`localhost.`) that
 * the AI SDK's own check misses, plus literal forms that it already refuses,
 * as regression guards.
 *
 * The downloader's DNS lookups go through a stub that answers the names in
 * `dnsAnswers` (so these cases never depend on the host's resolver) and sends
 * every other name to real DNS. The address policy is never stubbed.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { format } from "node:util";
import type { LookupAddress } from "node:dns";
import type * as DnsPromises from "node:dns/promises";
import type { AddressInfo } from "node:net";
import type { Message } from "@ag-ui/client";
import { streamText } from "ai";
import type { Experimental_DownloadFunction } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { convertMessagesToVercelAISDKMessages } from "../index";
import { createSafeUrlDownload } from "../url-download";
import {
  blockConnects,
  interceptConnects,
  stubBuiltinModule,
} from "./url-download-helpers";
import type { ConnectAttempt } from "./url-download-helpers";

const dns = {
  answers: new Map<string, LookupAddress[]>([
    // As common resolvers answer it; real DNS is not asked.
    [
      "localhost.",
      [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ],
    ],
    // A public address; the tests hold the connect before a packet is sent.
    ["slow.test", [{ address: "1.1.1.1", family: 4 }]],
  ]),
  lookups: [] as string[],
};

const restoreDns = stubBuiltinModule("node:dns/promises", (actual) => {
  const real = actual as typeof DnsPromises;
  const lookup = async (
    hostname: string,
    options: { all: true; verbatim?: boolean },
  ) => {
    dns.lookups.push(hostname);
    return dns.answers.get(hostname) ?? real.lookup(hostname, options);
  };
  return { ...real, lookup };
});
afterAll(restoreDns);

const SECRET = "INTERNAL-SECRET-BYTES";

function mockModel(supportedUrls: Record<string, RegExp[]> = {}) {
  return new MockLanguageModelV3({
    supportedUrls,
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "ok" },
          { type: "text-end", id: "t" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }),
  });
}

function imageMessages(url: string): Message[] {
  return [
    {
      id: "u1",
      role: "user",
      content: [
        { type: "text", text: "describe" },
        {
          type: "image",
          source: { type: "url", value: url, mimeType: "image/png" },
        },
      ],
    },
  ];
}

let server: http.Server;
let v6Server: http.Server | undefined;
let port: number;
const hits: string[] = [];

/** True if `value` holds `bytes`, as raw bytes or as base64 text. */
function containsBytes(value: unknown, bytes: Buffer): boolean {
  if (value instanceof Uint8Array) return Buffer.from(value).equals(bytes);
  if (typeof value === "string") {
    return value.includes(bytes.toString("base64"));
  }
  if (value instanceof URL || value === null || typeof value !== "object") {
    return false;
  }
  return Object.values(value).some((child) => containsBytes(child, bytes));
}

function listen(
  target: http.Server,
  listenPort: number,
  host: string,
): Promise<NodeJS.ErrnoException | undefined> {
  return new Promise((resolve) => {
    target.once("error", resolve);
    target.listen(listenPort, host, () => {
      target.off("error", resolve);
      resolve(undefined);
    });
  });
}

beforeAll(async () => {
  const handler: http.RequestListener = (req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    res.writeHead(200, { "content-type": "image/png" });
    res.end(SECRET);
  };
  // Loopback only, so that nothing else on the network can reach the secret.
  // The IPv6 listener takes the same port, so that one URL port reaches the
  // server over IPv4 and IPv6 loopback; a host without IPv6 skips it.
  for (let attempt = 0; ; attempt++) {
    server = http.createServer(handler);
    const v4Error = await listen(server, 0, "127.0.0.1");
    if (v4Error) throw v4Error;
    port = (server.address() as AddressInfo).port;
    const v6 = http.createServer(handler);
    const v6Error = await listen(v6, port, "::1");
    if (!v6Error) {
      v6Server = v6;
      break;
    }
    if (v6Error.code !== "EADDRINUSE" || attempt >= 10) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const s of [server, ...(v6Server ? [v6Server] : [])]) {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

/**
 * Streams one `streamText` call whose user message has an image at `url`,
 * and returns what reached the local server, the model and the stream.
 */
async function runWith(
  url: string,
  {
    download = createSafeUrlDownload(),
    model = mockModel(),
    abortSignal,
  }: {
    download?: Experimental_DownloadFunction;
    model?: MockLanguageModelV3;
    abortSignal?: AbortSignal;
  } = {},
) {
  const before = hits.length;
  const result = streamText({
    model,
    messages: convertMessagesToVercelAISDKMessages(imageMessages(url)),
    experimental_download: download,
    abortSignal,
    // The stream carries the error; the AI SDK's default handler would also
    // print it, which is not what these tests pin.
    onError: () => {},
  });
  const errors: unknown[] = [];
  for await (const part of result.fullStream) {
    if (part.type === "error") errors.push(part.error);
  }
  const [error] = errors;
  return {
    fetched: hits.length > before,
    // The AI SDK puts downloaded bytes into the prompt as a Uint8Array.
    modelSawSecret: containsBytes(
      model.doStreamCalls[0]?.prompt,
      Buffer.from(SECRET),
    ),
    failure: error instanceof Error ? error : undefined,
    model,
  };
}

describe("createSafeUrlDownload in streamText", () => {
  // `localhost.` slips past the AI SDK's own hostname check yet resolves to
  // loopback.
  it("refuses to fetch a trailing-dot localhost URL", async () => {
    const before = dns.lookups.length;
    const result = await runWith(`http://localhost.:${port}/latest/meta-data/`);
    // The downloader resolved the name and refused its loopback answer.
    expect(dns.lookups.slice(before)).toEqual(["localhost."]);
    expect(result.fetched).toBe(false);
    expect(result.modelSawSecret).toBe(false);
    expect(result.failure?.message).toMatch(/not a public address/);
  });

  // Literal forms. The URL parser turns `127.0.0.1.` into `127.0.0.1`, so a
  // trailing dot on an IPv4 literal is the same case as the plain literal.
  it.each([
    ["IPv4 loopback", () => `http://127.0.0.1:${port}/latest/meta-data/`],
    [
      "IPv4-mapped IPv6 loopback",
      () => `http://[::ffff:127.0.0.1]:${port}/latest/meta-data/`,
    ],
    ["IPv6 loopback", () => `http://[::1]:${port}/latest/meta-data/`],
  ])("refuses to fetch a %s URL", async (_label, url) => {
    const result = await runWith(url());
    expect(result.fetched).toBe(false);
    expect(result.modelSawSecret).toBe(false);
    expect(result.failure?.message).toMatch(/not a public address/);
  });

  it("refuses a cloud metadata address without connecting to it", async () => {
    const attempts = blockConnects(/^169\.254\./);
    const result = await runWith(
      `http://169.254.169.254:${port}/latest/meta-data/`,
    );
    expect(attempts).toEqual([]);
    expect(result.modelSawSecret).toBe(false);
    expect(result.failure?.message).toMatch(/not a public address/);
  });

  it("blockConnects sees a connection that the download makes (control)", async () => {
    // Control for the `attempts` assertion above: a download function that
    // really connects to the cloud metadata address must be recorded and
    // stopped by the helper.
    const attempts = blockConnects(/^169\.254\./);
    const result = await runWith("http://downloads.example/x", {
      download: async (requests) =>
        Promise.all(
          requests.map(
            () =>
              new Promise<null>((resolve, reject) => {
                http
                  .get({ host: "169.254.169.254", port, path: "/" }, () =>
                    resolve(null),
                  )
                  .on("error", reject);
              }),
          ),
        ),
    });
    expect(attempts).toEqual(["169.254.169.254"]);
    expect(result.failure?.message).toMatch(/test blocked a connection/);
  });

  it("detects the secret in the prompt when a download returns it (control)", async () => {
    // Control for modelSawSecret: it must be able to fail.
    const result = await runWith("http://downloads.example/secret", {
      download: async (requests) =>
        requests.map(() => ({
          data: new Uint8Array(Buffer.from(SECRET)),
          mediaType: "image/png",
        })),
    });
    expect(result.failure).toBeUndefined();
    expect(result.modelSawSecret).toBe(true);
  });

  it("decodes a data: URL locally", async () => {
    const bytes = Buffer.from("INLINE-DATA-URL-BYTES");
    const result = await runWith(
      `data:image/png;base64,${bytes.toString("base64")}`,
    );
    expect(result.failure).toBeUndefined();
    expect(result.fetched).toBe(false);
    expect(JSON.stringify(result.model.doStreamCalls[0]?.prompt)).toContain(
      bytes.toString("base64"),
    );
  });

  it("passes a URL the model accepts natively through without fetching it", async () => {
    const model = mockModel({ "image/*": [/^https?:\/\/.*$/] });
    const url = `http://localhost.:${port}/native`;
    const result = await runWith(url, { model });
    expect(result.fetched).toBe(false);
    expect(result.failure).toBeUndefined();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(url);
  });
});

/** Resolves with "closed" when `socket` closes within `ms`, else "open". */
function closedWithin(
  socket: net.Socket,
  ms: number,
): Promise<"closed" | "open"> {
  return new Promise((resolve) => {
    if (socket.destroyed) return resolve("closed");
    const timer = setTimeout(() => resolve("open"), ms);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve("closed");
    });
  });
}

describe("createSafeUrlDownload in streamText and the abort signal", () => {
  it("stops a running download when the signal aborts", async () => {
    // The downloader (30 s timeout) connects to slow.test's public address;
    // the connect is held until something destroys the socket.
    const attempts: ConnectAttempt[] = [];
    interceptConnects(/^slow\.test$/, (attempt) => attempts.push(attempt), {
      hang: true,
    });
    const controller = new AbortController();
    const model = mockModel();
    const run = runWith("http://slow.test:9/x", {
      download: createSafeUrlDownload({ signal: controller.signal }),
      model,
      abortSignal: controller.signal,
    });
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    const closed = closedWithin(attempts[0]!.socket, 2_000);
    controller.abort();
    expect(await closed).toBe("closed");
    await run;
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("createSafeUrlDownload in streamText errors", () => {
  /**
   * Every console.warn and console.error line written while `body` runs,
   * formatted as the console prints it (an error with its properties).
   */
  async function logsDuring(body: () => Promise<void>): Promise<string[]> {
    const lines: string[] = [];
    const record = (...args: unknown[]) => {
      lines.push(format(...args));
    };
    vi.spyOn(console, "warn").mockImplementation(record);
    vi.spyOn(console, "error").mockImplementation(record);
    await body();
    return lines;
  }

  it("gives the stream a uniform message and logs the failure once, without the query", async () => {
    // 1.1.1.1 is public, so the download connects; the test stops that
    // connect with an error that names the address.
    const attempts = blockConnects(/^1\.1\.1\.1$/);
    let failure: Error | undefined;
    const logs = await logsDuring(async () => {
      ({ failure } = await runWith("http://1.1.1.1:9/x?sig=SECRET-SIG"));
    });
    expect(attempts).toEqual(["1.1.1.1"]);
    expect(failure?.message).toBe("The download failed.");
    expect(logs.join("\n")).not.toContain("SECRET-SIG");
    const mentions = logs.filter((line) => line.includes("1.1.1.1:9/x"));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatch(/^\[CopilotKit\] .*test blocked a connection/);
  });

  it("logs a refusal once, without the query", async () => {
    let failure: Error | undefined;
    const logs = await logsDuring(async () => {
      ({ failure } = await runWith(
        `http://169.254.169.254:${port}/latest/meta-data/?sig=SECRET-SIG`,
      ));
    });
    expect(failure?.message).toMatch(/not a public address/);
    expect(failure?.message).not.toContain("SECRET-SIG");
    expect(logs.join("\n")).not.toContain("SECRET-SIG");
    expect(
      logs.filter((line) => line.includes("169.254.169.254")),
    ).toHaveLength(1);
  });
});

describe("URL download guard test server", () => {
  it("is reachable only on loopback", async (ctx) => {
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((info) => info && !info.internal && info.family === "IPv4");
    if (!external) ctx.skip("this host has no non-loopback IPv4 address");
    const reached = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: external!.address, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    expect(reached).toBe(false);
  });
});
