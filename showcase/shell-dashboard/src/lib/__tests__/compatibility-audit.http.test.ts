// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveHttpClient } from "../../../scripts/compatibility-audit/http";

const url = "https://registry.npmjs.org/@scope%2Fexample";
const observedAt = "2026-09-30T15:00:00.000Z";
const clock = () => new Date(observedAt);

afterEach(() => {
  vi.useRealTimers();
});

describe("live audit HTTP capture", () => {
  it("returns only public response facts while preserving the response text", async () => {
    const body = '{ "versions": { "1.0.0": {} } }\n';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "set-cookie": "private-response-cookie",
          "x-private-header": "private-response-metadata",
        },
      }),
    );

    const result = await createLiveHttpClient({ fetch, clock }).get(url);

    expect(result).toEqual({ url, status: 200, observedAt, body });
    expect(fetch).toHaveBeenCalledOnce();
    const [, options] = fetch.mock.calls[0];
    expect(options).toMatchObject({
      redirect: "manual",
      credentials: "omit",
      headers: { accept: "application/json" },
    });
    expect(JSON.stringify(result)).not.toContain("private-response");
  });

  it.each([
    "https://pypi.org/simple/example/",
    "https://api.nuget.org/v3/index.json",
    "https://repo1.maven.org/maven2/example/maven-metadata.xml",
    "https://repo.maven.apache.org/maven2/example/maven-metadata.xml",
    "https://search.maven.org/solrsearch/select?q=g%3A%22example%22&core=gav",
    "https://central.sonatype.com/solrsearch/select?q=g%3A%22example%22&core=gav",
  ])("accepts the official metadata origin for %s", async (requestUrl) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response("{}", { headers: { "content-type": "application/json" } }),
      );
    expect(
      await createLiveHttpClient({ fetch, clock }).get(requestUrl),
    ).toEqual({ url: requestUrl, status: 200, observedAt, body: "{}" });
  });

  it.each([
    "http://registry.npmjs.org/example",
    "https://private-user:private-password@registry.npmjs.org/example",
    "https://registry.npmjs.org.evil.example/example",
    "https://central.sonatype.com.evil.example/solrsearch/select",
    "https://registry.npmjs.org:8443/example",
    "https://registry.npmjs.org/example#private-fragment",
    " https://registry.npmjs.org/example",
    "not-a-url-private-token",
  ])(
    "rejects an unsafe request before contacting any origin",
    async (requestUrl) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      await expect(
        createLiveHttpClient({ fetch, clock }).get(requestUrl),
      ).rejects.toThrow(/Registry URL is not allowed/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([404, 429, 500])(
    "rejects HTTP %i without exposing the response body",
    async (status) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response("private-error-body", { status }));
      const error = await createLiveHttpClient({ fetch, clock })
        .get(url)
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        `Registry request returned HTTP ${status}.`,
      );
      expect(String(error)).not.toContain("private-error-body");
    },
  );

  it("validates and follows an allowed relative redirect without changing the evidence key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/canonical-example" },
        }),
      )
      .mockResolvedValueOnce(new Response('{"name":"example"}'));

    const result = await createLiveHttpClient({ fetch, clock }).get(url);

    expect(fetch.mock.calls.map(([requestUrl]) => String(requestUrl))).toEqual([
      url,
      "https://registry.npmjs.org/canonical-example",
    ]);
    expect(result).toEqual({
      url,
      status: 200,
      observedAt,
      body: '{"name":"example"}',
    });
  });

  it.each([
    "https://untrusted.example/collect?secret=private-token",
    "http://registry.npmjs.org/insecure",
    "https://private-user:private-password@pypi.org/simple/example/",
    "/redirected#private-fragment",
  ])("rejects an unsafe redirect before following it", async (location) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(null, { status: 307, headers: { location } }),
      );
    const error = await createLiveHttpClient({ fetch, clock })
      .get(url)
      .catch((value: unknown) => value);
    expect(String(error)).toMatch(/Registry redirect is not allowed/);
    expect(String(error)).not.toContain("private-");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("bounds redirect chains and detects loops", async () => {
    let redirect = 0;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `/hop-${++redirect}` },
        }),
    );
    await expect(
      createLiveHttpClient({ fetch, clock }).get(url),
    ).rejects.toThrow(/Registry redirect limit exceeded/);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(6);

    fetch
      .mockReset()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: url } }),
      );
    await expect(
      createLiveHttpClient({ fetch, clock }).get(url),
    ).rejects.toThrow(/Registry redirect loop/);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a transport that followed a redirect outside the boundary", async () => {
    const response = new Response("{}");
    Object.defineProperty(response, "redirected", { value: true });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    await expect(
      createLiveHttpClient({ fetch, clock }).get(url),
    ).rejects.toThrow(/Registry transport followed an unchecked redirect/);
  });

  it("rejects an advertised oversized body without reading it", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(stream, { headers: { "content-length": "1000" } }),
      );
    await expect(
      createLiveHttpClient({ fetch, clock, maxBodyBytes: 8 }).get(url),
    ).rejects.toThrow(/Registry response exceeds the byte limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces the streamed byte limit even when Content-Length understates it", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("1234"));
        controller.enqueue(new TextEncoder().encode("56789"));
      },
      cancel,
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(stream, { headers: { "content-length": "1" } }),
      );
    await expect(
      createLiveHttpClient({ fetch, clock, maxBodyBytes: 8 }).get(url),
    ).rejects.toThrow(/Registry response exceeds the byte limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("decodes split UTF-8 chunks without counting characters as bytes", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xce]));
        controller.enqueue(new Uint8Array([0xbb, 0x61]));
        controller.close();
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(stream));
    expect(
      (await createLiveHttpClient({ fetch, clock, maxBodyBytes: 3 }).get(url))
        .body,
    ).toBe("λa");

    fetch.mockResolvedValue(new Response("λa"));
    await expect(
      createLiveHttpClient({ fetch, clock, maxBodyBytes: 2 }).get(url),
    ).rejects.toThrow(/Registry response exceeds the byte limit/);
  });

  it("times out a transport that never resolves and aborts its request", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => new Promise<Response>(() => {}));
    const capture = createLiveHttpClient({ fetch, clock }).get(url);
    const assertion = expect(capture).rejects.toThrow(
      /Registry request timed out/,
    );

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("keeps the deadline active while the response body stalls", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
      cancel,
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(stream));
    const capture = createLiveHttpClient({ fetch, clock }).get(url);
    const assertion = expect(capture).rejects.toThrow(
      /Registry request timed out/,
    );

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("sanitizes arbitrary transport errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(
        new Error(
          "connection failed using Authorization: Bearer private-token",
        ),
      );
    const error = await createLiveHttpClient({ fetch, clock })
      .get(url)
      .catch((value: unknown) => value);
    expect((error as Error).message).toBe("Registry request failed.");
    expect(String(error)).not.toContain("private-token");
    expect((error as Error).cause).toBeUndefined();
  });

  it("rejects nontext metadata and invalid UTF-8", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("<html>upstream error</html>", {
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      createLiveHttpClient({ fetch, clock }).get(url),
    ).rejects.toThrow(/Registry response has an unsupported content type/);

    fetch.mockResolvedValue(new Response(new Uint8Array([0xff])));
    await expect(
      createLiveHttpClient({ fetch, clock }).get(url),
    ).rejects.toThrow(/Registry response is not valid UTF-8/);
  });

  it("accepts XML and vendor JSON metadata with the requested Accept header", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response("{}", {
        headers: {
          "content-type": "application/vnd.pypi.simple.v1+json; charset=UTF-8",
        },
      }),
    );
    const client = createLiveHttpClient({ fetch, clock });
    await client.get(
      "https://pypi.org/simple/example/",
      "application/vnd.pypi.simple.v1+json",
    );
    expect(fetch.mock.calls[0][1]?.headers).toEqual({
      accept: "application/vnd.pypi.simple.v1+json",
    });

    fetch.mockResolvedValue(
      new Response("<metadata/>", {
        headers: { "content-type": "application/xml" },
      }),
    );
    expect(
      (
        await client.get(
          "https://repo1.maven.org/maven2/example/maven-metadata.xml",
          "application/xml",
        )
      ).body,
    ).toBe("<metadata/>");
  });

  it("rejects invalid limits, clocks, and header injection", async () => {
    expect(() => createLiveHttpClient({ timeoutMs: 0 })).toThrow(/timeout/);
    expect(() => createLiveHttpClient({ timeoutMs: 20_001 })).toThrow(
      /timeout/,
    );
    expect(() => createLiveHttpClient({ maxBodyBytes: Infinity })).toThrow(
      /byte limit/,
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("{}"));
    await expect(
      createLiveHttpClient({ fetch, clock }).get(
        url,
        "application/json\r\nAuthorization: private-token",
      ),
    ).rejects.toThrow(/Accept header/);
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      createLiveHttpClient({ fetch, clock: () => new Date(NaN) }).get(url),
    ).rejects.toThrow(/observation time/);
  });
});
