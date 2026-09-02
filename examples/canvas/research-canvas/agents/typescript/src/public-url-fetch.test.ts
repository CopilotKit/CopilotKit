import { expect, test } from "vitest";
import { fetchPublicText } from "./public-url-fetch";
import type {
  PublicHttpResponse,
  PublicUrlFetchDependencies,
  ResolvedAddress,
} from "./public-url-fetch";

const PUBLIC_IPV4 = { address: "93.184.216.34", family: 4 } as const;
const PUBLIC_IPV6 = {
  address: "2606:2800:220:1:248:1893:25c8:1946",
  family: 6,
} as const;
const OK_RESPONSE = {
  statusCode: 200,
  statusMessage: "OK",
  body: "public body",
} as const;

interface FetchHarnessOptions {
  addresses?: readonly ResolvedAddress[];
  responses?: readonly PublicHttpResponse[];
}

function createFetchHarness(options: FetchHarnessOptions = {}) {
  const addresses = options.addresses ?? [PUBLIC_IPV4];
  const responses = [...(options.responses ?? [OK_RESPONSE])];
  const requestedUrls: string[] = [];
  const resolvedHostnames: string[] = [];

  const dependencies: PublicUrlFetchDependencies = {
    resolveHostname: async (hostname) => {
      resolvedHostnames.push(hostname);
      return addresses;
    },
    requestUrl: async (url) => {
      requestedUrls.push(url.href);
      const response = responses.shift();
      if (!response) {
        throw new Error("No test response configured");
      }
      return response;
    },
  };

  return { dependencies, requestedUrls, resolvedHostnames };
}

const BLOCKED_URLS = [
  ["non-HTTP scheme", "file:///etc/passwd"],
  ["URL credentials", "https://admin:password@example.com/private"],
  ["localhost hostname", "http://localhost/admin"],
  ["localhost subdomain", "http://api.localhost/admin"],
  ["metadata hostname", "http://metadata.google.internal/computeMetadata/v1"],
  ["IPv4 unspecified address", "http://0.0.0.0/"],
  ["IPv4 private address", "http://10.0.0.1/"],
  ["IPv4 loopback address", "http://127.0.0.1/"],
  ["non-canonical IPv4 loopback address", "http://2130706433/"],
  ["IPv4 link-local address", "http://169.254.169.254/latest/meta-data"],
  ["IPv4 multicast address", "http://224.0.0.1/"],
  ["IPv4 reserved address", "http://192.0.2.1/"],
  ["IPv6 unspecified address", "http://[::]/"],
  ["IPv6 loopback address", "http://[::1]/"],
  ["IPv6 private address", "http://[fc00::1]/"],
  ["IPv6 link-local address", "http://[fe80::1]/"],
  ["IPv6 multicast address", "http://[ff02::1]/"],
  ["IPv6 reserved address", "http://[2001:db8::1]/"],
  ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/"],
] as const;

test.each(BLOCKED_URLS)("blocks %s", async (_name, url) => {
  const { dependencies, requestedUrls } = createFetchHarness();

  await expect(
    fetchPublicText(url, AbortSignal.timeout(1_000), dependencies),
  ).rejects.toThrow();
  expect(requestedUrls).toHaveLength(0);
});

test.each([
  ["IPv4", { address: "192.168.1.5", family: 4 }],
  ["IPv6", { address: "fd00::5", family: 6 }],
] as const)(
  "blocks a hostname when any resolved %s address is not public",
  async (_family, blockedAddress) => {
    const { dependencies, requestedUrls } = createFetchHarness({
      addresses: [PUBLIC_IPV4, blockedAddress],
    });

    await expect(
      fetchPublicText(
        "https://mixed.example/resource",
        AbortSignal.timeout(1_000),
        dependencies,
      ),
    ).rejects.toThrow("non-public address");
    expect(requestedUrls).toHaveLength(0);
  },
);

test.each([
  "http://127.0.0.1/admin",
  "http://localhost/admin",
  "http://[::1]/admin",
])("blocks a redirect to %s before the next request", async (location) => {
  const { dependencies, requestedUrls } = createFetchHarness({
    responses: [
      {
        statusCode: 302,
        statusMessage: "Found",
        location,
        body: "",
      },
    ],
  });

  await expect(
    fetchPublicText(
      "https://public.example/start",
      AbortSignal.timeout(1_000),
      dependencies,
    ),
  ).rejects.toThrow();
  expect(requestedUrls).toEqual(["https://public.example/start"]);
});

test.each([
  ["public hostname", "https://example.com/article", [PUBLIC_IPV4]],
  ["public IPv4 literal", "http://93.184.216.34/article", [PUBLIC_IPV4]],
  [
    "public IPv6 literal",
    "https://[2606:2800:220:1:248:1893:25c8:1946]/article",
    [PUBLIC_IPV6],
  ],
] as const)("allows a %s", async (_name, url, addresses) => {
  const { dependencies, requestedUrls } = createFetchHarness({ addresses });

  await expect(
    fetchPublicText(url, AbortSignal.timeout(1_000), dependencies),
  ).resolves.toBe("public body");
  expect(requestedUrls).toEqual([url]);
});

test("follows a relative redirect after validating its destination", async () => {
  const { dependencies, requestedUrls } = createFetchHarness({
    responses: [
      {
        statusCode: 301,
        statusMessage: "Moved Permanently",
        location: "/final",
        body: "",
      },
      OK_RESPONSE,
    ],
  });

  await expect(
    fetchPublicText(
      "https://public.example/start",
      AbortSignal.timeout(1_000),
      dependencies,
    ),
  ).resolves.toBe("public body");
  expect(requestedUrls).toEqual([
    "https://public.example/start",
    "https://public.example/final",
  ]);
});

test("fails closed when DNS returns no addresses", async () => {
  const { dependencies, requestedUrls } = createFetchHarness({ addresses: [] });

  await expect(
    fetchPublicText(
      "https://empty-dns.example/article",
      AbortSignal.timeout(1_000),
      dependencies,
    ),
  ).rejects.toThrow("did not resolve");
  expect(requestedUrls).toHaveLength(0);
});

test("rejects a redirect without a location", async () => {
  const { dependencies } = createFetchHarness({
    responses: [
      { statusCode: 302, statusMessage: "Found", body: "redirect body" },
    ],
  });

  await expect(
    fetchPublicText(
      "https://public.example/start",
      AbortSignal.timeout(1_000),
      dependencies,
    ),
  ).rejects.toThrow("without a location");
});

test("rejects more than five redirects", async () => {
  const redirectResponse = {
    statusCode: 302,
    statusMessage: "Found",
    location: "/again",
    body: "",
  } as const;
  const { dependencies, requestedUrls } = createFetchHarness({
    responses: Array.from({ length: 6 }, () => redirectResponse),
  });

  await expect(
    fetchPublicText(
      "https://public.example/start",
      AbortSignal.timeout(1_000),
      dependencies,
    ),
  ).rejects.toThrow("Too many redirects");
  expect(requestedUrls).toHaveLength(6);
});

test("rejects an unsuccessful response", async () => {
  const { dependencies } = createFetchHarness({
    responses: [
      { statusCode: 503, statusMessage: "Service Unavailable", body: "" },
    ],
  });

  await expect(
    fetchPublicText(
      "https://public.example/start",
      AbortSignal.timeout(1_000),
      dependencies,
    ),
  ).rejects.toThrow("Service Unavailable");
});
