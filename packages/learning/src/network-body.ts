import { TEXT_LIMIT } from "./redact";
import type { Redactor } from "./redact";

/** A bounded observation of a body; never the stream returned to the app. */
export interface BodySnapshot {
  status:
    | "complete"
    | "empty"
    | "truncated"
    | "unavailable"
    | "interrupted"
    | "timeout";
  text?: string;
  encoding?: "utf-8" | "base64";
  truncated?: true;
  reason?: string;
}

const BODY_BYTES = 4096;
const READ_TIMEOUT_MS = 1000;
const encoder = new TextEncoder();
const redactionFailed = (): BodySnapshot => ({
  status: "unavailable",
  reason: "redaction-failed",
});
type RedactText = (text: string) => string | undefined;

/** Redacts up to TEXT_LIMIT bytes of text first, then cuts the result to BODY_BYTES. */
function snapshot(
  bytes: Uint8Array,
  status: BodySnapshot["status"],
  contentType: string,
  redact: RedactText,
  reason?: string,
): BodySnapshot {
  let text: string | undefined;
  if (!isBinary(contentType))
    try {
      // Declared text decodes lossily so it is always redacted; untyped bytes
      // that are not UTF-8 are treated as binary.
      text = new TextDecoder("utf-8", { fatal: !contentType }).decode(bytes, {
        stream: status !== "complete",
      });
    } catch {
      /* Not UTF-8: keep the bytes as base64. */
    }
  if (text !== undefined) {
    text = redact(text);
    if (text === undefined) return redactionFailed();
    // PostgreSQL jsonb rejects NUL in strings; base64 retains the redacted bytes.
    if (text.includes("\0")) {
      bytes = encoder.encode(text);
      text = undefined;
    }
  }
  const binary = text === undefined;
  // Binary bodies are not inspected; only their first bytes are kept.
  text ??= btoa(String.fromCharCode(...bytes.subarray(0, BODY_BYTES)));
  const result: BodySnapshot = {
    status: status === "complete" && bytes.length === 0 ? "empty" : status,
    text,
    encoding: binary ? "base64" : "utf-8",
    ...(reason ? { reason } : {}),
  };
  if (encoder.encode(JSON.stringify(result)).length <= BODY_BYTES)
    return result;
  result.status = status === "complete" ? "truncated" : status;
  result.truncated = true;
  // Bound the serialized field too: quotes/control characters expand in JSON.
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    result.text = text.slice(0, middle);
    if (encoder.encode(JSON.stringify(result)).length <= BODY_BYTES)
      low = middle;
    else high = middle - 1;
  }
  if (binary)
    low -= low % 4; // Keep complete base64 groups.
  else if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!)) low--;
  result.text = text.slice(0, low);
  return result;
}

function snapshotText(
  value: string,
  redact: RedactText,
  status: BodySnapshot["status"] = "complete",
  reason?: string,
): BodySnapshot {
  return snapshot(
    encoder.encode(value.slice(0, TEXT_LIMIT)),
    value.length > TEXT_LIMIT && status === "complete" ? "truncated" : status,
    "text/plain",
    redact,
    reason,
  );
}

function isBinary(contentType: string) {
  return (
    contentType !== "" &&
    !/(^text\/|json|xml|javascript|graphql|x-www-form-urlencoded|multipart\/form-data)/i.test(
      contentType,
    )
  );
}

/** Cancel only cloned/synthetic bodies. Cancelling a tee may wait for the app's branch. */
export function createBodyCapture(redact: Redactor) {
  const cancellations = new Set<() => void>();
  let active = true;
  const read = (
    stream: ReadableStream<Uint8Array> | null,
    contentType = "",
  ): Promise<BodySnapshot> => {
    if (!stream) return Promise.resolve({ status: "empty" });
    if (!active)
      return Promise.resolve({
        status: "unavailable",
        reason: "capture-stopped",
      });
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = stream.getReader();
    } catch {
      return Promise.resolve({ status: "unavailable", reason: "body-locked" });
    }
    return new Promise((resolve) => {
      const bytes = new Uint8Array(TEXT_LIMIT);
      let length = 0;
      let finished = false;
      const finish = (status: BodySnapshot["status"], reason?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cancellations.delete(cancel);
        resolve(
          snapshot(
            bytes.subarray(0, length),
            status,
            contentType,
            redact.body,
            reason,
          ),
        );
        // Do not await cancellation: a cloned fetch stream can share a live SSE source.
        void reader.cancel().catch(() => {});
      };
      const cancel = () => finish("interrupted", "capture-stopped");
      const timer = setTimeout(
        () => finish("timeout", "body-read-timeout"),
        READ_TIMEOUT_MS,
      );
      cancellations.add(cancel);
      void (async () => {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (finished) break;
            if (chunk.done) {
              finish("complete");
              break;
            }
            const kept = chunk.value.subarray(0, TEXT_LIMIT - length);
            bytes.set(kept, length);
            length += kept.length;
            if (length === TEXT_LIMIT) {
              finish("truncated");
              break;
            }
          }
        } catch {
          finish("interrupted", "body-read-failed");
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* A cancelled read may still be settling. */
          }
        }
      })();
    });
  };
  const body = (
    value: BodyInit | null | undefined,
    contentType = "",
  ): Promise<BodySnapshot> => {
    try {
      if (value == null) return Promise.resolve({ status: "empty" });
      if (value instanceof URLSearchParams) value = value.toString();
      if (typeof value === "string")
        return Promise.resolve(snapshotText(value, redact.body));
      if (
        typeof ReadableStream !== "undefined" &&
        value instanceof ReadableStream
      ) {
        // A caller-owned init.body cannot be teed without locking/replacing it.
        return Promise.resolve({
          status: "unavailable",
          reason: "caller-owned-stream",
        });
      }
      if (value instanceof FormData) {
        const form = new FormData();
        value.forEach((field, key) =>
          form.append(
            key,
            typeof field === "string" ? redact.field(key, field) : field,
          ),
        );
        value = form;
      }
      const response = new Response(value);
      return read(
        response.body,
        contentType || response.headers.get("content-type") || "",
      );
    } catch {
      return Promise.resolve({
        status: "unavailable",
        reason: "body-not-readable",
      });
    }
  };
  return {
    read,
    body,
    text: (value: string, status?: BodySnapshot["status"], reason?: string) =>
      snapshotText(value, redact.body, status, reason),
    stop() {
      active = false;
      for (const cancel of cancellations) cancel();
    },
  };
}
