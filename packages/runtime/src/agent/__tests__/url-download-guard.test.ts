/**
 * BuiltInAgent must not let a caller aim the server's URL download at an
 * internal address. These run the real agent → AI SDK → download path against
 * a local HTTP server. They include a spelling (`localhost.`) that the AI
 * SDK's own check misses, plus literal forms that it already refuses, as
 * regression guards.
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
import type { RunAgentInput } from "@ag-ui/client";
import { APICallError } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { BuiltInAgent } from "../index";
import type {
  BuiltInAgentClassicConfig,
  BuiltInAgentConfiguration,
} from "../index";
import {
  collectEventsIncludingErrors,
  createDefaultInput,
} from "./agent-test-helpers";
import { blockConnects, interceptConnects } from "./url-download-helpers";
import type { ConnectAttempt } from "./url-download-helpers";

const dns = vi.hoisted(() => ({
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
}));

vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof DnsPromises>();
  const lookup = async (
    hostname: string,
    options: { all: true; verbatim?: boolean },
  ) => {
    dns.lookups.push(hostname);
    return dns.answers.get(hostname) ?? actual.lookup(hostname, options);
  };
  return { ...actual, lookup, default: { ...actual, lookup } };
});

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

function imageInput(url: string): RunAgentInput {
  return createDefaultInput({
    messages: [
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
    ] as RunAgentInput["messages"],
  });
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

async function runWith(
  url: string,
  config: Partial<BuiltInAgentClassicConfig> = {},
  model = mockModel(),
) {
  const before = hits.length;
  const agent = new BuiltInAgent({ model, ...config });
  const { events, errored } = await collectEventsIncludingErrors(
    agent.run(imageInput(url)),
  );
  // Every failure must reach the client as a RUN_ERROR event.
  const failure = (events as Array<{ type: string; message?: string }>).find(
    (event) => event.type === "RUN_ERROR",
  );
  if (errored && !failure) {
    throw new Error("The run failed without a RUN_ERROR event.");
  }
  return {
    fetched: hits.length > before,
    // The AI SDK puts downloaded bytes into the prompt as a Uint8Array.
    modelSawSecret: containsBytes(
      model.doStreamCalls[0]?.prompt,
      Buffer.from(SECRET),
    ),
    failure,
    model,
  };
}

describe("BuiltInAgent URL download guard", () => {
  // `localhost.` slips past the AI SDK's own hostname check yet resolves to
  // loopback, so it reached the server before the fix.
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
    // Control for the `attempts` assertion above: a custom download function
    // that really connects to the cloud metadata address must be recorded
    // and stopped by the helper.
    const attempts = blockConnects(/^169\.254\./);
    const result = await runWith("http://downloads.example/x", {
      urlDownload: async (requests) =>
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

  it("detects the secret in the prompt when a download returns it", async () => {
    // Control for modelSawSecret: it must be able to fail.
    const result = await runWith("http://downloads.example/secret", {
      urlDownload: async (requests) =>
        requests.map(() => ({
          data: new Uint8Array(Buffer.from(SECRET)),
          mediaType: "image/png",
        })),
    });
    expect(result.failure).toBeUndefined();
    expect(result.modelSawSecret).toBe(true);
  });

  it("does not fetch at all when urlDownload is disabled", async () => {
    const result = await runWith(`http://localhost.:${port}/x`, {
      urlDownload: "disabled",
    });
    expect(result.fetched).toBe(false);
    expect(result.failure?.message).toMatch(/disabled/);
  });

  it.each([
    ["the default downloader", {}],
    ['urlDownload: "disabled"', { urlDownload: "disabled" as const }],
  ])("decodes a data: URL locally with %s", async (_label, config) => {
    const bytes = Buffer.from("INLINE-DATA-URL-BYTES");
    const model = mockModel();
    const result = await runWith(
      `data:image/png;base64,${bytes.toString("base64")}`,
      config,
      model,
    );
    expect(result.failure).toBeUndefined();
    expect(result.fetched).toBe(false);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(
      bytes.toString("base64"),
    );
  });

  it("passes a URL the model accepts natively through without fetching it", async () => {
    const model = mockModel({ "image/*": [/^https?:\/\/.*$/] });
    const url = `http://localhost.:${port}/native`;
    const result = await runWith(url, {}, model);
    expect(result.fetched).toBe(false);
    expect(result.failure).toBeUndefined();
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(url);
  });

  it("uses a custom download function when one is configured", async () => {
    const seen: string[] = [];
    const result = await runWith(`http://internal.example/x`, {
      urlDownload: async (requests) =>
        requests.map(({ url }) => {
          seen.push(url.href);
          return { data: new Uint8Array([1, 2, 3]), mediaType: "image/png" };
        }),
    });
    expect(seen).toEqual(["http://internal.example/x"]);
    expect(result.failure).toBeUndefined();
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

describe("BuiltInAgent URL download and the run", () => {
  it("stops a running download when the run is aborted", async () => {
    // The default downloader (30 s timeout) connects to slow.test's public
    // address; the connect is held until something destroys the socket.
    const attempts: ConnectAttempt[] = [];
    interceptConnects(/^slow\.test$/, (attempt) => attempts.push(attempt), {
      hang: true,
    });
    const model = mockModel();
    const agent = new BuiltInAgent({ model });
    const run = collectEventsIncludingErrors(
      agent.run(imageInput("http://slow.test:9/x")),
    );
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    const closed = closedWithin(attempts[0]!.socket, 2_000);
    agent.abortRun();
    expect(await closed).toBe("closed");
    const { events } = await run;
    expect(model.doStreamCalls).toHaveLength(0);
    expect(
      (events as Array<{ type: string }>).some((e) => e.type === "RUN_ERROR"),
    ).toBe(false);
  });
});

describe("BuiltInAgent URL download errors", () => {
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

  it("gives the client a uniform message and logs the failure once, without the query", async () => {
    // 1.1.1.1 is public, so the download connects; the test stops that
    // connect with an error that names the address.
    const attempts = blockConnects(/^1\.1\.1\.1$/);
    let failure: { message?: string } | undefined;
    const logs = await logsDuring(async () => {
      ({ failure } = await runWith("http://1.1.1.1:9/x?sig=SECRET-SIG"));
    });
    expect(attempts).toEqual(["1.1.1.1"]);
    expect(failure?.message).toBe("The download failed.");
    expect(logs.join("\n")).not.toContain("SECRET-SIG");
    const mentions = logs.filter((line) => line.includes("1.1.1.1:9/x"));
    expect(mentions).toHaveLength(1);
    expect(
      logs.filter((line) => line.includes("The download failed.")),
    ).toHaveLength(1);
    expect(mentions[0]).toMatch(
      /^\[BuiltInAgent\] .*test blocked a connection/,
    );
  });

  it("logs a provider API error with its status code and response body, without the query", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new APICallError({
          message: "Bad Request",
          url: "https://api.provider.example/v1/chat?key=SECRET-KEY",
          requestBodyValues: { model: "test-model" },
          statusCode: 400,
          responseBody: '{"error":{"message":"model test-model not found"}}',
          isRetryable: false,
        });
      },
    });
    let failure: { message?: string } | undefined;
    const logs = await logsDuring(async () => {
      ({ failure } = await runWith("data:image/png;base64,AAAA", {}, model));
    });
    expect(failure?.message).toMatch(/Bad Request/);
    const logged = logs.join("\n");
    expect(logged).toContain("[BuiltInAgent] The model call failed");
    expect(logged).toMatch(/statusCode: 400/);
    expect(logged).toContain("model test-model not found");
    expect(logged).toContain("https://api.provider.example/v1/chat");
    expect(logged).not.toContain("SECRET-KEY");
  });

  it("logs a plain-object provider error with its fields", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "error",
              error: {
                message: "Rate limit reached",
                type: "rate_limit_error",
                code: "rate_limit_exceeded",
              },
            },
          ],
        }),
      }),
    });
    const logs = await logsDuring(async () => {
      await runWith("data:image/png;base64,AAAA", {}, model);
    });
    const logged = logs.join("\n");
    expect(logged).toContain("[BuiltInAgent] The model call failed");
    expect(logged).not.toContain("[object Object]");
    expect(logged).toContain("rate_limit_error");
    expect(logged).toContain("Rate limit reached");
  });

  it("logs a refusal once, without the query", async () => {
    let failure: { message?: string } | undefined;
    const logs = await logsDuring(async () => {
      ({ failure } = await runWith(
        `http://169.254.169.254:${port}/latest/meta-data/?sig=SECRET-SIG`,
      ));
    });
    expect(failure?.message).toMatch(/not a public address/);
    expect(failure?.message).not.toContain("SECRET-SIG");
    expect(logs.join("\n")).not.toContain("SECRET-SIG");
    // One line for this failure, from the downloader; not a second one from
    // the model call error handler.
    expect(
      logs.filter((line) => /not a public address/.test(line)),
    ).toHaveLength(1);
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

describe("BuiltInAgent urlDownload configuration", () => {
  it("rejects invalid options when the agent is constructed", () => {
    expect(
      () =>
        new BuiltInAgent({ model: mockModel(), urlDownload: { maxBytes: -1 } }),
    ).toThrow(/urlDownload\.maxBytes/);
    expect(
      () =>
        new BuiltInAgent({
          model: mockModel(),
          urlDownload:
            "off" as unknown as BuiltInAgentClassicConfig["urlDownload"],
        }),
    ).toThrow(/urlDownload/);
  });

  it("rejects a mistyped option name when the agent is constructed", () => {
    // A mistyped allowedHosts must not silently allow every public host.
    expect(
      () =>
        new BuiltInAgent({
          model: mockModel(),
          urlDownload: {
            allowedhosts: ["cdn.example.com"],
          } as unknown as BuiltInAgentClassicConfig["urlDownload"],
        }),
    ).toThrow(/urlDownload has an unknown option "allowedhosts"/);
  });

  it.each([
    ["disabled", "disabled"],
    ["an options object", { allowedHosts: ["cdn.example.com"] }],
  ])(
    "throws when urlDownload (%s) is set in factory mode, where it cannot take effect",
    (_label, urlDownload) => {
      expect(
        () =>
          new BuiltInAgent({
            type: "aisdk",
            factory: () => ({ fullStream: (async function* () {})() }),
            urlDownload,
          } as unknown as BuiltInAgentConfiguration),
      ).toThrow(
        /urlDownload has no effect in factory mode.*createSafeUrlDownload/,
      );
    },
  );

  it("treats urlDownload: null like the default", async () => {
    const result = await runWith(`http://localhost.:${port}/null-config`, {
      urlDownload: null as unknown as BuiltInAgentClassicConfig["urlDownload"],
    });
    expect(result.fetched).toBe(false);
    expect(result.failure?.message).toMatch(/not a public address/);
  });

  it("reports a failed download as RUN_ERROR", async () => {
    const result = await runWith("http://downloads.example/x", {
      urlDownload: async () => {
        throw new Error("custom download failed");
      },
    });
    expect(result.failure?.message).toMatch(/custom download failed/);
  });
});
