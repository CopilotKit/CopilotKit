import { hasAsciiControl } from "./ascii";
import type { HttpClient, RawResponse } from "./types";

const OFFICIAL_ORIGINS = new Set([
  "https://registry.npmjs.org",
  "https://pypi.org",
  "https://api.nuget.org",
  "https://repo1.maven.org",
  "https://repo.maven.apache.org",
  "https://search.maven.org",
  "https://central.sonatype.com",
]);
const TIMEOUT_MS = 20_000;
// Full npm packuments can be large. This bounds decompressed response bytes.
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface LiveHttpOptions {
  fetch?: typeof globalThis.fetch;
  clock?: () => Date;
  /** May lower the 20-second deadline, never disable or extend it. */
  timeoutMs?: number;
  /** May lower the 64 MiB response ceiling, never disable or extend it. */
  maxBodyBytes?: number;
}

class CaptureError extends Error {}

function allowedUrl(value: string, redirect = false): URL {
  const message = redirect
    ? "Registry redirect is not allowed."
    : "Registry URL is not allowed.";
  try {
    const parsed = new URL(value);
    if (
      hasAsciiControl(value) ||
      value.includes(" ") ||
      !OFFICIAL_ORIGINS.has(parsed.origin) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new CaptureError(message);
    }
    return parsed;
  } catch {
    // URL parser errors may include the original input, including credentials.
    throw new CaptureError(message);
  }
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

async function readBody(
  response: Response,
  signal: AbortSignal,
  limit: number,
): Promise<string> {
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
    discardBody(response);
    throw new CaptureError("Registry response exceeds the byte limit.");
  }
  const type = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    type &&
    ![
      "application/json",
      "application/xml",
      "text/xml",
      "text/plain",
      "application/octet-stream",
    ].includes(type) &&
    !/^application\/[a-z0-9.+-]+\+(?:json|xml)$/.test(type)
  ) {
    discardBody(response);
    throw new CaptureError(
      "Registry response has an unsupported content type.",
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const pieces: string[] = [];
  let bytes = 0;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new CaptureError("Registry request timed out.");
      const chunk = await reader.read();
      if (signal.aborted) throw new CaptureError("Registry request timed out.");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        throw new CaptureError("Registry response exceeds the byte limit.");
      }
      try {
        pieces.push(decoder.decode(chunk.value, { stream: true }));
      } catch {
        throw new CaptureError("Registry response is not valid UTF-8.");
      }
    }
    try {
      pieces.push(decoder.decode());
    } catch {
      throw new CaptureError("Registry response is not valid UTF-8.");
    }
    return pieces.join("");
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Fetch public registry metadata only. Persistence belongs to the caller. */
export function createLiveHttpClient(
  options: LiveHttpOptions = {},
): HttpClient {
  const fetchResponse = options.fetch ?? globalThis.fetch;
  const clock = options.clock ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > TIMEOUT_MS
  ) {
    throw new CaptureError(
      "Registry timeout must be between 1 and 20000 milliseconds.",
    );
  }
  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    maxBodyBytes < 1 ||
    maxBodyBytes > MAX_BODY_BYTES
  ) {
    throw new CaptureError(
      "Registry byte limit must be between 1 byte and 64 MiB.",
    );
  }

  return {
    async get(url: string, accept = "application/json"): Promise<RawResponse> {
      let current = allowedUrl(url);
      if (!accept.trim() || hasAsciiControl(accept)) {
        throw new CaptureError("Registry Accept header is invalid.");
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new CaptureError("Registry request timed out."));
        }, timeoutMs);
      });
      const request = async (): Promise<RawResponse> => {
        const visited = new Set<string>();
        for (let redirects = 0; ; redirects++) {
          if (controller.signal.aborted)
            throw new CaptureError("Registry request timed out.");
          if (visited.has(current.href))
            throw new CaptureError("Registry redirect loop.");
          visited.add(current.href);
          const response = await fetchResponse(current.href, {
            headers: { accept },
            credentials: "omit",
            redirect: "manual",
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            discardBody(response);
            throw new CaptureError("Registry request timed out.");
          }
          if (
            response.redirected ||
            (response.url && response.url !== current.href)
          ) {
            discardBody(response);
            throw new CaptureError(
              "Registry transport followed an unchecked redirect.",
            );
          }
          if (REDIRECT_STATUSES.has(response.status)) {
            discardBody(response);
            if (redirects >= MAX_REDIRECTS) {
              throw new CaptureError("Registry redirect limit exceeded.");
            }
            const location = response.headers.get("location");
            if (
              !location ||
              hasAsciiControl(location) ||
              location.includes(" ")
            ) {
              throw new CaptureError("Registry redirect is not allowed.");
            }
            try {
              current = allowedUrl(new URL(location, current).href, true);
            } catch {
              throw new CaptureError("Registry redirect is not allowed.");
            }
            continue;
          }
          if (response.status < 200 || response.status >= 300) {
            discardBody(response);
            throw new CaptureError(
              `Registry request returned HTTP ${response.status}.`,
            );
          }
          const body = await readBody(
            response,
            controller.signal,
            maxBodyBytes,
          );
          let observedAt: string;
          try {
            observedAt = clock().toISOString();
          } catch {
            throw new CaptureError("Registry observation time is invalid.");
          }
          return { url, status: response.status, observedAt, body };
        }
      };
      try {
        // The race also bounds injected transports that ignore AbortSignal.
        return await Promise.race([request(), deadline]);
      } catch (error) {
        if (error instanceof CaptureError) throw error;
        if (controller.signal.aborted)
          throw new CaptureError("Registry request timed out.");
        // Fetch/stream errors can include proxy credentials or transport details.
        throw new CaptureError("Registry request failed.");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        controller.abort();
      }
    },
  };
}
