import type { IntelligenceReadRequest } from "./intelligence-relay.js";

export interface IntelligenceTransportOptions {
  readonly runtimeUrl: string;
  readonly runtimeTransport: "rest" | "single" | "auto";
  readonly fetch: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credentials?: RequestCredentials;
}

/** Sends a bounded read through the existing authenticated Runtime transport. */
export async function fetchInspectorIntelligence(
  options: IntelligenceTransportOptions,
  request: IntelligenceReadRequest,
  signal: AbortSignal,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const base = options.runtimeUrl.replace(/\/+$/u, "");
  const single = options.runtimeTransport === "single";
  const response = await options.fetch(
    single ? base : `${base}/inspector-intelligence`,
    {
      method: "POST",
      headers: { ...options.headers, "Content-Type": "application/json" },
      credentials: options.credentials,
      signal,
      body: JSON.stringify(
        single ? { method: "inspector/intelligence", body: request } : request,
      ),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    return { status: response.status, body: null };
  }
  if (
    request.path.startsWith("/api/v1/exports/") &&
    request.path.endsWith("/content")
  ) {
    const metadata = response.headers.get("x-export-metadata");
    return {
      status: response.status,
      body: {
        content: await readExportBytes(response),
        contentType: response.headers.get("content-type"),
        metadata: metadata ? JSON.parse(metadata) : null,
      },
    };
  }
  return { status: response.status, body: (await response.json()) as unknown };
}

/** Bounds streamed export files before transferring their bytes to the iframe. */
async function readExportBytes(response: Response): Promise<ArrayBuffer> {
  const maxBytes = 50 * 1024 * 1024;
  if (!response.body) throw new Error("Missing export content");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Export is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}
