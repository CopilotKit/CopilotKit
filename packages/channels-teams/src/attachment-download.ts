import dns from "node:dns/promises";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import type { FileDeliveryConfig } from "./download-files.js";
import {
  AttachmentDownloadError,
  isPublicAddress,
  parseAttachmentUrl,
} from "./attachment-url.js";

const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function limit(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("Attachment limits must be nonnegative safe integers");
  }
  return result;
}

/** One budget per inbound message, shared with Graph fallback. Not a public export. */
export class DownloadBudget {
  readonly maxBytesPerFile: number;
  readonly maxFiles: number;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly deadline: number;
  private bytes = 0;
  private files = 0;

  constructor(config: FileDeliveryConfig = {}) {
    this.maxBytesPerFile = limit(config.maxBytesPerFile, 8 * 1024 * 1024);
    this.maxFiles = limit(config.maxFiles, 5);
    this.maxBytes = limit(config.maxBytesPerMessage, 40 * 1024 * 1024);
    this.timeoutMs = limit(config.downloadTimeoutMs, 30_000);
    this.deadline = performance.now() + limit(config.maxDownloadTimeMs, 60_000);
  }

  get remainingBytes(): number {
    return Math.max(0, this.maxBytes - this.bytes);
  }

  assertAvailable(): void {
    this.checkTime();
    if (this.files >= this.maxFiles)
      throw new AttachmentDownloadError("message file limit reached");
    if (this.remainingBytes === 0)
      throw new AttachmentDownloadError("message download byte cap reached");
  }

  startFile(): void {
    this.assertAvailable();
    // Failed/unsupported downloads still consume an attempt.
    this.files++;
  }

  consume(bytes: number): void {
    this.checkTime();
    this.bytes += bytes;
    if (this.bytes > this.maxBytes)
      throw new AttachmentDownloadError("message download byte cap exceeded");
  }

  private checkTime(): void {
    if (performance.now() >= this.deadline)
      throw new AttachmentDownloadError("attachment download timed out");
  }

  /** Covers DNS, connect, redirects and body; also bounds fixed-origin Graph calls. */
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.checkTime();
    const controller = new AbortController();
    const timeout = new AttachmentDownloadError(
      "attachment download timed out",
    );
    const deadline = Math.min(
      this.deadline,
      performance.now() + this.timeoutMs,
    );
    if (performance.now() >= deadline) throw timeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => work(controller.signal)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => {
              controller.abort(timeout);
              reject(timeout);
            },
            Math.max(0, deadline - performance.now()),
          );
        }),
      ]);
      // Synchronous decoding can finish before an overdue timer gets to run.
      if (performance.now() >= deadline) throw timeout;
      return result;
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}

export function downloadErrorMessage(error: unknown): string {
  // DNS/TLS/fetch errors can contain preauthenticated URLs. Never forward them.
  return error instanceof AttachmentDownloadError
    ? error.message
    : "attachment download failed";
}

function checkSize(size: number, maxBytes: number): void {
  if (size > maxBytes)
    throw new AttachmentDownloadError(
      "attachment download exceeds the byte cap",
    );
}

function decodeDataUri(url: string, budget: DownloadBudget): Buffer {
  const comma = url.indexOf(",");
  if (comma < 0 || comma > 1024)
    throw new AttachmentDownloadError("malformed data URI");
  const maxBytes = Math.min(budget.maxBytesPerFile, budget.remainingBytes);
  const base64 = /;base64$/i.test(url.slice(5, comma));
  const length = url.length - comma - 1;
  // Bound encoded input before slicing/decoding or allocating a Buffer.
  checkSize(length, base64 ? Math.ceil(maxBytes / 3) * 4 : maxBytes * 3);
  const payload = url.slice(comma + 1);
  if (base64) {
    if (
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) ||
      length % 4 === 1 ||
      (payload.includes("=") && length % 4 !== 0)
    ) {
      throw new AttachmentDownloadError("malformed data URI");
    }
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    const size = Math.floor(((length - padding) * 3) / 4);
    checkSize(size, maxBytes);
    budget.consume(size);
    return Buffer.from(payload, "base64");
  }
  let size = 0;
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === "%") {
      if (!/^[0-9a-f]{2}$/i.test(payload.slice(i + 1, i + 3))) {
        throw new AttachmentDownloadError("malformed data URI");
      }
      i += 2;
      size++;
    } else {
      const code = payload.codePointAt(i)!;
      size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (code > 0xffff) i++;
    }
    checkSize(size, maxBytes);
  }
  budget.consume(size);
  try {
    return Buffer.from(decodeURIComponent(payload), "utf8");
  } catch {
    throw new AttachmentDownloadError("malformed data URI");
  }
}

async function requestHop(
  url: URL,
  signal: AbortSignal,
  token?: string,
): Promise<IncomingMessage> {
  const addresses = await dns.lookup(url.hostname, {
    all: true,
    verbatim: true,
  });
  // DNS lookup itself cannot be cancelled, but a late answer must never connect.
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some(
      ({ address, family }) =>
        !isPublicAddress(address) || (family !== 4 && family !== 6),
    )
  ) {
    throw new AttachmentDownloadError(
      "attachment hostname resolves to a nonpublic address",
    );
  }
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const wanted = typeof options === "number" ? options : options.family;
    const available = wanted
      ? addresses.filter((a) => a.family === wanted)
      : addresses;
    if (!available.length) {
      callback(
        new AttachmentDownloadError("no validated attachment address"),
        "",
        4,
      );
    } else if (typeof options === "object" && options.all) {
      callback(null, available);
    } else {
      callback(null, available[0]!.address, available[0]!.family);
    }
  };
  // A fresh agent prevents pooled sockets or proxy env settings from bypassing
  // the validated lookup. Preserve hostname/SNI and normal TLS verification.
  const agent = new https.Agent({ keepAlive: false, maxCachedSessions: 0 });
  return await new Promise<IncomingMessage>((resolve, reject) => {
    try {
      const request = https.request(
        {
          protocol: "https:",
          hostname: url.hostname,
          servername: url.hostname,
          port: 443,
          path: url.pathname + url.search,
          method: "GET",
          headers: {
            "Accept-Encoding": "identity",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          lookup,
          agent,
          signal,
          rejectUnauthorized: true,
        },
        (response) => {
          response.once("close", () => agent.destroy());
          resolve(response);
        },
      );
      request.once("error", (error) => {
        agent.destroy();
        reject(error);
      });
      request.once("upgrade", (_response, socket) => {
        socket.destroy();
        agent.destroy();
        reject(
          new AttachmentDownloadError("attachment protocol upgrade refused"),
        );
      });
      request.end();
    } catch (error) {
      agent.destroy();
      reject(error);
    }
  });
}

async function readMessage(
  response: IncomingMessage,
  budget: DownloadBudget,
): Promise<Buffer> {
  const maxBytes = Math.min(budget.maxBytesPerFile, budget.remainingBytes);
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared)) checkSize(declared, maxBytes);
  if (
    response.headers["content-encoding"] &&
    response.headers["content-encoding"] !== "identity"
  ) {
    throw new AttachmentDownloadError("compressed attachment response refused");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    budget.consume(buffer.byteLength);
    bytes += buffer.byteLength;
    checkSize(bytes, maxBytes);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

/** Download a direct attachment, or Graph /content with a token on its first hop only. */
export async function downloadAttachment(
  source: string,
  budget: DownloadBudget,
  graphToken?: string,
): Promise<Buffer> {
  budget.startFile();
  return budget.run(async (signal) => {
    if (/^data:/i.test(source)) {
      if (graphToken)
        throw new AttachmentDownloadError("Graph attachment must use HTTPS");
      return decodeDataUri(source, budget);
    }
    let url = parseAttachmentUrl(source);
    if (graphToken && url.origin !== "https://graph.microsoft.com") {
      throw new AttachmentDownloadError(
        "Graph authorization requires the Graph origin",
      );
    }
    for (let hop = 0; ; hop++) {
      signal.throwIfAborted();
      const response = await requestHop(
        url,
        signal,
        hop === 0 ? graphToken : undefined,
      );
      try {
        const status = response.statusCode ?? 0;
        if (REDIRECTS.has(status)) {
          if (hop >= MAX_REDIRECTS)
            throw new AttachmentDownloadError(
              "attachment redirect limit exceeded",
            );
          const location = response.headers.location;
          if (!location)
            throw new AttachmentDownloadError(
              "attachment redirect has no destination",
            );
          let next: string;
          try {
            next = new URL(location, url).href;
          } catch {
            throw new AttachmentDownloadError("invalid attachment redirect");
          }
          url = parseAttachmentUrl(next);
          continue;
        }
        if (status < 200 || status >= 300) {
          throw new AttachmentDownloadError(`download failed (HTTP ${status})`);
        }
        return await readMessage(response, budget);
      } finally {
        // Stop redirect/error/over-limit bodies immediately, even if unconsumed.
        response.destroy();
      }
    }
  });
}

/** Bound fixed-origin Graph token/metadata JSON too; callers forbid redirects. */
export async function readGraphJson<T>(
  response: Response,
  budget: DownloadBudget,
): Promise<T> {
  const reader = response.body?.getReader();
  const maxBytes = Math.min(1024 * 1024, budget.remainingBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared)) checkSize(declared, maxBytes);
    if (!reader) throw new AttachmentDownloadError("empty Graph response");
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      budget.consume(value.byteLength);
      total += value.byteLength;
      checkSize(total, maxBytes);
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8")) as T;
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
