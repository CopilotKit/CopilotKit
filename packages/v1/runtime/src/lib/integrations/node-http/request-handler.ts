import type { IncomingMessage } from "http";
import { Readable } from "node:stream";

export type IncomingWithBody = IncomingMessage & { body?: unknown; complete?: boolean };

export function readableStreamToNodeStream(webStream: ReadableStream): Readable {
  const reader = webStream.getReader();

  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer.from(value));
        }
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });
}

export function nodeStreamToReadableStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk) => {
        controller.enqueue(chunk instanceof Buffer ? new Uint8Array(chunk) : chunk);
      });
      nodeStream.on("end", () => {
        controller.close();
      });
      nodeStream.on("error", (err) => {
        controller.error(err);
      });
    },
    cancel() {
      nodeStream.destroy();
    },
  });
}

export function getFullUrl(req: IncomingMessage): string {
  // Use req.url (path relative to mount point) for Hono routing to work correctly.
  // Express sets req.url to the path after the mount point (e.g., "/" when mounted at "/copilotkit").
  // Pure Node HTTP sets req.url to the full path.
  const path = req.url || "/";
  const host =
    (req.headers["x-forwarded-host"] as string) || (req.headers.host as string) || "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    ((req.socket as any).encrypted ? "https" : "http");

  return `${proto}://${host}${path}`;
}

export function toHeaders(rawHeaders: IncomingMessage["headers"]): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(key, entry));
      continue;
    }

    headers.append(key, value);
  }

  return headers;
}

export function isStreamConsumed(req: IncomingWithBody): boolean {
  const readableState = (req as any)._readableState;

  return Boolean(
    req.readableEnded || req.complete || readableState?.ended || readableState?.endEmitted,
  );
}

export function synthesizeBodyFromParsedBody(
  parsedBody: unknown,
  headers: Headers,
): { body: BodyInit | null; contentType?: string } {
  if (parsedBody === null || parsedBody === undefined) {
    return { body: null };
  }

  if (parsedBody instanceof Buffer || parsedBody instanceof Uint8Array) {
    return { body: parsedBody };
  }

  if (typeof parsedBody === "string") {
    return { body: parsedBody, contentType: headers.get("content-type") ?? "text/plain" };
  }

  return {
    body: JSON.stringify(parsedBody),
    contentType: "application/json",
  };
}

export function isDisturbedOrLockedError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    typeof error.message === "string" &&
    (error.message.includes("disturbed") || error.message.includes("locked"))
  );
}
