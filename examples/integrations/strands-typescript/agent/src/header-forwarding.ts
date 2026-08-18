import { AsyncLocalStorage } from "node:async_hooks";
import type { Request } from "express";

const headerStorage = new AsyncLocalStorage<Record<string, string>>();

function extractXHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (!key.toLowerCase().startsWith("x-") || value === undefined) continue;
    headers[key.toLowerCase()] = Array.isArray(value)
      ? value.join(",")
      : String(value);
  }
  return headers;
}

export function withForwardedHeaders<T>(
  request: Request,
  callback: () => T,
): T {
  return headerStorage.run(extractXHeaders(request), callback);
}

export const forwardingFetch: typeof fetch = (input, init) => {
  const forwarded = headerStorage.getStore();
  if (!forwarded || Object.keys(forwarded).length === 0) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(forwarded)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return fetch(input, { ...init, headers });
};
