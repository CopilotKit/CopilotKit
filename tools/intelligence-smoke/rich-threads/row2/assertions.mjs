import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";

import { categories } from "../contract.mjs";
export { categories };

export function atPointer(value, pointer) {
  if (pointer === "") return value;
  if (typeof pointer !== "string" || !pointer.startsWith("/"))
    throw new Error("JSON pointer required");
  for (const token of pointer.slice(1).split("/")) {
    if (/~(?![01])/u.test(token))
      throw new Error("Invalid JSON pointer escape");
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
      return undefined;
    value = value[key];
  }
  return value;
}

function decodeBytes(value, encoding) {
  if (encoding === "data-uri") {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/_=-]*)$/.exec(
      value ?? "",
    );
    if (!match) throw new Error("Invalid native data URI");
    return { bytes: decodeBytes(match[2], "base64").bytes, mime: match[1] };
  }
  if (encoding === "base64") {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value) ||
      value.replace(/=+$/, "").length % 4 === 1
    )
      throw new Error("Invalid native base64");
    return { bytes: Buffer.from(value, "base64url") };
  }
  if (
    encoding === "byte-array" &&
    Array.isArray(value) &&
    value.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
  )
    return { bytes: Buffer.from(value) };
  throw new Error("Unsupported native byte encoding");
}

/** Media pointers share one complete message envelope, including sibling sidecars. */
export function compareMedia(envelope, observation) {
  const payload = atPointer(envelope, observation.bytes.pointer);
  if (payload === undefined)
    throw new Error(
      `Missing native media bytes at ${observation.bytes.pointer}`,
    );
  const { bytes, mime: embeddedMime } = decodeBytes(
    payload,
    observation.bytes.encoding,
  );
  let mime =
    observation.mimePointer === undefined
      ? embeddedMime
      : atPointer(envelope, observation.mimePointer);
  if (observation.mimeEncoding === "format")
    mime = {
      png: "image/png",
      jpeg: "image/jpeg",
      pdf: "application/pdf",
      wav: "audio/wav",
      mp4: "video/mp4",
    }[mime];
  const filename = atPointer(envelope, observation.filenamePointer);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    passed:
      (embeddedMime === undefined || embeddedMime === mime) &&
      sha256 === observation.expected.sha256 &&
      bytes.length === observation.expected.byteLength &&
      mime === observation.expected.mime &&
      filename === observation.expected.filename,
    observed: {
      sha256,
      byteLength: bytes.length,
      mime: mime ?? null,
      filename: filename ?? null,
    },
  };
}

/** Pure comparison: expectations come from captured inputs/events, never native output. */
export function compareCapture(capture) {
  const { before, after, observations, provenance, identity } = capture;
  if (
    !identity?.threadId ||
    !provenance?.input ||
    !provenance?.events ||
    !provenance?.fixture
  )
    throw new Error(
      "Native capture requires identity and input/event/fixture provenance",
    );
  if (
    !["sqlite", "file", "postgres"].includes(after?.kind) ||
    !after.location ||
    /:memory:/i.test(after.location)
  )
    throw new Error("Row2 requires an identified durable native store");
  if (
    !before?.records ||
    Object.entries(before.records ?? {}).some(([key, value]) => {
      // Resource-scoped memory is deliberately shared by fresh conversations
      // in the same owned application scope. Lifecycle verifies it empty once
      // before the suite; retain its full before/after records for comparison.
      if (
        key === "resources" &&
        capture.freshness?.cleanScope?.status === "passed" &&
        capture.freshness?.evidence
      )
        return false;
      return Array.isArray(value) ? value.length > 0 : value !== null;
    })
  )
    throw new Error("Fresh native identity must be absent before the run");
  if (!Array.isArray(observations) || !observations.length)
    throw new Error("Native observations required");
  const names = new Set();
  return observations.map((observation) => {
    if (
      !categories.includes(observation.category) ||
      !observation.name ||
      names.has(observation.name)
    )
      throw new Error("Unique named category observation required");
    names.add(observation.name);
    if (
      !observation.source?.artifact ||
      typeof observation.source.pointer !== "string"
    )
      throw new Error("Input/event source pointer required");
    const record = after.records[observation.record];
    let passed = false;
    let detail;
    try {
      const actual = observation.pointers
        ? observation.pointers.map((pointer) => atPointer(record, pointer))
        : atPointer(record, observation.pointer);
      if (observation.media) {
        const comparison = compareMedia(actual, observation.media);
        passed = comparison.passed;
        detail = JSON.stringify(comparison.observed);
      } else {
        if (observation.expected === undefined)
          throw new Error("Explicit non-undefined expected value required");
        passed = isDeepStrictEqual(actual, observation.expected);
        detail = passed
          ? "Exact native value/order match"
          : `Mismatch at ${observation.record}${observation.pointer}`;
      }
    } catch (error) {
      detail = error.message;
    }
    return {
      name: observation.name,
      category: observation.category,
      status: passed ? "passed" : "failed",
      detail,
      source: observation.source,
    };
  });
}

export function coverageChecks(coverage, comparisons) {
  for (const [category, declaration] of Object.entries(coverage ?? {})) {
    if (!categories.includes(category))
      throw new Error(`Unknown coverage category: ${category}`);
    if (
      declaration.required &&
      (!Array.isArray(declaration.required) ||
        declaration.required.some(
          (name) => typeof name !== "string" || !name.trim(),
        ) ||
        new Set(declaration.required).size !== declaration.required.length)
    )
      throw new Error(`Invalid required observations: ${category}`);
  }
  return categories.map((category) => {
    const declared = coverage?.[category];
    const actual = comparisons.filter((check) => check.category === category);
    if (
      declared?.status === "not-applicable" ||
      declared?.status === "source-limitation"
    ) {
      if (!declared.reason || !declared.evidence?.length || actual.length)
        throw new Error(`Invalid exclusion: ${category}`);
      return {
        name: category,
        status: "not-applicable",
        detail: `${declared.status}: ${declared.reason}`,
        evidence: declared.evidence,
      };
    }
    const required = declared?.required;
    const complete =
      Array.isArray(required) &&
      required.length > 0 &&
      required.every((name) => actual.some((check) => check.name === name));
    return {
      name: category,
      status: actual.some((check) => check.status === "failed")
        ? "failed"
        : complete
          ? "passed"
          : "unvalidated",
      evidence: [],
      detail: complete
        ? `${actual.length} native comparisons`
        : "Applicable category lacks its declared required observations",
    };
  });
}
