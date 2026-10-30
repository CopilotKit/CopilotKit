/**
 * Server-side download of URL attachments (image/file parts) for BuiltInAgent.
 *
 * The AI SDK downloads any URL attachment that the model cannot take as a URL
 * and puts the bytes into the prompt. The URL comes from the request, so the
 * default downloader lets a caller make the server fetch internal addresses.
 * The AI SDK's own check rejects literal private IPs and the names
 * `localhost`, `*.local` and `*.localhost`, but it compares the literal text
 * and never resolves DNS: a hostname that resolves to a private address, or a
 * spelling such as `localhost.`, gets through.
 *
 * This downloader:
 * - leaves `data:` URLs to the AI SDK, which decodes them without a fetch;
 * - accepts only http and https URLs without credentials;
 * - resolves the hostname and rejects any non-public address;
 * - connects only to the addresses it checked (no second DNS lookup);
 * - checks every redirect target the same way, and refuses https to http;
 * - limits the size and time of each download, and the number and total
 *   size of the downloads for one model call;
 * - stops when the run is aborted (BuiltInAgent, or the `signal` given to
 *   `createSafeUrlDownload`), or when another download of the same call fails.
 *
 * The client gets the same message whether a host did not resolve or resolved
 * to a non-public address, and the reason is only logged on the server. Two
 * residual signals are accepted: the time to fail can differ between the two
 * cases, and a DNS lookup that hangs (for example in an internal zone) ends
 * with the timeout message instead.
 */
import type * as DnsPromises from "node:dns/promises";
import type * as Http from "node:http";
import type { IncomingMessage } from "node:http";
import type * as Https from "node:https";
import type * as Net from "node:net";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { COPILOTKIT_VERSION } from "@copilotkit/shared";
import { DownloadError } from "ai";
import type { Experimental_DownloadFunction as DownloadFunction } from "ai";

/** Options for the default, public-network-only URL downloader. */
export interface SafeUrlDownloadOptions {
  /**
   * Hostnames that may be downloaded. When omitted, any hostname is allowed.
   * Every resolved address must be public in both cases, and every redirect
   * target must match as well.
   *
   * - `cdn.example.com` matches exactly that host.
   * - `*.example.com` matches any subdomain (`a.example.com`,
   *   `a.b.example.com`) but not `example.com` itself; list both if needed.
   *
   * Matching ignores case and a trailing dot. Unicode names match their
   * punycode form, and an IPv6 address may be given with or without
   * brackets. An entry with a scheme, port, path or user, and a wildcard over
   * an IP address (`*.1.2.3.4`), are rejected when the downloader is created.
   * An empty list refuses every server-side download; `data:` URLs and URLs
   * that the model takes directly are not downloaded, so they still pass.
   */
  allowedHosts?: string[];
  /** Largest response body to accept, in bytes (at least 1). Default: 20 MiB. */
  maxBytes?: number;
  /**
   * Time limit for one download, including redirects, in ms. From 1 to
   * 2147483647 (the largest delay `setTimeout` supports). Default: 30000.
   */
  timeoutMs?: number;
  /** Largest number of redirects to follow; 0 follows none. Default: 3. */
  maxRedirects?: number;
  /**
   * Largest number of distinct URLs to download for one model call (at
   * least 1); a URL that appears twice is downloaded once. The AI SDK
   * downloads the attachments of every user message again for each step of
   * a multi-step run. Default: 20.
   */
  maxDownloads?: number;
  /**
   * Largest number of bytes to download for one model call, over all its
   * URLs (at least 1). Default: 50 MiB.
   */
  maxTotalBytes?: number;
}

/** @internal Test seams. Not part of the public API. */
export interface UrlDownloadInternals {
  resolveHost?: (hostname: string) => Promise<LookupAddress[]>;
  /**
   * Replaces the address policy. It has the shape of the exported
   * {@link isPublicAddress}; an async answer is awaited.
   */
  isPublicAddress?: (address: string) => boolean | Promise<boolean>;
  /** CA certificates to trust for https instead of the default ones. */
  ca?: string;
}

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_MAX_DOWNLOADS = 20;
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
// One message for both cases, so that the error does not reveal whether an
// internal name exists. The reason is logged on the server only. (A lookup
// that hangs ends with the timeout message instead; see the file header.)
const HOST_REFUSED =
  "The URL host is not a public address, or it could not be resolved.";
// For a network, TLS or response stream error. The cause, which can name a
// resolved address, is only logged.
const DOWNLOAD_FAILED = "The download failed.";
const USER_AGENT = `CopilotKit-Runtime/${COPILOTKIT_VERSION}`;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type NodeModules = {
  dns: typeof DnsPromises;
  http: typeof Http;
  https: typeof Https;
  net: typeof Net;
};

let nodeModules: Promise<NodeModules> | undefined;

// Loaded on first use so that importing the agent does not require Node
// networking modules. Where they are not available (for example on an edge
// runtime), downloads fail closed and the log says how to configure them.
function loadNodeModules(): Promise<NodeModules> {
  nodeModules ??= Promise.all([
    import("node:dns/promises"),
    import("node:http"),
    import("node:https"),
    import("node:net"),
  ])
    .then(([dns, http, https, net]) => ({ dns, http, https, net }))
    .catch((error: unknown) => {
      // Try again on the next download instead of failing forever.
      nodeModules = undefined;
      throw error;
    });
  return nodeModules;
}

type AddressPolicy = (address: string) => boolean;
let defaultPolicy: AddressPolicy | undefined;

function buildAddressPolicy(net: NodeModules["net"]): AddressPolicy {
  const nonPublicV4 = new net.BlockList();
  for (const [address, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // Carrier-grade NAT.
    ["127.0.0.0", 8],
    ["169.254.0.0", 16], // Link-local, including cloud metadata.
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const) {
    nonPublicV4.addSubnet(address, prefix, "ipv4");
  }

  // Only global unicast IPv6 (2000::/3) is public. This also rejects ::1,
  // fc00::/7, fe80::/10, IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96).
  const globalV6 = new net.BlockList();
  globalV6.addSubnet("2000::", 3, "ipv6");
  const nonPublicV6 = new net.BlockList();
  for (const [address, prefix] of [
    // IANA special-purpose block, including Teredo (2001::/32). A few ranges
    // inside it are globally reachable (for example AS112, 2001:4:112::/48);
    // the whole /23 is refused on purpose, failing closed.
    ["2001::", 23],
    ["2001:db8::", 32], // Documentation.
    ["2002::", 16], // 6to4.
    ["3fff::", 20], // Documentation.
  ] as const) {
    nonPublicV6.addSubnet(address, prefix, "ipv6");
  }

  return (address) => {
    const family = net.isIP(address);
    if (family === 4) return !nonPublicV4.check(address, "ipv4");
    if (family !== 6 || address.includes("%")) return false;
    return (
      globalV6.check(address, "ipv6") && !nonPublicV6.check(address, "ipv6")
    );
  };
}

/** Returns true only for a public unicast IPv4 or IPv6 address. */
export async function isPublicAddress(address: string): Promise<boolean> {
  const { net } = await loadNodeModules();
  defaultPolicy ??= buildAddressPolicy(net);
  return defaultPolicy(address);
}

/**
 * True when the server must not fetch this URL itself and returns `null` so
 * the AI SDK handles it: the provider takes the URL as-is, or it is a `data:`
 * URL, which the AI SDK decodes locally without any network request.
 */
function leftToAiSdk({
  url,
  isUrlSupportedByModel,
}: {
  url: URL;
  isUrlSupportedByModel: boolean;
}): boolean {
  return isUrlSupportedByModel || url.protocol === "data:";
}

/** The URL without its query and fragment, which can hold credentials. */
function urlForLog(url: URL | string): string {
  try {
    const parsed = new URL(String(url));
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "(invalid URL)";
  }
}

/** `text` with the query and fragment removed from every URL in it. */
function redactUrls(text: string): string {
  return text.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^\s?#"'`<>]*)[?#][^\s"'`<>]*/gi,
    "$1",
  );
}

// Errors that this module has already logged, so that BuiltInAgent's model
// call error handler does not log them a second time.
const loggedErrors = new WeakSet<object>();

/**
 * Returns the error for a failed or refused download and logs it on the
 * server. `detail` goes only to the log: the client sees `message`, which
 * never holds the URL's query, a resolved address or a raw network error.
 * For a refused host, `message` is the same whether the name did not resolve
 * or resolved to a non-public address, so that it does not reveal internal
 * DNS names.
 */
function refuse(
  url: URL | string,
  message: string,
  detail?: string,
  statusCode?: number,
): DownloadError {
  console.warn(
    redactUrls(
      `[BuiltInAgent] URL download failed for ${urlForLog(url)}: ${message}${detail ? ` (${detail})` : ""}`,
    ),
  );
  const error = new DownloadError({ url: urlForLog(url), message, statusCode });
  loggedErrors.add(error);
  return error;
}

/**
 * @internal BuiltInAgent's `onError` for its `streamText` call. The AI SDK's
 * default handler prints the whole error, which for a download error holds
 * the URL with its query. This logs an error once, with the same detail
 * (for a provider API error, its status code and response body) but with the
 * query and fragment removed from every URL, and skips the download errors
 * that were already logged here.
 */
export function logModelCallError(error: unknown): void {
  if (typeof error === "object" && error !== null && loggedErrors.has(error)) {
    return;
  }
  const frames =
    error instanceof Error && error.stack
      ? error.stack
          .split("\n")
          .filter((line) => /^\s+at /.test(line))
          .join("\n")
      : "";
  console.error(
    redactUrls(
      `[BuiltInAgent] The model call failed: ${describeModelError(error)}${frames ? `\n${frames}` : ""}`,
    ),
  );
}

// Longest text logged for one field of a model call error. A field such as
// `requestBodyValues` can hold the whole prompt.
const MAX_LOGGED_FIELD_LENGTH = 2000;

function truncateForLog(text: string): string {
  return text.length > MAX_LOGGED_FIELD_LENGTH
    ? `${text.slice(0, MAX_LOGGED_FIELD_LENGTH)}… (${text.length} characters)`
    : text;
}

/**
 * {@link describeError}, followed by the other fields of the error, such as
 * the `statusCode`, `responseBody` and `url` of the AI SDK's APICallError. A
 * value that is not an Error, such as the plain object that a provider
 * stream sends as its error, is logged as JSON.
 */
function describeModelError(error: unknown): string {
  if (!(error instanceof Error)) return truncateForLog(describeValue(error));
  const fields = Object.entries(error)
    .filter(
      ([key]) => !["name", "message", "stack", "cause", "code"].includes(key),
    )
    .map(([key, value]) => {
      const text =
        value instanceof Error
          ? describeError(value)
          : typeof value === "string"
            ? value
            : describeValue(value);
      return `${key}: ${truncateForLog(text)}`;
    });
  const name = error.name && error.name !== "Error" ? `${error.name}: ` : "";
  return `${name}${describeError(error)}${fields.length > 0 ? ` {${fields.join("; ")}}` : ""}`;
}

/** Message, error code and causes of an error, for the server log. */
function describeError(error: unknown, depth = 0): string {
  if (typeof error === "string") return error;
  if (!(error instanceof Error)) return truncateForLog(describeValue(error));
  const code = (error as { code?: unknown }).code;
  const text =
    typeof code === "string" && !error.message.includes(code)
      ? `${code}: ${error.message}`
      : error.message;
  return error.cause !== undefined && depth < 3
    ? `${text}; caused by ${describeError(error.cause, depth + 1)}`
    : text;
}

/**
 * A printable form of a configuration value for an error message. Unlike
 * `JSON.stringify`, it never throws (BigInt) and never gives `undefined`
 * (Symbol, function).
 */
function describeValue(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "a function";
  try {
    const text = JSON.stringify(value);
    if (text !== undefined) return text;
  } catch {
    // Not serializable, for example a cycle or a nested BigInt.
  }
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * The form in which hostnames are compared: a URL hostname (lowercase ASCII,
 * IDNA as punycode, IPv6 in canonical form) without IPv6 brackets and without
 * one trailing dot.
 */
function comparableHost(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

/**
 * Validates one `allowedHosts` entry and returns it in comparable form: an
 * exact host, or `*.` followed by a host suffix.
 */
function normalizeAllowedHost(entry: unknown): string {
  const invalid = (reason: string) =>
    new Error(
      `urlDownload.allowedHosts entry ${describeValue(entry)} is invalid: ${reason}`,
    );
  if (typeof entry !== "string" || entry === "") {
    throw invalid("it must be a non-empty hostname");
  }
  if (/[\s/?#@\\]/.test(entry)) {
    throw invalid("give only a hostname, without a scheme, path or user");
  }
  const wildcard = entry.startsWith("*.");
  const host = wildcard ? entry.slice(2) : entry;
  if (host === "" || host === "." || host.includes("*")) {
    throw invalid('"*" is allowed only as a leading "*." label');
  }
  // `host:port` (one ":" and no brackets) or `[ipv6]:port`. An IPv6 address
  // without brackets always has at least two ":".
  if (/^[^:[\]]*:\d*$/.test(host) || /^\[.*\]:\d*$/.test(host)) {
    throw invalid("give only a hostname, without a port");
  }
  const bare = host.replace(/^\[(.*)\]$/, "$1");
  // Any ":" left belongs to an IPv6 address, which the URL parser needs in
  // brackets.
  const authority = bare.includes(":") ? `[${bare}]` : host;
  let parsed: URL;
  try {
    parsed = new URL(`http://${authority}/`);
  } catch {
    throw invalid("it is not a valid hostname");
  }
  const normalized = comparableHost(parsed.hostname);
  // The URL parser turns a name whose last label is a number into an IPv4
  // address (`*.0.1` becomes `0.0.0.1`), and no hostname can end in one.
  if (
    wildcard &&
    (normalized.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(normalized))
  ) {
    throw invalid("a wildcard needs a hostname suffix, not an IP address");
  }
  return (wildcard ? "*." : "") + normalized;
}

function normalizeAllowedHosts(entries: unknown): string[] | undefined {
  if (entries === undefined) return undefined;
  if (!Array.isArray(entries)) {
    throw new Error("urlDownload.allowedHosts must be an array of hostnames");
  }
  return entries.map(normalizeAllowedHost);
}

function hostAllowed(hostname: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts) return true;
  const host = comparableHost(hostname);
  return allowedHosts.some((pattern) =>
    pattern.startsWith("*.")
      ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
      : host === pattern,
  );
}

function checkUrl(url: URL, allowedHosts?: string[]): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw refuse(url, "Only http and https URLs can be downloaded.");
  }
  if (url.username !== "" || url.password !== "") {
    throw refuse(url, "URLs with credentials cannot be downloaded.");
  }
  if (!hostAllowed(url.hostname, allowedHosts)) {
    throw refuse(url, "The URL host is not in the allowed hosts list.");
  }
}

/**
 * Waits for `work`, or rejects with the abort reason when `signal` aborts.
 * The handlers are attached to `work` first, so that a later rejection of
 * `work` is always handled: an unhandled rejection ends a Node process in
 * the default mode.
 */
function withDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function requestPinned(
  modules: NodeModules,
  url: URL,
  addresses: LookupAddress[],
  signal: AbortSignal,
  ca: string | undefined,
): Promise<IncomingMessage> {
  // Answer the socket's lookup with the checked addresses only, so a second
  // DNS answer (DNS rebinding) can never pick the destination.
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const wanted = typeof options === "number" ? options : options?.family;
    const available =
      wanted === 4 || wanted === 6
        ? addresses.filter((a) => a.family === wanted)
        : addresses;
    if (available.length === 0) {
      callback(
        refuse(url, "No checked address is available for this URL."),
        "",
        4,
      );
    } else if (typeof options === "object" && options?.all) {
      callback(null, available);
    } else {
      callback(null, available[0]!.address, available[0]!.family);
    }
  };
  const isHttps = url.protocol === "https:";
  const transport = isHttps ? modules.https : modules.http;
  // A new agent per request: no pooled socket and no proxy can bypass the
  // pinned lookup.
  const agent = isHttps
    ? new modules.https.Agent({ keepAlive: false, maxCachedSessions: 0 })
    : new modules.http.Agent({ keepAlive: false });
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname,
        // SNI must not carry the trailing dot of a fully qualified name.
        servername:
          isHttps && modules.net.isIP(hostname) === 0
            ? hostname.replace(/\.$/, "")
            : undefined,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        // Some hosts refuse a request without a User-Agent.
        headers: { "accept-encoding": "identity", "user-agent": USER_AGENT },
        lookup,
        agent,
        signal,
        ...(isHttps && ca !== undefined ? { ca } : {}),
      },
      (response) => {
        response.once("close", () => agent.destroy());
        resolve(response);
      },
    );
    // `on`, not `once`: an error after the first one (for example from the
    // socket while it is torn down) must not go unhandled. Rejecting twice
    // is harmless.
    request.on("error", (error) => {
      agent.destroy();
      reject(error);
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      agent.destroy();
      reject(refuse(url, "Protocol upgrade refused."));
    });
    request.end();
  });
}

/**
 * Bytes still allowed for all the downloads of one model call, the current
 * one included. Shared by them and decreased as their bodies stream in.
 */
type ByteBudget = { remaining: number; readonly limit: number };

type ResolvedOptions = {
  allowedHosts: string[] | undefined;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  maxDownloads: number;
  maxTotalBytes: number;
};

async function readBody(
  url: URL,
  response: IncomingMessage,
  maxBytes: number,
  budget: ByteBudget,
): Promise<Uint8Array> {
  const tooLarge = () =>
    refuse(url, `The response is larger than the ${maxBytes}-byte limit.`);
  const overBudget = () =>
    refuse(
      url,
      `The downloads are larger than the ${budget.limit}-byte total limit.`,
    );
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (Number.isFinite(declared) && declared > budget.remaining) {
    throw overBudget();
  }
  const encoding = response.headers["content-encoding"];
  if (encoding && encoding !== "identity") {
    throw refuse(url, "Compressed responses are not accepted.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw tooLarge();
    budget.remaining -= buffer.byteLength;
    if (budget.remaining < 0) throw overBudget();
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

async function downloadOne(
  original: URL,
  options: ResolvedOptions,
  internals: UrlDownloadInternals,
  outer: AbortSignal,
  budget: ByteBudget,
): Promise<{ data: Uint8Array; mediaType: string | undefined }> {
  const modules = await loadNodeModules().catch((error: unknown) => {
    throw refuse(
      original,
      "URL download needs Node.js networking modules, which are not available here.",
      `loading them failed: ${describeError(error)}. On a runtime without them, set urlDownload to "disabled" or to your own download function`,
    );
  });
  defaultPolicy ??= buildAddressPolicy(modules.net);
  const isPublic = internals.isPublicAddress ?? defaultPolicy;
  const resolveHost =
    internals.resolveHost ??
    ((hostname: string) =>
      modules.dns.lookup(hostname, { all: true, verbatim: true }));

  // The URL of the current hop, so that a timeout names the hop that hung.
  let url = original;
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        refuse(
          url,
          `The download timed out after ${options.timeoutMs} ms (timeoutMs).`,
        ),
      ),
    options.timeoutMs,
  );
  // The run was aborted, or another download in the same call failed.
  const onOuterAbort = () => controller.abort(outer.reason);
  if (outer.aborted) onOuterAbort();
  else outer.addEventListener("abort", onOuterAbort, { once: true });
  const { signal } = controller;
  try {
    for (let hop = 0; ; hop++) {
      // An aborted download does nothing more, not even a DNS query for a
      // name that the request chose.
      signal.throwIfAborted();
      checkUrl(url, options.allowedHosts);
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const literalFamily = modules.net.isIP(hostname);
      let addresses: LookupAddress[];
      try {
        signal.throwIfAborted();
        addresses = literalFamily
          ? [{ address: hostname, family: literalFamily }]
          : await withDeadline(resolveHost(hostname), signal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        throw refuse(
          url,
          HOST_REFUSED,
          `DNS lookup failed: ${describeError(error)}`,
        );
      }
      const verdicts = await Promise.all(
        addresses.map(
          async ({ address, family }) =>
            (family === 4 || family === 6) &&
            (await isPublic(address)) === true,
        ),
      );
      const rejected = addresses.filter((_address, i) => !verdicts[i]);
      if (addresses.length === 0 || rejected.length > 0) {
        throw refuse(
          url,
          HOST_REFUSED,
          addresses.length === 0
            ? "DNS lookup returned no addresses"
            : `non-public address: ${rejected.map((a) => a.address).join(", ")}`,
        );
      }

      let response: IncomingMessage;
      try {
        response = await requestPinned(
          modules,
          url,
          addresses,
          signal,
          internals.ca,
        );
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (DownloadError.isInstance(error)) throw error;
        throw refuse(url, DOWNLOAD_FAILED, describeError(error));
      }
      try {
        const status = response.statusCode ?? 0;
        if (REDIRECT_STATUSES.has(status)) {
          if (hop >= options.maxRedirects) {
            throw refuse(
              url,
              `Too many redirects: the limit is ${options.maxRedirects} (maxRedirects).`,
            );
          }
          const location = response.headers.location;
          if (!location) throw refuse(url, "Redirect without a location.");
          let next: URL;
          try {
            next = new URL(location, url);
          } catch (error) {
            throw refuse(
              url,
              "Redirect to an invalid URL.",
              `Location ${JSON.stringify(location.slice(0, 200))}: ${describeError(error)}`,
            );
          }
          // Bytes fetched over plain http could be changed in transit.
          if (url.protocol === "https:" && next.protocol === "http:") {
            throw refuse(url, "A redirect from https to http is refused.");
          }
          url = next;
          continue;
        }
        if (status < 200 || status >= 300) {
          throw refuse(
            url,
            `The server answered with HTTP status ${status}.`,
            response.statusMessage,
            status,
          );
        }
        const data = await readBody(url, response, options.maxBytes, budget);
        const contentType = response.headers["content-type"];
        return { data, mediaType: contentType || undefined };
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (DownloadError.isInstance(error)) throw error;
        throw refuse(url, DOWNLOAD_FAILED, describeError(error));
      } finally {
        response.destroy();
      }
    }
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", onOuterAbort);
    controller.abort();
  }
}

// setTimeout clamps a longer delay to 1 ms, so a larger limit would end every
// download at once.
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Returns `value` (or `fallback`) if it is an integer from `min` to `max`. */
function integerOption(
  name: string,
  value: number | undefined,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    const range =
      max === Number.MAX_SAFE_INTEGER
        ? `an integer of at least ${min}`
        : `an integer from ${min} to ${max}`;
    throw new Error(
      `urlDownload.${name} must be ${range}, got ${describeValue(value)}`,
    );
  }
  return result;
}

// Every option name, so that a mistyped name fails instead of being ignored:
// a mistyped `allowedHosts` would otherwise allow every public host.
const OPTION_NAMES: Record<keyof SafeUrlDownloadOptions, true> = {
  allowedHosts: true,
  maxBytes: true,
  timeoutMs: true,
  maxRedirects: true,
  maxDownloads: true,
  maxTotalBytes: true,
};

function checkOptionsObject(options: unknown): asserts options is object {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new Error(
      `urlDownload options must be an object, got ${describeValue(options)}`,
    );
  }
}

function checkOptionNames(options: unknown): void {
  checkOptionsObject(options);
  for (const name of Object.keys(options)) {
    if (!Object.prototype.hasOwnProperty.call(OPTION_NAMES, name)) {
      throw new Error(
        `urlDownload has an unknown option ${describeValue(name)}; the valid options are ${Object.keys(OPTION_NAMES).join(", ")}`,
      );
    }
  }
}

/** A download function that can also be tied to a run's abort signal. */
export type GuardedUrlDownload = DownloadFunction & {
  /** The same download function, aborted when `signal` aborts. */
  forRun(signal: AbortSignal): DownloadFunction;
};

/** @internal Factory with test seams; use {@link createSafeUrlDownload}. */
export function createGuardedUrlDownload(
  options: SafeUrlDownloadOptions = {},
  internals: UrlDownloadInternals = {},
): GuardedUrlDownload {
  checkOptionNames(options);
  const resolved: ResolvedOptions = {
    allowedHosts: normalizeAllowedHosts(options.allowedHosts),
    maxBytes: integerOption("maxBytes", options.maxBytes, DEFAULT_MAX_BYTES, 1),
    timeoutMs: integerOption(
      "timeoutMs",
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      1,
      MAX_TIMEOUT_MS,
    ),
    maxRedirects: integerOption(
      "maxRedirects",
      options.maxRedirects,
      DEFAULT_MAX_REDIRECTS,
      0,
    ),
    maxDownloads: integerOption(
      "maxDownloads",
      options.maxDownloads,
      DEFAULT_MAX_DOWNLOADS,
      1,
    ),
    maxTotalBytes: integerOption(
      "maxTotalBytes",
      options.maxTotalBytes,
      DEFAULT_MAX_TOTAL_BYTES,
      1,
    ),
  };
  const downloadAll = async (
    requests: Parameters<DownloadFunction>[0],
    runSignal?: AbortSignal,
  ) => {
    // Aborted when the run aborts, or when one download fails, so that the
    // other downloads in this call stop as well.
    const batch = new AbortController();
    const onRunAbort = () => batch.abort(runSignal?.reason);
    if (runSignal?.aborted) onRunAbort();
    else runSignal?.addEventListener("abort", onRunAbort, { once: true });
    try {
      // One download per distinct URL; duplicates share its result.
      const pending = new Map<string, URL>();
      for (const request of requests) {
        if (!leftToAiSdk(request)) pending.set(request.url.href, request.url);
      }
      if (pending.size > resolved.maxDownloads) {
        throw refuse(
          [...pending.values()][resolved.maxDownloads]!,
          `A model call can have at most ${resolved.maxDownloads} URL downloads; this one has ${pending.size}.`,
        );
      }
      const budget: ByteBudget = {
        remaining: resolved.maxTotalBytes,
        limit: resolved.maxTotalBytes,
      };
      const downloads = new Map(
        [...pending].map(([href, url]) => [
          href,
          downloadOne(url, resolved, internals, batch.signal, budget).catch(
            (error: unknown) => {
              batch.abort(error);
              throw error;
            },
          ),
        ]),
      );
      return await Promise.all(
        requests.map((request) =>
          leftToAiSdk(request) ? null : downloads.get(request.url.href)!,
        ),
      );
    } finally {
      runSignal?.removeEventListener("abort", onRunAbort);
      batch.abort();
    }
  };
  return Object.assign(
    (requests: Parameters<DownloadFunction>[0]) => downloadAll(requests),
    {
      forRun:
        (signal: AbortSignal): DownloadFunction =>
        (requests) =>
          downloadAll(requests, signal),
    },
  );
}

/**
 * @internal Resolves BuiltInAgent's `urlDownload` setting once, so that an
 * invalid setting fails when the agent is constructed. The result gives the
 * download function for one run; the default downloader stops when the run
 * is aborted.
 */
export function resolveUrlDownloadSetting(
  setting:
    | "disabled"
    | SafeUrlDownloadOptions
    | DownloadFunction
    | null
    | undefined,
): (runSignal: AbortSignal) => DownloadFunction {
  if (setting === "disabled") return () => disabledUrlDownload;
  if (typeof setting === "function") return () => setting;
  if (setting === undefined || setting === null) {
    return createGuardedUrlDownload().forRun;
  }
  if (typeof setting === "object" && !Array.isArray(setting)) {
    return createGuardedUrlDownload(setting).forRun;
  }
  throw new Error(
    `urlDownload must be "disabled", an options object or a download function, got ${describeValue(setting)}`,
  );
}

/** Options for {@link createSafeUrlDownload}. */
export interface CreateSafeUrlDownloadOptions extends SafeUrlDownloadOptions {
  /**
   * Stops every download of this function when it aborts, for example the
   * run's `ctx.abortSignal` in BuiltInAgent's factory mode. Without it, a
   * download that is running when the run is aborted goes on until it ends
   * or reaches `timeoutMs`.
   */
  signal?: AbortSignal;
}

/**
 * Creates an AI SDK download function (`experimental_download`) that only
 * fetches public internet addresses, with the same checks and limits as
 * BuiltInAgent's default downloader. Pass it to `streamText` yourself when
 * you use BuiltInAgent's AI SDK factory mode. Create it in the factory with
 * the run's abort signal, so that an aborted run stops its downloads:
 *
 * ```ts
 * import { createSafeUrlDownload } from "@copilotkit/runtime";
 *
 * factory: (ctx) =>
 *   streamText({
 *     model,
 *     messages,
 *     abortSignal: ctx.abortSignal,
 *     experimental_download: createSafeUrlDownload({ signal: ctx.abortSignal }),
 *   }),
 * ```
 *
 * Invalid options throw here, when the function is created.
 */
export function createSafeUrlDownload(
  options: CreateSafeUrlDownloadOptions = {},
): DownloadFunction {
  checkOptionsObject(options);
  const { signal, ...downloadOptions } = options;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new Error(
      `urlDownload signal must be an AbortSignal, got ${describeValue(signal)}`,
    );
  }
  const download = createGuardedUrlDownload(downloadOptions);
  return signal ? download.forRun(signal) : download;
}

/**
 * A download function that never fetches from the network. URLs that the
 * model takes as-is and `data:` URLs are left to the AI SDK; any other URL,
 * whatever its scheme, fails the run.
 */
export const disabledUrlDownload: DownloadFunction = async (requests) =>
  requests.map((request) => {
    if (leftToAiSdk(request)) return null;
    throw refuse(
      request.url,
      'Server-side URL download is disabled (urlDownload: "disabled").',
    );
  });
