import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, it, expect } from "vitest";
import { isStreamConsumed } from "../request-handler";
import type { IncomingWithBody } from "../request-handler";

/**
 * Tests for OSS-610 (originally diagnosed in #3489 by @AlexNti).
 *
 * `isStreamConsumed` decides whether the node-http handler streams the request
 * body upstream or rebuilds it from `req.body`. When it says "consumed" but no
 * parsed body exists, the handler forwards an empty payload — which is what
 * broke Next.js pages-router apps running with `bodyParser: false`.
 */

function makeStream(): IncomingWithBody {
  return new Readable({ read() {} }) as unknown as IncomingWithBody;
}

function drainStream(stream: Readable): Promise<void> {
  return new Promise((resolve) => {
    stream.resume();
    stream.on("end", resolve);
  });
}

describe("isStreamConsumed", () => {
  it("returns false for a fresh, unread stream", () => {
    expect(isStreamConsumed(makeStream())).toBe(false);
  });

  it("returns false when the stream has buffered data that has not been read", () => {
    const stream = makeStream();
    stream.push('{"foo":"bar"}');

    expect(isStreamConsumed(stream)).toBe(false);
  });

  it("returns false when EOF was pushed and `complete` is set but nothing was read (async framework)", async () => {
    const stream = makeStream();

    // What the HTTP parser leaves behind once all network bytes have arrived:
    // data buffered, EOF queued, `complete` flipped — none of which means the
    // handler has read anything.
    stream.push('{"foo":"bar"}');
    stream.push(null);
    (stream as any).complete = true;

    // The event-loop tick that Next.js pages-router routing introduces between
    // the socket read and the route handler.
    await new Promise((resolve) => setImmediate(resolve));

    expect(isStreamConsumed(stream)).toBe(false);
  });

  it("returns true once application code has drained the stream to end", async () => {
    const stream = makeStream();
    stream.push('{"foo":"bar"}');
    stream.push(null);

    await drainStream(stream);

    expect(isStreamConsumed(stream)).toBe(true);
  });
});

describe("isStreamConsumed over a real http.IncomingMessage", () => {
  async function withServer(
    handler: (req: IncomingWithBody) => Promise<unknown>,
  ): Promise<unknown> {
    let captured: unknown;
    const server: Server = createServer((req, res) => {
      handler(req as IncomingWithBody)
        .then((value) => {
          captured = value;
          res.statusCode = 200;
          res.end();
        })
        .catch(() => {
          res.statusCode = 500;
          res.end();
        });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"foo":"bar"}',
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    return captured;
  }

  it("reports an unread body as not consumed after async routing, and the body is still readable", async () => {
    const result = (await withServer(async (req) => {
      // Give the HTTP parser time to receive every byte and set `complete`,
      // exactly as an async routing layer would before dispatching.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const consumedBefore = isStreamConsumed(req);

      let body = "";
      for await (const chunk of req) body += chunk;

      return { consumedBefore, body, consumedAfter: isStreamConsumed(req) };
    })) as { consumedBefore: boolean; body: string; consumedAfter: boolean };

    // Pre-fix this was `true` (via `req.complete` / `_readableState.ended`), so
    // the handler skipped the streaming path and sent an empty payload.
    expect(result.consumedBefore).toBe(false);
    // Proof the body really was still there to stream.
    expect(result.body).toBe('{"foo":"bar"}');
    expect(result.consumedAfter).toBe(true);
  });
});
