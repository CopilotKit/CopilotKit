import { describe, it, expect, vi } from "vitest";
import { request } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { createNodeListener, createRequestHandler } from "./server.js";
import { UnauthorizedError } from "./auth.js";

describe("createRequestHandler", () => {
  it("returns 401 when verification fails", async () => {
    const verifier = {
      verify: vi.fn(async () => {
        throw new UnauthorizedError("bad");
      }),
    };
    const onEvent = vi.fn(async () => {});
    const handler = createRequestHandler({ verifier, onEvent });
    const res = await handler({
      headers: { authorization: "Bearer x" },
      body: { type: "MESSAGE" },
    });
    expect(res.status).toBe(401);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("acknowledges at once and handles the event in the background", async () => {
    const verifier = { verify: vi.fn(async () => {}) };
    let finish!: () => void;
    const onEvent = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    const handler = createRequestHandler({ verifier, onEvent });
    const res = await handler({
      headers: { authorization: "Bearer ok" },
      body: { type: "MESSAGE" },
    });
    expect(verifier.verify).toHaveBeenCalledWith("Bearer ok");
    expect(onEvent).toHaveBeenCalledWith({ type: "MESSAGE" });
    // The response did not wait for the (still pending) event handling.
    expect(res).toEqual({ status: 200, body: {} });
    finish();
  });

  it("logs a failed background event instead of failing the response", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createRequestHandler({
      verifier: { verify: async () => {} },
      onEvent: async () => {
        throw new Error("boom");
      },
    });
    const res = await handler({ headers: {}, body: {} });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

async function listen(handler: ChatRequestHandlerForTest) {
  const server = createServer(
    createNodeListener({ handler, maxBodyBytes: 1024 }),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as AddressInfo).port };
}

function post(port: number, body: Buffer): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/",
        headers: { "Content-Length": body.length },
      },
      (res: IncomingMessage) => {
        res.resume(); // drain so the socket can close
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    // The server may abort the connection after responding 413; treat a reset
    // after we already saw a response as non-fatal, otherwise reject.
    let responded = false;
    req.on("response", () => {
      responded = true;
    });
    req.on("error", (e) => {
      if (!responded) reject(e);
    });
    req.end(body);
  });
}

describe("createNodeListener", () => {
  it("serves only POST on the configured path", async () => {
    const handler = vi.fn(async () => ({ status: 200, body: {} }));
    const server = createServer(createNodeListener({ handler, path: "/chat" }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const wrongPath = await fetch(`http://127.0.0.1:${port}/other`, {
        method: "POST",
        body: "{}",
      });
      expect(wrongPath.status).toBe(404);
      const get = await fetch(`http://127.0.0.1:${port}/chat`);
      expect(get.status).toBe(405);
      const ok = await fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        body: "{}",
      });
      expect(ok.status).toBe(200);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("rejects oversized request bodies with 413 before invoking the handler", async () => {
    const handler = vi.fn<ChatRequestHandlerForTest>(async () => ({
      status: 200,
      body: {},
    }));
    const { port, server } = await listen(handler);
    try {
      const oversized = Buffer.alloc(4096, 0x61); // 4 KiB > 1 KiB limit
      const res = await post(port, oversized);
      expect(res.status).toBe(413);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("accepts a body under the limit and reaches the handler", async () => {
    const handler = vi.fn<ChatRequestHandlerForTest>(async () => ({
      status: 200,
      body: { ok: true },
    }));
    const { port, server } = await listen(handler);
    try {
      const res = await post(
        port,
        Buffer.from(JSON.stringify({ type: "MESSAGE" })),
      );
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("responds 500 and logs when the handler throws", async () => {
    const boom = new Error("handler boom");
    const handler = vi.fn<ChatRequestHandlerForTest>(async () => {
      throw boom;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { port, server } = await listen(handler);
    try {
      const res = await post(
        port,
        Buffer.from(JSON.stringify({ type: "MESSAGE" })),
      );
      expect(res.status).toBe(500);
      expect(handler).toHaveBeenCalledOnce();
      expect(errSpy).toHaveBeenCalledWith(
        "[channels-google-chat] request handler failed:",
        boom,
      );
    } finally {
      errSpy.mockRestore();
      await new Promise((r) => server.close(r));
    }
  });
});

type ChatRequestHandlerForTest = (req: {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}) => Promise<{ status: number; body?: unknown }>;
