import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { request as requestHttps } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOSTNAME_SUFFIXES = ["internal", "local", "localhost"];
const BLOCKED_HOSTNAMES = new Set([
  "metadata",
  "metadata.google",
  "metadata.google.internal",
]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PublicHttpResponse {
  statusCode: number;
  statusMessage: string;
  location?: string;
  body: string;
}

export interface PublicUrlFetchDependencies {
  resolveHostname: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  requestUrl: (
    url: URL,
    address: ResolvedAddress,
    signal: AbortSignal,
  ) => Promise<PublicHttpResponse>;
}

/** Creates the denylist for addresses that are not public Internet targets. */
function createBlockedAddressList(): BlockList {
  const blockedAddresses = new BlockList();

  blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
  blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
  blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
  blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
  blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
  blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
  blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
  blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4");
  blockedAddresses.addSubnet("192.88.99.0", 24, "ipv4");
  blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
  blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
  blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4");
  blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4");
  blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
  blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");

  blockedAddresses.addSubnet("::", 128, "ipv6");
  blockedAddresses.addSubnet("::1", 128, "ipv6");
  blockedAddresses.addSubnet("64:ff9b::", 96, "ipv6");
  blockedAddresses.addSubnet("64:ff9b:1::", 48, "ipv6");
  blockedAddresses.addSubnet("100::", 64, "ipv6");
  blockedAddresses.addSubnet("2001::", 32, "ipv6");
  blockedAddresses.addSubnet("2001:2::", 48, "ipv6");
  blockedAddresses.addSubnet("2001:10::", 28, "ipv6");
  blockedAddresses.addSubnet("2001:20::", 28, "ipv6");
  blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");
  blockedAddresses.addSubnet("2002::", 16, "ipv6");
  blockedAddresses.addSubnet("fc00::", 7, "ipv6");
  blockedAddresses.addSubnet("fe80::", 10, "ipv6");
  blockedAddresses.addSubnet("fec0::", 10, "ipv6");
  blockedAddresses.addSubnet("ff00::", 8, "ipv6");

  return blockedAddresses;
}

const BLOCKED_ADDRESSES = createBlockedAddressList();

/** Removes URL syntax that is not part of a DNS or IP hostname. */
function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return withoutBrackets.toLowerCase().replace(/\.+$/, "");
}

/** Returns whether a hostname is reserved for local or metadata access. */
function isBlockedHostname(hostname: string): boolean {
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return true;
  }

  return BLOCKED_HOSTNAME_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
}

/** Rejects malformed and non-public IP address records. */
function assertPublicAddress(address: ResolvedAddress): void {
  const detectedFamily = isIP(address.address);
  if (detectedFamily !== address.family) {
    throw new Error(`Invalid resolved address: ${address.address}`);
  }

  const addressType = address.family === 4 ? "ipv4" : "ipv6";
  if (BLOCKED_ADDRESSES.check(address.address, addressType)) {
    throw new Error(`Blocked non-public address: ${address.address}`);
  }
}

/** Resolves a hostname through the operating system resolver. */
async function resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((address) => {
    if (address.family !== 4 && address.family !== 6) {
      throw new Error(`Unsupported address family for ${address.address}`);
    }
    return { address: address.address, family: address.family };
  });
}

/** Parses, resolves, and validates one outbound request target. */
async function resolvePublicTarget(
  input: string | URL,
  dependencies: PublicUrlFetchDependencies,
): Promise<{ url: URL; address: ResolvedAddress }> {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public HTTP and HTTPS URLs are allowed");
  }
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isBlockedHostname(hostname)) {
    throw new Error(`Blocked non-public hostname: ${hostname || "<empty>"}`);
  }

  const literalFamily = isIP(hostname);
  const literalAddress: ResolvedAddress | undefined =
    literalFamily === 4
      ? { address: hostname, family: 4 }
      : literalFamily === 6
        ? { address: hostname, family: 6 }
        : undefined;
  const addresses: readonly ResolvedAddress[] = literalAddress
    ? [literalAddress]
    : await dependencies.resolveHostname(hostname);
  if (addresses.length === 0) {
    throw new Error(`${hostname} did not resolve`);
  }

  for (const address of addresses) {
    assertPublicAddress(address);
  }

  return { url, address: addresses[0] };
}

/** Creates a DNS lookup function pinned to the address already validated above. */
function createPinnedLookup(address: ResolvedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
}

/** Makes one HTTP request without following redirects or resolving DNS again. */
async function requestUrl(
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal,
): Promise<PublicHttpResponse> {
  const request = url.protocol === "https:" ? requestHttps : requestHttp;

  return new Promise((resolve, reject) => {
    const clientRequest = request(
      url,
      {
        agent: false,
        family: address.family,
        headers: { "User-Agent": USER_AGENT },
        lookup: createPinnedLookup(address),
        signal,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const statusMessage = response.statusMessage ?? "Unknown response";
        const location = response.headers.location;

        if (REDIRECT_STATUS_CODES.has(statusCode)) {
          response.resume();
          resolve({ statusCode, statusMessage, location, body: "" });
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({ statusCode, statusMessage, location, body });
        });
        response.on("error", reject);
        response.on("aborted", () => {
          reject(new Error(`Response body aborted for ${url.href}`));
        });
      },
    );

    clientRequest.on("error", reject);
    clientRequest.end();
  });
}

const DEFAULT_DEPENDENCIES: PublicUrlFetchDependencies = {
  resolveHostname,
  requestUrl,
};

/** Downloads text from a public HTTP(S) URL and validates every redirect. */
export async function fetchPublicText(
  input: string,
  signal: AbortSignal,
  dependencies: PublicUrlFetchDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  let target: string | URL = input;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const { url, address } = await resolvePublicTarget(target, dependencies);
    const response = await dependencies.requestUrl(url, address, signal);

    if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
      if (!response.location) {
        throw new Error("Redirect response without a location");
      }
      if (redirectCount >= MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      target = new URL(response.location, url);
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Failed to download resource: ${response.statusMessage}`);
    }

    return response.body;
  }
}
