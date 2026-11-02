/**
 * Unit tests for the public-network-only URL downloader. A real local HTTP
 * server is the target; the DNS answer and, where a case needs to reach that
 * server, the address policy are stubbed.
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
import { execFileSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LookupAddress } from "node:dns";
import { lookup as realLookup } from "node:dns/promises";
import type { AddressInfo, LookupFunction } from "node:net";
import { COPILOTKIT_VERSION } from "@copilotkit/shared";
import {
  createGuardedUrlDownload,
  createSafeUrlDownload,
  disabledUrlDownload,
  isPublicAddress,
  resolveUrlDownloadSetting,
} from "../url-download";
import type {
  SafeUrlDownloadOptions,
  UrlDownloadInternals,
} from "../url-download";
import {
  blockConnects,
  interceptConnects,
  localhostDotIsLoopback,
  stubBuiltinModule,
} from "./url-download-helpers";
import type { ConnectAttempt } from "./url-download-helpers";

let server: http.Server;
let port: number;
let tlsServer: https.Server;
let tlsPort: number;
let tlsCa: string;
// An IPv6 loopback listener; undefined where the host has no IPv6.
let v6Server: http.Server | undefined;
let v6Port: number | undefined;
const hits: string[] = [];
// Emits "open" and "close" with the path of each /slow request.
const slowOpened = new EventEmitter();

/**
 * A short-lived self-signed certificate for `public.test` and
 * `cdn.public.test`, made with the openssl CLI so that no key is stored in
 * the repository.
 */
function makeCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "url-download-tls-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "key.pem"),
        "-out",
        join(dir, "cert.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=public.test",
        "-addext",
        "subjectAltName=DNS:public.test,DNS:cdn.public.test",
      ],
      { stdio: "ignore" },
    );
    return {
      key: readFileSync(join(dir, "key.pem"), "utf8"),
      cert: readFileSync(join(dir, "cert.pem"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  const { key, cert } = makeCertificate();
  tlsCa = cert;
  tlsServer = https.createServer({ key, cert }, handle);
  server = http.createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) =>
    tlsServer.listen(0, "127.0.0.1", resolve),
  );
  tlsPort = (tlsServer.address() as AddressInfo).port;
  const v6 = http.createServer(handle);
  await new Promise<void>((resolve) => {
    v6.once("error", () => resolve());
    v6.listen(0, "::1", () => {
      v6Server = v6;
      v6Port = (v6.address() as AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  for (const s of [server, tlsServer, ...(v6Server ? [v6Server] : [])]) {
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  hits.push(req.url ?? "");
  if (req.url?.startsWith("/redirect?to=")) {
    res.writeHead(302, {
      location: decodeURIComponent(req.url.slice("/redirect?to=".length)),
    });
    res.end();
    return;
  }
  if (req.url === "/chunked") {
    // No Content-Length: only the running byte count can stop this body.
    res.writeHead(200, { "content-type": "image/png" });
    for (let i = 0; i < 4; i++) res.write(Buffer.alloc(512));
    res.end();
    return;
  }
  if (req.url?.startsWith("/not-found")) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("missing");
    return;
  }
  if (req.url === "/user-agent") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(String(req.headers["user-agent"]));
    return;
  }
  if (req.url === "/no-location") {
    res.writeHead(302);
    res.end();
    return;
  }
  if (req.url === "/gzip") {
    res.writeHead(200, {
      "content-type": "image/png",
      "content-encoding": "gzip",
    });
    res.end("not really gzip");
    return;
  }
  if (req.url === "/upgrade") {
    req.socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x-test\r\n\r\n",
    );
    return;
  }
  if (req.url === "/bad-location") {
    res.writeHead(302, { location: "http://[bad-location" });
    res.end();
    return;
  }
  if (req.url?.startsWith("/big")) {
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": "2048",
    });
    res.end(Buffer.alloc(2048));
    return;
  }
  if (req.url?.startsWith("/declared-hang")) {
    // Declares a body larger than the test limits, then never sends it: only
    // the Content-Length check can stop this download in time.
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": "2048",
    });
    res.flushHeaders();
    return;
  }
  if (req.url?.startsWith("/slow")) {
    slowOpened.emit("open", req.url);
    req.socket.once("close", () => slowOpened.emit("close", req.url));
    res.writeHead(200, { "content-type": "image/png" });
    res.write("partial");
    return; // Never ends.
  }
  res.writeHead(200, { "content-type": "image/png" });
  res.end("PUBLIC-BYTES");
}

/**
 * DNS stub: `public.test` answers 127.0.0.1, which the stubbed policy treats
 * as public so that the case can reach the local server. Real DNS cannot
 * resolve `public.test`, so a successful fetch also proves that the
 * connection used the checked (pinned) address.
 */
function stubs(
  answers: Record<string, string[]>,
  publicAddresses = ["127.0.0.1"],
): UrlDownloadInternals & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    resolveHost: async (hostname): Promise<LookupAddress[]> => {
      lookups.push(hostname);
      const answer = answers[hostname];
      if (!answer) throw new Error(`ENOTFOUND ${hostname}`);
      return answer.map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      }));
    },
    isPublicAddress: (address) => publicAddresses.includes(address),
  };
}

async function fetchOne(
  download: ReturnType<typeof createSafeUrlDownload>,
  url: string,
) {
  const [result] = await download([
    { url: new URL(url), isUrlSupportedByModel: false },
  ]);
  return result;
}

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.16.0.0",
    "172.31.255.255",
    "127.0.0.0",
    "127.255.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd00:ec2::254",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "fe80::1%lo0",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.1",
    "203.0.113.1",
    "240.0.0.1",
    "255.255.255.255",
    "2001::1", // Teredo.
    "2001:4:112::1", // Inside 2001::/23, blocked whole on purpose.
    "2002:7f00:1::1", // 6to4.
    "3fff::1",
    "ff02::1",
    "100::1",
  ])("rejects %s", async (address) => {
    expect(await isPublicAddress(address)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.0",
    "126.255.255.255",
    "128.0.0.0",
    "100.63.255.255",
    "198.17.255.255",
    "2606:4700:4700::1111",
    "2001:200::1",
    "2a00:1450:4001::1",
  ])("accepts %s", async (address) => {
    expect(await isPublicAddress(address)).toBe(true);
  });
});

describe("createSafeUrlDownload", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses literal loopback, private and metadata addresses", async () => {
    const attempts = blockConnects(/^(10|169\.254|192\.168)\./);
    const download = createSafeUrlDownload();
    const before = hits.length;
    for (const url of [
      `http://127.0.0.1:${port}/`,
      `http://[::1]:${port}/`,
      `http://[::ffff:127.0.0.1]:${port}/`,
      `http://10.0.0.1:${port}/`,
      `http://192.168.0.1:${port}/`,
      `http://169.254.169.254:${port}/latest/meta-data/`,
    ]) {
      await expect(fetchOne(download, url), url).rejects.toThrow(
        /not a public address/,
      );
    }
    expect(hits.length).toBe(before);
    expect(attempts).toEqual([]);
  });

  it("blockConnects records and blocks a real connection attempt (control)", async () => {
    // Control for the `attempts` assertions: with the policy stubbed to accept
    // loopback, the download really tries to connect, and the helper must
    // see that attempt and stop it before it reaches the server.
    const attempts = blockConnects(/^127\.0\.0\.1$/);
    const download = createGuardedUrlDownload(
      {},
      { isPublicAddress: (address) => address === "127.0.0.1" },
    );
    const before = hits.length;
    await expect(
      fetchOne(download, `http://127.0.0.1:${port}/control`),
    ).rejects.toThrow();
    expect(attempts).toEqual(["127.0.0.1"]);
    expect(hits.length).toBe(before);
  });

  it("refuses localhost. (trailing dot) through real DNS", async (ctx) => {
    if (!(await localhostDotIsLoopback())) {
      ctx.skip("localhost. does not resolve to loopback on this host");
    }
    const before = hits.length;
    await expect(
      fetchOne(createSafeUrlDownload(), `http://localhost.:${port}/`),
    ).rejects.toThrow(/not a public address/);
    expect(hits.length).toBe(before);
  });

  it("refuses hostnames whose DNS answer the real policy finds non-public", async () => {
    // Only the DNS answer is stubbed; the real isPublicAddress judges it.
    const answers: Record<string, string[]> = {
      "loopback.test": ["127.0.0.2"],
      "loopback.test.": ["127.0.0.1"], // A genuine trailing-dot hostname.
      "private.test": ["10.0.0.5"],
      "metadata.test": ["169.254.169.254"],
      "mixed.test": ["8.8.8.8", "192.168.1.1"],
      "mapped.test": ["::ffff:127.0.0.1"],
      "ula.test": ["fd00:ec2::254"],
      "cgnat.test": ["100.64.0.1"],
    };
    const { resolveHost, lookups } = stubs(answers);
    const attempts = blockConnects(/\.test\.?$|^169\.254\./);
    const download = createGuardedUrlDownload({}, { resolveHost });
    for (const host of Object.keys(answers)) {
      await expect(
        fetchOne(download, `http://${host}:${port}/latest/meta-data/`),
        host,
      ).rejects.toThrow(/not a public address/);
    }
    expect(lookups).toEqual(Object.keys(answers));
    expect(attempts).toEqual([]);
  });

  it("downloads from a public address and connects only to the checked address", async () => {
    const seams = stubs({ "public.test": ["127.0.0.1"] });
    const download = createGuardedUrlDownload({}, seams);
    const result = await fetchOne(download, `http://public.test:${port}/img`);
    expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
    expect(result!.mediaType).toBe("image/png");
    expect(seams.lookups).toEqual(["public.test"]);
  });

  it("sends a fixed CopilotKit User-Agent", async () => {
    // Some hosts refuse a request without a User-Agent.
    const download = createGuardedUrlDownload(
      {},
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    const result = await fetchOne(
      download,
      `http://public.test:${port}/user-agent`,
    );
    expect(Buffer.from(result!.data).toString()).toBe(
      `CopilotKit-Runtime/${COPILOTKIT_VERSION}`,
    );
  });

  it("checks every redirect target", async () => {
    const seams = stubs({
      "public.test": ["127.0.0.1"],
      "metadata.test": ["169.254.169.254"],
    });
    const download = createGuardedUrlDownload({}, seams);
    for (const target of [
      `http://metadata.test:${port}/latest/meta-data/`,
      `http://[::1]:${port}/`,
      `http://10.0.0.1:${port}/`,
      `file:///etc/passwd`,
    ]) {
      const url = `http://public.test:${port}/redirect?to=${encodeURIComponent(target)}`;
      await expect(fetchOne(download, url), target).rejects.toThrow(
        /not a public address|Only http and https/,
      );
    }
    // A redirect to a public host is still followed.
    const ok = await fetchOne(
      download,
      `http://public.test:${port}/redirect?to=${encodeURIComponent(`http://public.test:${port}/final`)}`,
    );
    expect(Buffer.from(ok!.data).toString()).toBe("PUBLIC-BYTES");
  });

  it("limits the number of redirects", async () => {
    const seams = stubs({ "public.test": ["127.0.0.1"] });
    const download = createGuardedUrlDownload({ maxRedirects: 0 }, seams);
    const url = `http://public.test:${port}/redirect?to=${encodeURIComponent(`http://public.test:${port}/final`)}`;
    await expect(fetchOne(download, url)).rejects.toThrow(/Too many redirects/);
  });

  it("limits the response size from its Content-Length", async () => {
    const seams = stubs({ "public.test": ["127.0.0.1"] });
    const download = createGuardedUrlDownload({ maxBytes: 1024 }, seams);
    await expect(
      fetchOne(download, `http://public.test:${port}/big`),
    ).rejects.toThrow(/1024-byte limit/);
  });

  it("limits the size of a streamed body without Content-Length", async () => {
    const seams = stubs({ "public.test": ["127.0.0.1"] });
    const download = createGuardedUrlDownload({ maxBytes: 1024 }, seams);
    await expect(
      fetchOne(download, `http://public.test:${port}/chunked`),
    ).rejects.toThrow(/1024-byte limit/);
    // The same body fits a larger limit.
    const ok = createGuardedUrlDownload({ maxBytes: 2048 }, seams);
    const result = await fetchOne(ok, `http://public.test:${port}/chunked`);
    expect(result!.data.byteLength).toBe(2048);
  });

  it("limits the download time and closes the connection", async () => {
    const seams = stubs({ "public.test": ["127.0.0.1"] });
    const download = createGuardedUrlDownload({ timeoutMs: 200 }, seams);
    const closed = closedWithin("/slow-timeout", 2_000);
    await expect(
      fetchOne(download, `http://public.test:${port}/slow-timeout`),
    ).rejects.toThrow(/timed out after 200 ms/);
    expect(await closed).toBe("closed");
  });

  it("accepts only http and https URLs without credentials", async () => {
    const download = createSafeUrlDownload();
    await expect(fetchOne(download, "file:///etc/passwd")).rejects.toThrow(
      /Only http and https/,
    );
    await expect(
      fetchOne(download, "http://user:pass@example.com/"),
    ).rejects.toThrow(/credentials/);
  });

  it("limits downloads to allowedHosts", async () => {
    const seams = stubs({
      "public.test": ["127.0.0.1"],
      "cdn.public.test": ["127.0.0.1"],
    });
    const download = createGuardedUrlDownload(
      { allowedHosts: ["*.public.test"] },
      seams,
    );
    await expect(
      fetchOne(download, `http://public.test:${port}/`),
    ).rejects.toThrow(/allowed hosts/);
    const ok = await fetchOne(download, `http://cdn.public.test:${port}/`);
    expect(Buffer.from(ok!.data).toString()).toBe("PUBLIC-BYTES");
  });

  it.each([
    ["the default downloader", () => createSafeUrlDownload()],
    ["the disabled downloader", () => disabledUrlDownload],
  ])("leaves data: URLs to the AI SDK with %s", async (_label, make) => {
    const results = await make()([
      {
        url: new URL("data:image/png;base64,iVBORw0KGgo="),
        isUrlSupportedByModel: false,
      },
    ]);
    expect(results).toEqual([null]);
  });

  it.each([
    ["the default downloader", () => createSafeUrlDownload()],
    ["the disabled downloader", () => disabledUrlDownload],
  ])(
    "leaves URLs that the model supports to the provider with %s",
    async (_label, make) => {
      const download = make();
      const results = await download([
        { url: new URL("http://127.0.0.1/"), isUrlSupportedByModel: true },
      ]);
      expect(results).toEqual([null]);
    },
  );
});

describe("createSafeUrlDownload options", () => {
  it.each([
    ["timeoutMs", 0],
    ["timeoutMs", -1],
    ["timeoutMs", 1.5],
    ["timeoutMs", 2_147_483_648],
    ["timeoutMs", Number.NaN],
    ["maxBytes", 0],
    ["maxBytes", -1],
    ["maxBytes", Number.POSITIVE_INFINITY],
    ["maxRedirects", -1],
    ["maxRedirects", 0.5],
  ])("rejects %s: %s", (name, value) => {
    expect(() => createSafeUrlDownload({ [name]: value })).toThrow(
      new RegExp(`urlDownload\\.${name} must be`),
    );
  });

  it.each(["allowedhosts", "allowHosts", "maxbytes", "timeout"])(
    "rejects the unknown option %s and lists the valid ones",
    (name) => {
      expect(() =>
        createSafeUrlDownload({
          [name]: ["cdn.example.com"],
        } as unknown as SafeUrlDownloadOptions),
      ).toThrow(
        new RegExp(
          `urlDownload has an unknown option "${name}".*allowedHosts, maxBytes, timeoutMs, maxRedirects, maxDownloads, maxTotalBytes`,
        ),
      );
    },
  );

  it("names a BigInt or Symbol value instead of failing to print it", () => {
    expect(() =>
      resolveUrlDownloadSetting(
        10n as unknown as Parameters<typeof resolveUrlDownloadSetting>[0],
      ),
    ).toThrow(/urlDownload must be .*got 10n/);
    expect(() =>
      resolveUrlDownloadSetting(
        Symbol("x") as unknown as Parameters<
          typeof resolveUrlDownloadSetting
        >[0],
      ),
    ).toThrow(/urlDownload must be .*got Symbol\(x\)/);
    expect(() =>
      createSafeUrlDownload({ allowedHosts: [10n as unknown as string] }),
    ).toThrow(/urlDownload\.allowedHosts entry 10n is invalid/);
    expect(() =>
      createSafeUrlDownload({ maxBytes: 10n as unknown as number }),
    ).toThrow(/urlDownload\.maxBytes must be .*got 10n/);
  });

  it("accepts the boundary values", () => {
    expect(() =>
      createSafeUrlDownload({
        timeoutMs: 2_147_483_647,
        maxBytes: 1,
        maxRedirects: 0,
      }),
    ).not.toThrow();
    expect(() => createSafeUrlDownload({ timeoutMs: 1 })).not.toThrow();
  });
});

describe("createSafeUrlDownload over https", () => {
  const tls = () => ({
    ...stubs({
      "public.test": ["127.0.0.1"],
      "cdn.public.test": ["127.0.0.1"],
    }),
    ca: tlsCa,
  });

  it("downloads over https from the pinned address", async () => {
    const download = createGuardedUrlDownload({}, tls());
    const result = await fetchOne(
      download,
      `https://public.test:${tlsPort}/img`,
    );
    expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
  });

  it("refuses a redirect from https to http", async () => {
    const download = createGuardedUrlDownload({}, tls());
    const before = hits.length;
    const target = `http://public.test:${port}/final`;
    await expect(
      fetchOne(
        download,
        `https://public.test:${tlsPort}/redirect?to=${encodeURIComponent(target)}`,
      ),
    ).rejects.toThrow(/https to http/);
    // Only the https request reached a server.
    expect(hits.slice(before)).toEqual([
      `/redirect?to=${encodeURIComponent(target)}`,
    ]);
  });

  it("follows a redirect from https to https", async () => {
    const download = createGuardedUrlDownload({}, tls());
    const target = `https://cdn.public.test:${tlsPort}/final`;
    const result = await fetchOne(
      download,
      `https://public.test:${tlsPort}/redirect?to=${encodeURIComponent(target)}`,
    );
    expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
  });
});

/** Resolves with "closed" when the /slow request at `path` closes, else "open". */
function closedWithin(path: string, ms: number): Promise<"closed" | "open"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      slowOpened.off("close", onClose);
      resolve("open");
    }, ms);
    const onClose = (closed: string) => {
      if (closed !== path) return;
      clearTimeout(timer);
      slowOpened.off("close", onClose);
      resolve("closed");
    };
    slowOpened.on("close", onClose);
  });
}

describe("createSafeUrlDownload cancellation", () => {
  it("aborts the other downloads in a call when one fails", async () => {
    const opened = once(slowOpened, "open");
    const seams = stubs({ "public.test": ["127.0.0.1"] });
    // `late.test` fails only after the slow download has reached the server.
    const resolveHost = seams.resolveHost!;
    seams.resolveHost = async (hostname) => {
      if (hostname === "late.test") {
        await opened;
        throw new Error("ENOTFOUND late.test");
      }
      return resolveHost(hostname);
    };
    const download = createGuardedUrlDownload({ timeoutMs: 20_000 }, seams);
    const closed = closedWithin("/slow-sibling", 2_000);
    await expect(
      download([
        {
          url: new URL(`http://public.test:${port}/slow-sibling`),
          isUrlSupportedByModel: false,
        },
        { url: new URL("http://late.test/x"), isUrlSupportedByModel: false },
      ]),
    ).rejects.toThrow(/not a public address/);
    expect(await closed).toBe("closed");
  });

  it("aborts a download when the run is aborted", async () => {
    const opened = once(slowOpened, "open");
    const run = new AbortController();
    const download = createGuardedUrlDownload(
      { timeoutMs: 20_000 },
      stubs({ "public.test": ["127.0.0.1"] }),
    ).forRun(run.signal);
    const result = fetchOne(download, `http://public.test:${port}/slow-run`);
    const closed = closedWithin("/slow-run", 2_000);
    await opened;
    run.abort(new Error("run aborted"));
    await expect(result).rejects.toThrow(/run aborted/);
    expect(await closed).toBe("closed");
  });
});

/**
 * Runs `body` and returns the promise rejections that nothing handled while
 * it ran or within `settleMs` after it. Node's default mode
 * (`--unhandled-rejections=throw`) ends the process for any of them.
 */
async function unhandledRejectionsDuring(
  body: () => Promise<void>,
  settleMs = 100,
): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    await body();
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return unhandled;
}

type LookupAnswer = {
  error: Error | null;
  address: string | LookupAddress[];
  family?: number;
};

/** Calls the socket lookup function that the downloader pinned. */
function ask(lookup: LookupFunction, options: unknown): Promise<LookupAnswer> {
  return new Promise((resolve) =>
    (lookup as (...args: unknown[]) => void)(
      "ignored.test",
      options,
      (
        error: Error | null,
        address: string | LookupAddress[],
        family?: number,
      ) => resolve({ error, address, family }),
    ),
  );
}

describe("createSafeUrlDownload pinned lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The lookup function that the download passes to its socket. */
  async function pinnedLookup(answers: string[]): Promise<LookupFunction> {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const attempts: ConnectAttempt[] = [];
    interceptConnects(/^dual\.test$/, (attempt) => attempts.push(attempt));
    const download = createGuardedUrlDownload(
      {},
      stubs({ "dual.test": answers }, answers),
    );
    await expect(fetchOne(download, "http://dual.test:9/")).rejects.toThrow();
    expect(attempts).toHaveLength(1);
    return attempts[0]!.options.lookup as LookupFunction;
  }

  it("answers only with checked addresses of the family asked for", async () => {
    const lookup = await pinnedLookup(["93.184.215.14", "2606:4700::1"]);
    expect(await ask(lookup, { family: 4 })).toEqual({
      error: null,
      address: "93.184.215.14",
      family: 4,
    });
    expect(await ask(lookup, 6)).toEqual({
      error: null,
      address: "2606:4700::1",
      family: 6,
    });
    expect(await ask(lookup, { all: true, family: 6 })).toEqual({
      error: null,
      address: [{ address: "2606:4700::1", family: 6 }],
      family: undefined,
    });
    expect((await ask(lookup, { all: true })).address).toEqual([
      { address: "93.184.215.14", family: 4 },
      { address: "2606:4700::1", family: 6 },
    ]);
  });

  it("fails when no checked address has the family asked for", async () => {
    const lookup = await pinnedLookup(["93.184.215.14"]);
    const answer = await ask(lookup, { family: 6 });
    expect(answer.error?.message).toMatch(/No checked address/);
  });

  it("refuses a resolver answer with an unknown address family", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const attempts = blockConnects(/^odd\.test$/);
    const download = createGuardedUrlDownload(
      {},
      {
        resolveHost: async () => [{ address: "127.0.0.1", family: 0 }],
        isPublicAddress: () => true,
      },
    );
    await expect(
      fetchOne(download, `http://odd.test:${port}/`),
    ).rejects.toThrow(/not a public address/);
    expect(attempts).toEqual([]);
  });
});

describe("createSafeUrlDownload isPublicAddress seam", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits for an async answer, so a Promise never counts as yes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolveHost } = stubs({ "public.test": ["127.0.0.1"] });
    const before = hits.length;
    const refusing = createGuardedUrlDownload(
      {},
      { resolveHost, isPublicAddress: async () => false },
    );
    await expect(
      fetchOne(refusing, `http://public.test:${port}/`),
    ).rejects.toThrow(/not a public address/);
    expect(hits.length).toBe(before);
    const accepting = createGuardedUrlDownload(
      {},
      {
        resolveHost,
        isPublicAddress: async (address) => address === "127.0.0.1",
      },
    );
    const result = await fetchOne(accepting, `http://public.test:${port}/`);
    expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
  });

  it("takes the exported isPublicAddress as the seam", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload(
      {},
      {
        resolveHost: stubs({ "public.test": ["127.0.0.1"] }).resolveHost,
        isPublicAddress,
      },
    );
    await expect(
      fetchOne(download, `http://public.test:${port}/`),
    ).rejects.toThrow(/not a public address/);
  });
});

describe("createSafeUrlDownload with a signal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops a running download when the signal aborts", async () => {
    // 1.1.1.1 is public, so the real policy lets the download connect; the
    // connect is held before any packet is sent, until it is destroyed.
    const attempts: ConnectAttempt[] = [];
    interceptConnects(/^1\.1\.1\.1$/, (attempt) => attempts.push(attempt), {
      hang: true,
    });
    const run = new AbortController();
    const download = createSafeUrlDownload({
      timeoutMs: 20_000,
      signal: run.signal,
    });
    const result = fetchOne(download, "http://1.1.1.1:9/x");
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    const closed = new Promise((resolve) =>
      attempts[0]!.socket.once("close", resolve),
    );
    run.abort(new Error("factory run aborted"));
    await expect(result).rejects.toThrow(/factory run aborted/);
    await closed;
    expect(attempts[0]!.socket.destroyed).toBe(true);
  });

  it("rejects a signal that is not an AbortSignal", () => {
    expect(() =>
      createSafeUrlDownload({
        signal: "abort" as unknown as AbortSignal,
      }),
    ).toThrow(/urlDownload signal must be an AbortSignal/);
  });
});

describe("createSafeUrlDownload after an abort", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts no DNS lookup for an already-aborted run", async () => {
    const lookups: string[] = [];
    const run = new AbortController();
    run.abort(new Error("run aborted"));
    const download = createGuardedUrlDownload(
      {},
      {
        resolveHost: async (hostname) => {
          lookups.push(hostname);
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error(`ENOTFOUND ${hostname}`);
        },
      },
    ).forRun(run.signal);
    const unhandled = await unhandledRejectionsDuring(async () => {
      await expect(
        fetchOne(download, "http://no-such-host.invalid/x"),
      ).rejects.toThrow(/run aborted/);
    });
    expect(unhandled).toEqual([]);
    expect(lookups).toEqual([]);
  });

  it("leaves no unhandled rejection when the run aborts as the lookup starts", async () => {
    const run = new AbortController();
    const download = createGuardedUrlDownload(
      {},
      {
        // The abort lands after the lookup started and before the
        // downloader waits for it; the lookup then fails.
        resolveHost: (hostname) => {
          run.abort(new Error("aborted during lookup"));
          return new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error(`ENOTFOUND ${hostname}`)), 10),
          );
        },
      },
    ).forRun(run.signal);
    const unhandled = await unhandledRejectionsDuring(async () => {
      await expect(
        fetchOne(download, "http://no-such-host.invalid/x"),
      ).rejects.toThrow(/aborted during lookup/);
    });
    expect(unhandled).toEqual([]);
  });

  it("leaves no unhandled rejection for an unresolvable host through real DNS", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = new AbortController();
    // Settles with the outcome of each real lookup. It is a separate promise,
    // so that only the downloader handles the lookup's rejection.
    const outcomes: Array<Promise<unknown>> = [];
    const download = createGuardedUrlDownload(
      {},
      {
        // A real DNS lookup of a name that cannot resolve. The run aborts
        // after the lookup started and before the downloader waits for it.
        resolveHost: (hostname) => {
          let settled!: (outcome: unknown) => void;
          outcomes.push(new Promise((resolve) => (settled = resolve)));
          const lookup = new Promise<LookupAddress[]>((resolve, reject) => {
            realLookup(hostname, { all: true, verbatim: true }).then(
              (answer) => {
                resolve(answer);
                settled(answer);
              },
              (error: unknown) => {
                reject(error);
                settled(error);
              },
            );
          });
          run.abort(new Error("run aborted during a real lookup"));
          return lookup;
        },
      },
    ).forRun(run.signal);
    const unhandled = await unhandledRejectionsDuring(async () => {
      await expect(
        fetchOne(download, "http://no-such-host.invalid/x"),
      ).rejects.toThrow(/run aborted during a real lookup/);
      // The real lookup was started, and it failed after the abort.
      expect(outcomes).toHaveLength(1);
      expect(await outcomes[0]).toMatchObject({
        code: expect.stringMatching(/^(ENOTFOUND|EAI_NONAME|EAI_AGAIN)$/),
      });
    }, 1_000);
    expect(unhandled).toEqual([]);
  });
});

function requestsFor(...urls: string[]) {
  return urls.map((url) => ({
    url: new URL(url),
    isUrlSupportedByModel: false,
  }));
}

describe("createSafeUrlDownload per-call limits", () => {
  it("downloads a URL that appears twice in one call only once", async () => {
    const download = createGuardedUrlDownload(
      {},
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    const before = hits.length;
    const url = `http://public.test:${port}/twice`;
    const results = await download(requestsFor(url, url));
    expect(hits.slice(before)).toEqual(["/twice"]);
    expect(results.map((r) => Buffer.from(r!.data).toString())).toEqual([
      "PUBLIC-BYTES",
      "PUBLIC-BYTES",
    ]);
  });

  it("refuses a call with more distinct URLs than maxDownloads", async () => {
    const download = createGuardedUrlDownload(
      { maxDownloads: 2 },
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    const before = hits.length;
    const base = `http://public.test:${port}`;
    await expect(
      download(requestsFor(`${base}/a`, `${base}/b`, `${base}/c`)),
    ).rejects.toThrow(/at most 2 URL downloads/);
    expect(hits.length).toBe(before);
    // Duplicates count once.
    await expect(
      download(requestsFor(`${base}/a`, `${base}/b`, `${base}/a`)),
    ).resolves.toHaveLength(3);
  });

  it("refuses a download whose declared size exceeds maxTotalBytes before reading it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload(
      { maxTotalBytes: 1000, timeoutMs: 2_000 },
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    await expect(
      fetchOne(download, `http://public.test:${port}/declared-hang`),
    ).rejects.toThrow(/1000-byte total limit/);
  });

  it("refuses a streamed body without Content-Length that exceeds maxTotalBytes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload(
      { maxTotalBytes: 1000 },
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    await expect(
      fetchOne(download, `http://public.test:${port}/chunked`),
    ).rejects.toThrow(/1000-byte total limit/);
  });

  it("refuses a call whose downloads exceed maxTotalBytes", async () => {
    const download = createGuardedUrlDownload(
      { maxTotalBytes: 3000 },
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    const base = `http://public.test:${port}`;
    await expect(
      download(requestsFor(`${base}/big-1`, `${base}/big-2`)),
    ).rejects.toThrow(/3000-byte total limit/);
    await expect(download(requestsFor(`${base}/big-1`))).resolves.toHaveLength(
      1,
    );
  });

  it.each([
    ["maxDownloads", 0],
    ["maxDownloads", 1.5],
    ["maxTotalBytes", 0],
    ["maxTotalBytes", -5],
  ])("rejects %s: %s", (name, value) => {
    expect(() => createSafeUrlDownload({ [name]: value })).toThrow(
      new RegExp(`urlDownload\\.${name} must be`),
    );
  });
});

describe("allowedHosts entries", () => {
  const seams = () =>
    stubs({
      "cdn.public.test": ["127.0.0.1"],
      "cdn.public.test.": ["127.0.0.1"],
      "evilpublic.test": ["127.0.0.1"],
      "xn--bcher-kva.public.test": ["127.0.0.1"],
    });

  it("match case-insensitively and ignore a trailing dot on either side", async () => {
    for (const entry of ["CDN.Public.Test.", "cdn.public.test"]) {
      const download = createGuardedUrlDownload(
        { allowedHosts: [entry] },
        seams(),
      );
      for (const host of ["cdn.public.test", "cdn.public.test."]) {
        const result = await fetchOne(download, `http://${host}:${port}/`);
        expect(Buffer.from(result!.data).toString(), `${entry} ${host}`).toBe(
          "PUBLIC-BYTES",
        );
      }
    }
  });

  it("match an internationalized name in Unicode or punycode", async () => {
    for (const entry of ["bücher.public.test", "*.public.test"]) {
      const download = createGuardedUrlDownload(
        { allowedHosts: [entry] },
        seams(),
      );
      const result = await fetchOne(
        download,
        `http://bücher.public.test:${port}/`,
      );
      expect(Buffer.from(result!.data).toString(), entry).toBe("PUBLIC-BYTES");
    }
  });

  it("match an IPv6 literal with or without brackets", async (ctx) => {
    if (v6Port === undefined) ctx.skip("this host has no IPv6 loopback");
    for (const entry of ["::1", "[::1]", "[0:0:0:0:0:0:0:1]"]) {
      const download = createGuardedUrlDownload(
        { allowedHosts: [entry] },
        { isPublicAddress: (address) => address === "::1" },
      );
      const result = await fetchOne(download, `http://[::1]:${v6Port}/`);
      expect(Buffer.from(result!.data).toString(), entry).toBe("PUBLIC-BYTES");
    }
  });

  it("refuse every download when the list is empty", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload({ allowedHosts: [] }, seams());
    const before = hits.length;
    await expect(
      fetchOne(download, `http://cdn.public.test:${port}/`),
    ).rejects.toThrow(/allowed hosts/);
    expect(hits.length).toBe(before);
  });

  it("treat *.suffix as subdomains only", async () => {
    const download = createGuardedUrlDownload(
      { allowedHosts: ["*.public.test"] },
      seams(),
    );
    await expect(
      fetchOne(download, `http://evilpublic.test:${port}/`),
    ).rejects.toThrow(/allowed hosts/);
  });

  it.each([
    "https://cdn.example.com",
    "cdn.example.com:443",
    "cdn.example.com/images",
    "user@cdn.example.com",
    "[::1]:443",
    "*",
    "*.",
    "cdn.*.example.com",
    "",
    " cdn.example.com",
  ])("reject the entry %j when the downloader is created", (entry) => {
    expect(() => createSafeUrlDownload({ allowedHosts: [entry] })).toThrow(
      /urlDownload\.allowedHosts/,
    );
  });

  it.each([
    "cdn.example.com:443",
    "cdn.example.com:",
    "1.2.3.4:80",
    "[::1]:443",
  ])("reject the entry %j as naming a port", (entry) => {
    expect(() => createSafeUrlDownload({ allowedHosts: [entry] })).toThrow(
      /urlDownload\.allowedHosts .*without a port/,
    );
  });

  it.each(["*.1.2.3.4", "*.0.1", "*.::1", "*.[::1]", "*.[2001:db8::1]"])(
    "reject the wildcard entry %j over an IP address",
    (entry) => {
      expect(() => createSafeUrlDownload({ allowedHosts: [entry] })).toThrow(
        /urlDownload\.allowedHosts .*wildcard needs a hostname suffix/,
      );
    },
  );

  it("still accept IP literals without a wildcard", () => {
    for (const entry of ["1.2.3.4", "::1", "[2001:db8::1]"]) {
      expect(
        () => createSafeUrlDownload({ allowedHosts: [entry] }),
        entry,
      ).not.toThrow();
    }
  });

  it("must be an array", () => {
    expect(() =>
      createSafeUrlDownload({
        allowedHosts: "cdn.example.com" as unknown as string[],
      }),
    ).toThrow(/urlDownload\.allowedHosts/);
  });
});

describe("createSafeUrlDownload diagnostics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const refusal = (
    download: ReturnType<typeof createSafeUrlDownload>,
    url: string,
  ) =>
    fetchOne(download, url).then(
      () => {
        throw new Error(`${url} was downloaded`);
      },
      (error: unknown) => error as Error,
    );

  it("gives one message without a cause for unresolvable and non-public hosts, and logs the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload(
      {},
      stubs({ "private.test": ["10.0.0.5"] }),
    );
    const unresolvable = await refusal(download, "http://missing.test/x");
    const nonPublic = await refusal(download, "http://private.test/x");
    expect(unresolvable.message).toBe(nonPublic.message);
    expect(unresolvable.message).toMatch(/not a public address/);
    expect(unresolvable.cause).toBeUndefined();
    expect(nonPublic.cause).toBeUndefined();
    const logged = warn.mock.calls.map((call) => call.join(" "));
    expect(logged.some((line) => /missing\.test.*ENOTFOUND/.test(line))).toBe(
      true,
    );
    expect(logged.some((line) => /private\.test.*10\.0\.0\.5/.test(line))).toBe(
      true,
    );
    expect(logged.every((line) => line.startsWith("[BuiltInAgent]"))).toBe(
      true,
    );
  });

  it("logs an invalid redirect Location", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload(
      {},
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    const error = await refusal(
      download,
      `http://public.test:${port}/bad-location`,
    );
    expect(error.message).toMatch(/invalid URL/);
    const logged = warn.mock.calls.map((call) => call.join(" "));
    expect(logged.some((line) => line.includes("http://[bad-location"))).toBe(
      true,
    );
  });

  it("logs a module-load failure and tries again on the next download", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const restoreDns = stubBuiltinModule("node:dns/promises", () => {
      throw new Error("simulated module load failure");
    });
    const fresh = await import("../url-download");
    try {
      const download = fresh.createGuardedUrlDownload(
        {},
        stubs({ "public.test": ["127.0.0.1"] }),
      );
      const error = await refusal(download, `http://public.test:${port}/`);
      expect(error.message).toMatch(/networking modules/);
      const logged = warn.mock.calls.map((call) => call.join(" "));
      expect(
        logged.some((line) => line.includes("simulated module load failure")),
      ).toBe(true);
      // The log says how to fix it on a runtime without these modules.
      expect(
        logged.some((line) =>
          line.includes(
            `set urlDownload to "disabled" or to your own download function`,
          ),
        ),
      ).toBe(true);
      restoreDns();
      const result = await fetchOne(download, `http://public.test:${port}/`);
      expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
    } finally {
      restoreDns();
      vi.resetModules();
    }
  });
});

describe("createSafeUrlDownload request handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps its error listener on the request after the first error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Record the error listeners that the downloader itself adds.
    const added: Array<{ request: http.ClientRequest; listener: unknown }> = [];
    for (const method of ["on", "once"] as const) {
      const original = http.ClientRequest.prototype[method];
      vi.spyOn(http.ClientRequest.prototype, method).mockImplementation(
        function (this: http.ClientRequest, event, listener) {
          if (
            event === "error" &&
            /url-download\.ts/.test(new Error().stack ?? "")
          ) {
            added.push({ request: this, listener });
          }
          return original.call(this, event, listener);
        },
      );
    }
    const closed = http.createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, "127.0.0.1", resolve),
    );
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    const download = createGuardedUrlDownload(
      {},
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    await expect(
      fetchOne(download, `http://public.test:${closedPort}/`),
    ).rejects.toThrow("The download failed.");
    expect(added.length).toBeGreaterThan(0);
    // A later error on the same request must still reach the downloader's
    // handler rather than depend on other listeners.
    for (const { request, listener } of added) {
      expect(request.listeners("error")).toContain(listener);
    }
  });

  it("names the redirect hop that timed out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const download = createGuardedUrlDownload(
      { timeoutMs: 300 },
      stubs({
        "public.test": ["127.0.0.1"],
        "cdn.public.test": ["127.0.0.1"],
      }),
    );
    const hop = `http://cdn.public.test:${port}/slow-hop`;
    const error = await fetchOne(
      download,
      `http://public.test:${port}/redirect?to=${encodeURIComponent(hop)}`,
    ).then(
      () => undefined,
      (e: unknown) => e as { url?: string; message: string },
    );
    expect(error?.message).toMatch(/timed out/);
    expect(error?.url).toBe(hop);
  });

  it("sends the TLS server name without a trailing dot", async () => {
    const download = createGuardedUrlDownload(
      {},
      {
        ...stubs({ "public.test.": ["127.0.0.1"] }),
        ca: tlsCa,
      },
    );
    const servernames: Array<string | false> = [];
    const onSecure = (socket: { servername?: string | false }) => {
      servernames.push(socket.servername ?? false);
    };
    tlsServer.on("secureConnection", onSecure);
    try {
      const result = await fetchOne(
        download,
        `https://public.test.:${tlsPort}/img`,
      );
      expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
      expect(servernames).toEqual(["public.test"]);
    } finally {
      tlsServer.off("secureConnection", onSecure);
    }
  });
});

describe("createSafeUrlDownload responses", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const download = () =>
    createGuardedUrlDownload(
      {},
      stubs({
        "public.test": ["127.0.0.1"],
        "cdn.public.test": ["127.0.0.1"],
      }),
    );

  it("checks allowedHosts on every redirect target", async () => {
    const guarded = createGuardedUrlDownload(
      { allowedHosts: ["cdn.public.test"] },
      stubs({
        "public.test": ["127.0.0.1"],
        "cdn.public.test": ["127.0.0.1"],
      }),
    );
    const before = hits.length;
    const target = `http://public.test:${port}/final`;
    await expect(
      fetchOne(
        guarded,
        `http://cdn.public.test:${port}/redirect?to=${encodeURIComponent(target)}`,
      ),
    ).rejects.toThrow(/allowed hosts/);
    expect(hits.slice(before)).toEqual([
      `/redirect?to=${encodeURIComponent(target)}`,
    ]);
  });

  it("follows exactly maxRedirects redirects", async () => {
    const guarded = createGuardedUrlDownload(
      { maxRedirects: 2 },
      stubs({ "public.test": ["127.0.0.1"] }),
    );
    const base = `http://public.test:${port}`;
    const twice = `${base}/redirect?to=${encodeURIComponent(
      `${base}/redirect?to=${encodeURIComponent(`${base}/final`)}`,
    )}`;
    const result = await fetchOne(guarded, twice);
    expect(Buffer.from(result!.data).toString()).toBe("PUBLIC-BYTES");
    const thrice = `${base}/redirect?to=${encodeURIComponent(twice)}`;
    await expect(fetchOne(guarded, thrice)).rejects.toThrow(
      /Too many redirects/,
    );
  });

  it("reports a non-2xx status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchOne(download(), `http://public.test:${port}/not-found`),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keeps the query and the raw network error out of the error, and logs them without the query", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const closed = http.createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, "127.0.0.1", resolve),
    );
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    // The redirect target is chosen by the remote server, with a query.
    const target = `http://public.test:${closedPort}/x?sig=SECRET-SIG`;
    const error = await fetchOne(
      download(),
      `http://public.test:${port}/redirect?to=${encodeURIComponent(target)}`,
    ).then(
      () => undefined,
      (e: unknown) => e as { url?: string; message: string },
    );
    expect(error?.message).toBe("The download failed.");
    expect(error?.url).toBe(`http://public.test:${closedPort}/x`);
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).not.toContain("SECRET-SIG");
  });

  it("keeps the query out of a non-2xx status error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = await fetchOne(
      download(),
      `http://public.test:${port}/not-found?sig=SECRET-SIG`,
    ).then(
      () => undefined,
      (e: unknown) => e as { url?: string; message: string },
    );
    expect(error?.message).toBe("The server answered with HTTP status 404.");
    expect(JSON.stringify(error)).not.toContain("SECRET-SIG");
    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("404");
    expect(logged).not.toContain("SECRET-SIG");
  });

  it("refuses a redirect without a Location", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchOne(download(), `http://public.test:${port}/no-location`),
    ).rejects.toThrow(/without a location/);
  });

  it("refuses a compressed response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchOne(download(), `http://public.test:${port}/gzip`),
    ).rejects.toThrow(/Compressed responses/);
  });

  it("refuses a protocol upgrade", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fetchOne(download(), `http://public.test:${port}/upgrade`),
    ).rejects.toThrow(/upgrade refused/);
  });

  it("refuses an unresolvable host with the same message, and times out a hanging DNS lookup", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(fetchOne(download(), "http://missing.test/")).rejects.toThrow(
      /not a public address/,
    );
    const hanging = createGuardedUrlDownload(
      { timeoutMs: 200 },
      { resolveHost: () => new Promise(() => {}) },
    );
    await expect(fetchOne(hanging, "http://hang.test/")).rejects.toThrow(
      /timed out/,
    );
  });

  it("downloads from a public IPv6 address, as a literal and from DNS", async (ctx) => {
    if (v6Port === undefined) ctx.skip("this host has no IPv6 loopback");
    // ::1 stands in for a public IPv6 address.
    const v6 = createGuardedUrlDownload(
      {},
      {
        ...stubs({ "v6.public.test": ["::1"] }),
        isPublicAddress: (address) => address === "::1",
      },
    );
    for (const url of [
      `http://[::1]:${v6Port}/v6`,
      `http://v6.public.test:${v6Port}/v6`,
    ]) {
      const result = await fetchOne(v6, url);
      expect(Buffer.from(result!.data).toString(), url).toBe("PUBLIC-BYTES");
    }
  });
});
