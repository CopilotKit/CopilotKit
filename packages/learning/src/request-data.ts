import { sensitiveContent } from "./text";

export type RequestBodyValue =
  | string
  | number
  | boolean
  | null
  | RequestBodyValue[]
  | { [key: string]: RequestBodyValue };

export interface SanitizedRequestBody {
  fields?: Record<string, RequestBodyValue>;
  /** Omitted fields/items or subtrees; not a count of all their descendants. */
  omittedFieldCount: number;
  omissionReason?:
    | "unsupported"
    | "oversized"
    | "malformed"
    | "sensitive"
    | "truncated";
}

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 1900; // Leaves room for omission metadata within 2 KiB.
const MAX_NODES = 32;
const MAX_FIELDS = 20;
const MAX_DEPTH = 3;
const MAX_BLOCKED_KEYS = 128;
const encoder = new TextEncoder();
const sensitiveKey =
  /name|address|e[\s_.-]*mail|phone|mobile|password|passwd|passcode|access[\s_.-]*code|private|internal|secret|token|auth|session|cookie|credential|card|cvv|cvc|ssn|social[\s_.-]*security|api[\s_.-]*key|access[\s_.-]*key/i;

/** Bounded decoding detects encoded hints without decoding arbitrarily deep. */
function decoded(value: string): string | undefined {
  let result = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  try {
    for (let pass = 0; pass < 2 && /%[a-f\d]{2}/i.test(result); pass++)
      result = decodeURIComponent(result);
  } catch {
    return;
  }
  return /%[a-f\d]{2}/i.test(result) ? undefined : result;
}

function unsafeKey(key: string, blocked: Set<string>): boolean {
  const inspected = decoded(key);
  if (inspected === undefined) return true;
  const words = inspected
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  return (
    blocked.has(inspected.toLowerCase()) ||
    sensitiveKey.test(inspected) ||
    /(?:^|[\s_.-])(?:id|ids)(?:$|[\s_.-])/i.test(words) ||
    /^(?:__proto__|prototype|constructor)$/i.test(inspected) ||
    !/^[a-z][a-z\d_. -]*$/i.test(key) ||
    sensitiveContent(inspected)
  );
}

function unsafeValue(value: string): boolean {
  const inspected = decoded(value);
  return (
    inspected === undefined ||
    sensitiveContent(inspected) ||
    /^[a-f\d]{16,}$/i.test(inspected) ||
    /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(inspected) ||
    (/^[a-z\d_+=/-]{24,}$/i.test(inspected) &&
      !/^[a-z]+(?:-[a-z]+)+$/.test(inspected))
  );
}

function omitted(
  omissionReason: SanitizedRequestBody["omissionReason"],
): SanitizedRequestBody {
  return { omittedFieldCount: 1, omissionReason };
}

/**
 * Observe only bounded string JSON objects. Never reads streams, forms, binary
 * bodies, custom object properties or Request methods. These heuristics do not
 * anonymize arbitrary prose; private control names/IDs extend the deny list.
 */
export function sanitizeRequestBody(
  body: unknown,
  blockedKeys: Iterable<string> = [],
): SanitizedRequestBody {
  if (typeof body !== "string") return omitted("unsupported");
  if (
    body.length > MAX_INPUT_BYTES ||
    encoder.encode(body).byteLength > MAX_INPUT_BYTES
  )
    return omitted("oversized");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return omitted("malformed");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return omitted("unsupported");

  const blocked = new Set<string>();
  try {
    let count = 0;
    for (const key of blockedKeys) {
      if (
        ++count > MAX_BLOCKED_KEYS ||
        typeof key !== "string" ||
        key.length > 128
      )
        return omitted("truncated");
      const normalized = decoded(key);
      if (normalized === undefined) return omitted("truncated");
      blocked.add(normalized.toLowerCase());
    }
  } catch {
    return omitted("unsupported");
  }

  let nodes = 0;
  let fields = 0;
  let bytes = 0;
  let omittedFieldCount = 0;
  let omissionReason: "sensitive" | "truncated" | undefined;
  function skip(reason: "sensitive" | "truncated", count = 1) {
    omittedFieldCount += count;
    if (omissionReason !== "truncated") omissionReason = reason;
  }
  function reserve(value: unknown): boolean {
    const size = encoder.encode(JSON.stringify(value)).byteLength;
    if (bytes + size > MAX_FIELD_BYTES) {
      skip("truncated");
      return false;
    }
    bytes += size;
    return true;
  }
  function visit(value: unknown, depth: number): RequestBodyValue | undefined {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
      skip("truncated");
      return;
    }
    if (value === null || typeof value === "boolean")
      return reserve(value) ? value : undefined;
    if (typeof value === "string" || typeof value === "number") {
      if (typeof value === "string" && value.length > 1024) {
        skip("truncated");
        return;
      }
      if (
        (typeof value === "number" && !Number.isFinite(value)) ||
        unsafeValue(String(value))
      ) {
        skip("sensitive");
        return;
      }
      return reserve(value) ? value : undefined;
    }
    if (depth >= MAX_DEPTH) {
      skip("truncated");
      return;
    }
    // JSON.parse produces only plain data; prototype-like keys are denied below.
    const entries = Object.entries(value as object);
    const result: RequestBodyValue[] | Record<string, RequestBodyValue> =
      Array.isArray(value) ? [] : {};
    const omissionsBefore = omittedFieldCount;
    if (!reserve(result)) return;
    for (let index = 0; index < entries.length; index++) {
      if (nodes >= MAX_NODES || fields >= MAX_FIELDS) {
        skip("truncated", entries.length - index);
        break;
      }
      const [key, child] = entries[index];
      fields++;
      if (!Array.isArray(result)) {
        if (key.length > 80) {
          skip("truncated");
          continue;
        }
        if (unsafeKey(key, blocked)) {
          skip("sensitive");
          continue;
        }
        if (!reserve(key)) continue;
      }
      // Reserve the property colon and comma (or array separator).
      bytes += 2;
      const safe = visit(child, depth + 1);
      if (safe !== undefined) {
        if (Array.isArray(result)) result.push(safe);
        else result[key] = safe;
      }
    }
    // Compaction changes tuple positions and parallel-array associations. A
    // partially observed array cannot safely represent the submitted structure.
    return Array.isArray(result) && omittedFieldCount > omissionsBefore
      ? undefined
      : result;
  }
  const safe = visit(parsed, 0) as Record<string, RequestBodyValue>;
  return {
    fields: safe,
    omittedFieldCount,
    ...(omissionReason && { omissionReason }),
  };
}
