/**
 * Parse a request/response body string into a JSON-like value for recording.
 *
 * - `application/json` (or a body that looks like JSON) → parsed object/array.
 * - `application/x-www-form-urlencoded` → flat object of fields.
 * - anything else → the raw string.
 * - empty body → `undefined`.
 *
 * Parsing never throws: malformed JSON falls back to the raw string.
 */
export function parseBodyText(
  text: string | null | undefined,
  contentType: string | null | undefined,
): unknown {
  if (!text) return undefined;

  const ct = (contentType ?? "").toLowerCase();

  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  if (ct.includes("application/x-www-form-urlencoded")) {
    return formUrlEncodedToObject(text);
  }

  // Many APIs omit the content-type; attempt JSON when the body clearly looks
  // like it, otherwise keep the raw string.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

/** Convert a `application/x-www-form-urlencoded` string into a flat object. */
export function formUrlEncodedToObject(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(text)) {
    out[key] = value;
  }
  return out;
}

/**
 * Convert `FormData` into a plain object for recording. File/Blob entries are
 * replaced with a `"[file]"` placeholder rather than read — we never ship file
 * contents through capture.
 */
export function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  form.forEach((value, key) => {
    out[key] = typeof value === "string" ? value : "[file]";
  });
  return out;
}

/**
 * Resolve a possibly-relative URL to an absolute one using the document origin
 * when available. Returns the input unchanged if resolution fails.
 */
export function toAbsoluteUrl(url: string): string {
  try {
    const base =
      typeof window !== "undefined" ? window.location.href : undefined;
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
