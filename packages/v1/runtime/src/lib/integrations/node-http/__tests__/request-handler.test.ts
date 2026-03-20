import { Readable } from "node:stream";
import { describe, it, expect } from "vitest";
import { isStreamConsumed, type IncomingWithBody } from "../request-handler";

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
    const stream = makeStream();
    expect(isStreamConsumed(stream)).toBe(false);
  });

  it("returns false after an async tick with data in buffer (async framework scenario)", async () => {
    // This is the regression test for Next.js pages router + bodyParser:false.
    //
    // The Node.js HTTP parser sets req.complete and _readableState.ended
    // synchronously when all bytes arrive. In async frameworks (Next.js pages
    // router, etc.) at least one event loop tick passes before the handler
    // runs, so by then complete=true and ended=true — but the data is still
    // unread in _readableState.buffer.
    //
    // The old implementation checked req.complete and _readableState.ended,
    // which caused a false positive here, skipping the streaming path and
    // sending an empty body to Hono.
    const stream = makeStream();

    // Simulate HTTP parser pushing bytes and signaling end-of-message
    stream.push('{"foo":"bar"}');
    stream.push(null); // sets _readableState.ended = true
    (stream as any).complete = true; // mirrors req.complete = true

    // Yield to the event loop (mirrors async routing in Next.js)
    await new Promise((r) => setImmediate(r));

    // Data is still in the buffer — stream is NOT consumed
    expect(stream.readableEnded).toBe(false);
    expect(isStreamConsumed(stream)).toBe(false);
  });

  it("returns true after the stream is fully drained by application code", async () => {
    const stream = makeStream();

    stream.push('{"foo":"bar"}');
    stream.push(null);

    await drainStream(stream);

    expect(stream.readableEnded).toBe(true);
    expect(isStreamConsumed(stream)).toBe(true);
  });

  it("returns false when stream has data but has not been read yet", () => {
    const stream = makeStream();
    stream.push('{"foo":"bar"}');

    expect(isStreamConsumed(stream)).toBe(false);
  });

  it("returns false on an empty stream that has not been ended", () => {
    const stream = makeStream();
    expect(isStreamConsumed(stream)).toBe(false);
  });
});
