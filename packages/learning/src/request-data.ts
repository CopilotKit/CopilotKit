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
  /** Enumeration stopped before all fields could be counted. */
  omittedFieldCountIsLowerBound?: true;
  omissionReason?:
    | "unsupported"
    | "oversized"
    | "malformed"
    | "sensitive"
    | "truncated";
}

export interface SanitizedResponseBody extends SanitizedRequestBody {
  /** Array positions are preserved; an incomplete array is omitted whole. */
  items?: RequestBodyValue[];
}

export type ObjectReference = (value: string | number) => string | undefined;

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

function identifierKey(key: string): boolean {
  const words = key
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  return /(?:^|[\s_.-])(?:id|ids)(?:$|[\s_.-])/i.test(words);
}

function unsafeKey(
  key: string,
  blocked: Set<string>,
  allowReference: boolean,
): boolean {
  const inspected = decoded(key);
  if (inspected === undefined) return true;
  return (
    blocked.has(inspected.toLowerCase()) ||
    sensitiveKey.test(inspected) ||
    (!allowReference && identifierKey(inspected)) ||
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
  reference?: ObjectReference,
): SanitizedRequestBody {
  const parsed = parseBody(body);
  if ("omittedFieldCount" in parsed) return parsed;
  if (Array.isArray(parsed.value)) return omitted("unsupported");
  return sanitizeParsed(parsed.value, blockedKeys, reference);
}

/** Only JSON consumed by the application is considered; plain text is omitted. */
export function sanitizeResponseBody(
  body: unknown,
  format: "json" | "text",
  blockedKeys: Iterable<string> = [],
  reference?: ObjectReference,
): SanitizedResponseBody {
  if (format === "text") {
    const parsed = parseBody(body);
    if ("omittedFieldCount" in parsed) return parsed;
    body = parsed.value;
  }
  if (body === null || typeof body !== "object") return omitted("unsupported");
  return sanitizeParsed(body, blockedKeys, reference);
}

function parseBody(body: unknown): { value: object } | SanitizedRequestBody {
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
  if (parsed === null || typeof parsed !== "object")
    return omitted("unsupported");
  return { value: parsed };
}

function sanitizeParsed(
  parsed: object,
  blockedKeys: Iterable<string>,
  reference?: ObjectReference,
): SanitizedResponseBody {
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
  let omittedFieldCountIsLowerBound = false;
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
    if (typeof value !== "object" || value === null) {
      skip("sensitive");
      return;
    }
    // Response.json() may be wrapped by application instrumentation. Read only
    // own data descriptors, never getters, toJSON, iterators or class methods.
    const keys: string[] = [];
    try {
      const prototype = Object.getPrototypeOf(value);
      if (
        prototype !== null &&
        prototype !== Object.prototype &&
        !(Array.isArray(value) && prototype === Array.prototype)
      ) {
        skip("sensitive");
        return;
      }
      const limit = Math.min(MAX_FIELDS - fields, MAX_NODES - nodes);
      const arrayLength: unknown = Array.isArray(value)
        ? Object.getOwnPropertyDescriptor(value, "length")?.value
        : undefined;
      if (
        Array.isArray(value) &&
        (typeof arrayLength !== "number" || !Number.isSafeInteger(arrayLength))
      ) {
        skip("sensitive");
        return;
      }
      if (typeof arrayLength === "number" && arrayLength > limit) {
        // Reject the whole array without allocating a key list proportional to
        // a large response. Its own data length gives an exact omitted count.
        skip("truncated", arrayLength);
        return;
      }
      let inspected = 0;
      for (const key in value) {
        // Avoid Object.keys/entries/descriptors, which copy every key before the
        // visitor's budget can take effect. Do not claim an exact unseen count.
        if (inspected++ >= limit) {
          omittedFieldCountIsLowerBound = true;
          skip("truncated");
          break;
        }
        if (Object.prototype.hasOwnProperty.call(value, key)) keys.push(key);
      }
      if (typeof arrayLength === "number" && arrayLength !== keys.length) {
        skip("sensitive");
        return;
      }
    } catch {
      skip("sensitive");
      return;
    }
    const result: RequestBodyValue[] | Record<string, RequestBodyValue> =
      Array.isArray(value) ? [] : {};
    const omissionsBefore = omittedFieldCount;
    if (!reserve(result)) return;
    for (let index = 0; index < keys.length; index++) {
      if (nodes >= MAX_NODES || fields >= MAX_FIELDS) {
        skip("truncated", keys.length - index);
        break;
      }
      const key = keys[index];
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(value, key);
      } catch {
        /* Unreadable fields stay opaque. */
      }
      fields++;
      if (!descriptor || !("value" in descriptor)) {
        skip("sensitive");
        continue;
      }
      const child: unknown = descriptor.value;
      if (!Array.isArray(result)) {
        if (key.length > 80) {
          skip("truncated");
          continue;
        }
        if (unsafeKey(key, blocked, reference !== undefined)) {
          skip("sensitive");
          continue;
        }
        if (!reserve(key)) continue;
      } else if (key !== String(index)) {
        // Sparse arrays or application-added properties cannot be represented
        // as a faithful JSON tuple by compacting the remaining entries.
        skip("sensitive");
        continue;
      }
      // Reserve the property colon and comma (or array separator).
      bytes += 2;
      if (!Array.isArray(result) && identifierKey(key) && reference) {
        let token: string | undefined;
        if (typeof child === "string" || typeof child === "number") {
          try {
            token = reference(child);
          } catch {
            /* A failed identity observer must not expose the raw identifier. */
          }
        }
        if (!token || !/^object-[1-9]\d{0,2}$/.test(token)) {
          skip("sensitive");
          continue;
        }
        const safe = { reference: token };
        if (reserve(safe)) result[key] = safe;
        continue;
      }
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
  const safe = visit(parsed, 0);
  return {
    ...(Array.isArray(parsed)
      ? { items: safe as RequestBodyValue[] | undefined }
      : { fields: safe as Record<string, RequestBodyValue> | undefined }),
    omittedFieldCount,
    ...(omittedFieldCountIsLowerBound
      ? { omittedFieldCountIsLowerBound: true as const }
      : {}),
    ...(omissionReason && { omissionReason }),
  };
}
