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

function snapshot(
  bytes: Uint8Array,
  status: BodySnapshot["status"],
  binary: boolean,
  redact: RedactText,
  reason?: string,
): BodySnapshot {
  let text: string | undefined;
  if (!binary)
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
        stream: status !== "complete",
      });
    } catch {
      /* Not UTF-8: keep the bytes as base64. */
    }
  if (text !== undefined) {
    // Redact the whole read before the size limit can cut a value.
    text = redact(text);
    if (text === undefined) return redactionFailed();
    // PostgreSQL jsonb rejects NUL in strings; base64 retains the redacted bytes.
    if (text.includes("\0")) {
      bytes = encoder.encode(text);
      text = undefined;
    }
  }
  if (text === undefined) {
    binary = true;
    text = btoa(String.fromCharCode(...bytes));
  }
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
  // Redact the full text before truncation so a cut cannot expose a value's prefix.
  const text = redact(value);
  if (text === undefined) return redactionFailed();
  let prefix = text.slice(0, BODY_BYTES);
  if (
    prefix.length < text.length &&
    /[\uD800-\uDBFF]/.test(prefix.at(-1) ?? "")
  )
    prefix = prefix.slice(0, -1);
  const bytes = encoder.encode(prefix);
  const truncated = text.length > prefix.length || bytes.length > BODY_BYTES;
  return snapshot(
    bytes.subarray(0, BODY_BYTES),
    truncated && status === "complete" ? "truncated" : status,
    false,
    String,
    reason,
  );
}

function isBinary(contentType: string) {
  return (
    contentType !== "" &&
    !/(^text\/|json|xml|javascript|x-www-form-urlencoded|multipart\/form-data)/i.test(
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
      const bytes = new Uint8Array(BODY_BYTES);
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
            isBinary(contentType),
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
            const kept = chunk.value.subarray(0, BODY_BYTES - length);
            bytes.set(kept, length);
            length += kept.length;
            if (length === BODY_BYTES) {
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
