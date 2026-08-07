/**
 * HTTP client for the runtime's vision-powered receipt parser.
 *
 * Talks to `POST {runtimeBase}/api/receipt` (see `runtime/app/api/receipt/route.ts`),
 * which accepts a receipt image and returns structured fields the app turns into
 * a proposed transaction. This module is intentionally framework-free (no React,
 * no CopilotKit) so it can be unit-tested and reused from anywhere.
 *
 * The endpoint accepts the image two ways; we use the JSON-body form
 * (`{ image: <base64 | dataURL>, mimeType }`) because it works headless on
 * React Native / Hermes without needing a multipart `File`/`Blob` polyfill.
 */

import type { CurrencyCode } from "../types";
import type { ReceiptDraft } from "./contracts";

/**
 * Default runtime base URL. The receipt endpoint lives at `${base}/api/receipt`.
 *
 * This mirrors the `RUNTIME_URL` convention in `App.tsx` (which points at
 * `${base}/api/copilotkit`). The integration agent should override this via
 * {@link configureReceiptEndpoint} so the receipt parser and the CopilotKit
 * runtime share one base. On a physical device, use the machine's LAN IP
 * instead of `localhost`.
 */
export const DEFAULT_RUNTIME_BASE = "https://your-server";

/** Path of the receipt endpoint relative to the runtime base. */
export const RECEIPT_PATH = "/api/receipt";

/**
 * Fully-qualified default endpoint. Recomputed by {@link configureReceiptEndpoint}.
 * Read the live value via {@link getReceiptEndpoint} rather than capturing this
 * constant, since the integration agent may reconfigure it at startup.
 */
export const RECEIPT_ENDPOINT = `${DEFAULT_RUNTIME_BASE}${RECEIPT_PATH}`;

// Mutable, module-level endpoint the client actually uses. Starts at the
// default and can be repointed once at app startup by the integration agent.
let activeEndpoint = RECEIPT_ENDPOINT;

/**
 * Repoint the receipt endpoint. Call once at startup, ideally derived from the
 * same base URL passed to `<CopilotKitProvider runtimeUrl>`.
 *
 * Accepts either a runtime base (e.g. `http://localhost:3000`, to which
 * `/api/receipt` is appended) or a full endpoint URL ending in `/api/receipt`.
 */
export function configureReceiptEndpoint(baseOrEndpoint: string): void {
  const trimmed = baseOrEndpoint.replace(/\/+$/, "");
  activeEndpoint = trimmed.endsWith(RECEIPT_PATH)
    ? trimmed
    : `${trimmed}${RECEIPT_PATH}`;
}

/** The endpoint the client will POST to right now. */
export function getReceiptEndpoint(): string {
  return activeEndpoint;
}

/** Error thrown when the receipt endpoint returns a non-2xx response. */
export class ReceiptParseError extends Error {
  readonly status: number;
  readonly detail?: string;
  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = "ReceiptParseError";
    this.status = status;
    this.detail = detail;
  }
}

/** Raw JSON shape returned by `POST /api/receipt` on success. */
interface ReceiptResultResponse {
  merchant: string;
  amount: number;
  currency: string;
  date: string;
  suggestedCategory: string;
}

/** Defensive coercion: the model returns an arbitrary string for currency. */
const KNOWN_CURRENCIES: readonly CurrencyCode[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "PHP",
  "INR",
  "AUD",
  "CAD",
];

function coerceCurrency(raw: string): CurrencyCode {
  const upper = (raw ?? "").trim().toUpperCase();
  return (KNOWN_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as CurrencyCode)
    : "USD";
}

/**
 * POST a receipt image to the runtime and return a normalized {@link ReceiptDraft}.
 *
 * @param image    Base64 string OR a full `data:<mime>;base64,...` URL.
 * @param mimeType MIME type when `image` is a bare base64 string (default
 *                 `image/jpeg`). Ignored if `image` is already a data URL.
 * @param signal   Optional AbortSignal so callers (e.g. a frontend-tool handler
 *                 receiving `context.signal`) can cancel an in-flight parse.
 */
export async function parseReceiptImage(
  image: string,
  mimeType: string = "image/jpeg",
  signal?: AbortSignal,
): Promise<ReceiptDraft> {
  let res: Response;
  try {
    res = await fetch(getReceiptEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image, mimeType }),
      signal,
    });
  } catch (err) {
    // Network-level failure (DNS, connection refused, offline, aborted).
    const message =
      err instanceof Error ? err.message : "Network request failed";
    throw new ReceiptParseError(
      `Could not reach the receipt parser at ${getReceiptEndpoint()}.`,
      0,
      message,
    );
  }

  // The endpoint returns 400 (bad input) / 502 (model failure) with a JSON
  // `{ error, detail? }` body, or 200 with the structured result.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const errObj = (body ?? {}) as { error?: string; detail?: string };
    throw new ReceiptParseError(
      errObj.error ?? `Receipt parse failed (HTTP ${res.status}).`,
      res.status,
      errObj.detail,
    );
  }

  const data = (body ?? {}) as Partial<ReceiptResultResponse>;
  if (
    typeof data.merchant !== "string" ||
    typeof data.amount !== "number" ||
    typeof data.date !== "string" ||
    typeof data.suggestedCategory !== "string"
  ) {
    throw new ReceiptParseError(
      "Receipt parser returned an unexpected response shape.",
      res.status,
      JSON.stringify(body),
    );
  }

  return {
    merchant: data.merchant,
    amount: data.amount,
    currency: coerceCurrency(data.currency ?? "USD"),
    date: data.date,
    suggestedCategory: data.suggestedCategory,
  };
}
