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
  return { status: response.status, body: (await response.json()) as unknown };
}
