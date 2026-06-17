import { describe, it, expect, vi } from "vitest";
import { request, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequestHandler, startServer } from "./server.js";
import { UnauthorizedError } from "./auth.js";

describe("createRequestHandler", () => {
  it("returns 401 when verification fails", async () => {
    const verifier = { verify: vi.fn(async () => { throw new UnauthorizedError("bad"); }) };
    const onEvent = vi.fn(async () => ({}));
    const handler = createRequestHandler({ verifier, onEvent });
    const res = await handler({ headers: { authorization: "Bearer x" }, body: { type: "MESSAGE" } });
    expect(res.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("verifies then dispatches and returns 200 with the event result", async () => {
    const verifier = { verify: vi.fn(async () => {}) };
    const onEvent = vi.fn(async () => ({ text: "sync-reply" }));
    const handler = createRequestHandler({ verifier, onEvent });
    const res = await handler({ headers: { authorization: "Bearer ok" }, body: { type: "MESSAGE" } });
    expect(verifier.verify).toHaveBeenCalledWith("Bearer ok");
    expect(res).toEqual({ status: 200, body: { text: "sync-reply" } });
  });
});

// Find a free port by briefly binding an ephemeral listener and releasing it.
async function getFreePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function post(port: number, body: Buffer): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method: "POST", path: "/", headers: { "Content-Length": body.length } },
      (res: IncomingMessage) => {
        res.resume(); // drain so the socket can close
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    // The server may abort the connection after responding 413; treat a reset
    // after we already saw a response as non-fatal, otherwise reject.
    let responded = false;
    req.on("response", () => { responded = true; });
    req.on("error", (e) => { if (!responded) reject(e); });
    req.end(body);
  });
}

describe("startServer body-size limit", () => {
  it("rejects oversized request bodies with 413 before invoking the handler", async () => {
    const handler = vi.fn<ChatRequestHandlerForTest>(async () => ({ status: 200, body: {} }));
    const port = await getFreePort();
    const server = startServer({ port, handler, maxBodyBytes: 1024 });
    try {
      const oversized = Buffer.alloc(4096, 0x61); // 4 KiB > 1 KiB limit
      const res = await post(port, oversized);
      expect(res.status).toBe(413);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it("accepts a body under the limit and reaches the handler", async () => {
    const handler = vi.fn<ChatRequestHandlerForTest>(async () => ({ status: 200, body: { ok: true } }));
    const port = await getFreePort();
    const server = startServer({ port, handler, maxBodyBytes: 1024 });
    try {
      const res = await post(port, Buffer.from(JSON.stringify({ type: "MESSAGE" })));
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      await server.close();
    }
  });

  it("responds 500 and logs when the handler throws", async () => {
    const boom = new Error("handler boom");
    const handler = vi.fn<ChatRequestHandlerForTest>(async () => { throw boom; });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const port = await getFreePort();
    const server = startServer({ port, handler, maxBodyBytes: 1024 });
    try {
      const res = await post(port, Buffer.from(JSON.stringify({ type: "MESSAGE" })));
      expect(res.status).toBe(500);
      expect(handler).toHaveBeenCalledOnce();
      expect(errSpy).toHaveBeenCalledWith("[bot-google-chat] request handler failed:", boom);
    } finally {
      errSpy.mockRestore();
      await server.close();
    }
  });
});

type ChatRequestHandlerForTest = (req: {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}) => Promise<{ status: number; body?: unknown }>;
