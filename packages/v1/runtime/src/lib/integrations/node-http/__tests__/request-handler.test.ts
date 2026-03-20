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
    const stream = makeStream();

    stream.push('{"foo":"bar"}');
    stream.push(null);
    (stream as any).complete = true;

    await new Promise((r) => setImmediate(r));

    expect(isStreamConsumed(stream)).toBe(false);
  });

  it("returns true after the stream is fully drained by application code", async () => {
    const stream = makeStream();

    stream.push('{"foo":"bar"}');
    stream.push(null);

    await drainStream(stream);

    expect(isStreamConsumed(stream)).toBe(true);
  });

  it("returns false when stream has data but has not been read yet", () => {
    const stream = makeStream();
    stream.push('{"foo":"bar"}');

    expect(isStreamConsumed(stream)).toBe(false);
  });
});
