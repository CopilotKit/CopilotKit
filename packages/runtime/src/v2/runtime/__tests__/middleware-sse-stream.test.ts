import { logger } from "@copilotkit/shared";
import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { parseSSEResponse } from "../core/middleware-sse-parser";

const encoder = new TextEncoder();
const runStarted = {
  type: "RUN_STARTED",
  threadId: "thread-1",
  runId: "run-1",
};
const sseHeaders = { "Content-Type": "text/event-stream" };

/** Build a closed byte stream while retaining the supplied chunk boundaries. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("incremental SSE middleware parsing", () => {
  it("parses complete event lines before the stream ends", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
      }),
      { headers: sseHeaders },
    );
    const event = JSON.stringify(runStarted);
    const parse = vi.spyOn(JSON, "parse");
    const parsing = parseSSEResponse(response);

    try {
      controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      await vi.waitFor(() => expect(parse).toHaveBeenCalledWith(event));
      expect(response.bodyUsed).toBe(true);
      expect(response.body?.locked).toBe(true);
    } finally {
      controller.close();
      parse.mockRestore();
      await parsing;
    }
  });

  it.each([1, 7, 1024])(
    "preserves raw bytes and parses UTF-8, CRLF and the final line with %i-byte chunks",
    async (chunkSize) => {
      const content = "你好🙂\nnext";
      const textEvent = {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "message-1",
        delta: content,
      };
      // The invalid UTF-8 byte is in a comment; neither it nor the BOM may
      // change in the response returned to the callback.
      const bytes = new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        0x3a,
        0x20,
        0xff,
        ...encoder.encode(
          `\r\n\r\ndata: ${JSON.stringify(runStarted)}\r\n\r\ndata: ${JSON.stringify(textEvent)}`,
        ),
      ]);
      const chunks = [];
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        chunks.push(bytes.subarray(offset, offset + chunkSize));
      }
      const response = new Response(streamOf(chunks), {
        status: 202,
        statusText: "Accepted",
        headers: { ...sseHeaders, "X-Test": "retained" },
      });

      const result = await parseSSEResponse(response);

      expect(result.messages).toEqual([
        { id: "message-1", role: "assistant", content },
      ]);
      expect(result.threadId).toBe("thread-1");
      expect(result.runId).toBe("run-1");
      expect(result.response.bodyUsed).toBe(false);
      expect(result.response.status).toBe(202);
      expect(result.response.statusText).toBe("Accepted");
      expect([...result.response.headers]).toEqual([...response.headers]);
      expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(
        bytes,
      );
    },
  );

  it("retains only the bytes inside a chunk's subarray view", async () => {
    const bytes = encoder.encode(`data: ${JSON.stringify(runStarted)}\n\n`);
    const backing = new Uint8Array([0x01, 0x02, ...bytes, 0x03, 0x04]);
    const response = new Response(
      streamOf([backing.subarray(2, backing.length - 2)]),
      { headers: sseHeaders },
    );

    const result = await parseSSEResponse(response);

    expect(result.threadId).toBe("thread-1");
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(bytes);
  });

  it("retains bytes when a Node stream reuses its Buffer", async () => {
    const body = `data: ${JSON.stringify(runStarted)}\n\n`;
    const chunk = Buffer.from(body);
    let sent = false;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(chunk);
            } else {
              chunk.fill(0x78);
              controller.close();
            }
          },
        },
        { highWaterMark: 0 },
      ),
      { headers: sseHeaders },
    );

    const result = await parseSSEResponse(response);

    expect(result.threadId).toBe("thread-1");
    expect(await result.response.text()).toBe(body);
  });

  it.each([204, 205, 304])(
    "preserves an SSE response with no body and status %i",
    async (status) => {
      const response = new Response(null, { status, headers: sseHeaders });

      const result = await parseSSEResponse(response);

      expect(result.messages).toEqual([]);
      expect(result.response).toBe(response);
      expect(result.response.body).toBeNull();
      expect(result.response.bodyUsed).toBe(false);
    },
  );

  it("discards partial metadata and retains a stream read failure", async () => {
    const error = new Error("SSE connection lost after RUN_STARTED");
    let sent = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(runStarted)}\n\n`),
            );
          } else {
            controller.error(error);
          }
        },
      }),
      { headers: sseHeaders },
    );
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    try {
      const result = await parseSSEResponse(response);

      expect(result.messages).toEqual([]);
      expect(result.threadId).toBeUndefined();
      expect(result.runId).toBeUndefined();
      expect(result.response.bodyUsed).toBe(false);
      await expect(result.response.text()).rejects.toBe(error);
      expect(warn).toHaveBeenCalledWith(
        "Failed to read SSE response body in afterRequestMiddleware",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves non-SSE responses untouched and unread", async () => {
    const body = JSON.stringify({ version: "1.0" });
    const response = new Response(body, {
      headers: { "Content-Type": "application/json" },
    });

    const result = await parseSSEResponse(response);

    expect(result.messages).toEqual([]);
    expect(result.response).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe(body);
  });
});
