import { once } from "node:events";
import { Agent, createServer, request as httpRequest } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotRuntimeHandlerOptions } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotNodeHandler } from "../endpoints/node-fetch-handler";
import { createCopilotExpressHandler } from "../endpoints/express";
import { createCopilotHonoHandler } from "../endpoints/hono";
import { createCopilotNodeListener } from "../endpoints/node";
import { TranscriptionService } from "../transcription-service/transcription-service";

class FakeTranscription extends TranscriptionService {
  async transcribeFile() {
    return "hello";
  }
}

const createAgent = () => {
  const agent: unknown = { execute: vi.fn() };
  (agent as { clone: () => unknown }).clone = () => createAgent();
  return agent as AbstractAgent;
};

const createHandler = (options: Partial<CopilotRuntimeHandlerOptions> = {}) =>
  createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: { default: createAgent() },
      transcriptionService: new FakeTranscription(),
    }),
    basePath: "/api",
    maxBodyBytes: 1024,
    maxTranscriptionBodyBytes: 4096,
    ...options,
  });

/** A chunked body: no Content-Length, delivered in `chunkSize` pieces. */
const chunkedBody = (size: number, chunkSize = 256) => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= size) return controller.close();
      const chunk = new Uint8Array(Math.min(chunkSize, size - sent)).fill(32);
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
};

const post = (path: string, body: BodyInit, headers = {}) =>
  new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit);

const declared = (path: string, size: number) =>
  post(path, "{}", { "Content-Length": String(size) });

describe("request body limit", () => {
  it.each(["/api/agent/default/run", "/api/agent/nope/run", "/api/nope"])(
    "rejects a declared Content-Length over the limit on %s without reading",
    async (path) => {
      const onRequest = vi.fn();
      const handler = createHandler({ hooks: { onRequest } });

      const response = await handler(declared(path, 1025));

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({
        error: "payload_too_large",
      });
      expect(onRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/api/agent/default/run",
    "/api/agent/default/connect",
    "/api/agent/nope/run",
    "/api",
  ])("rejects a chunked body over the limit on %s", async (path) => {
    const response = await createHandler()(post(path, chunkedBody(2048)));
    expect(response.status).toBe(413);
  });

  it("stops reading a chunked body once it passes the limit", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 256;
        controller.enqueue(new Uint8Array(256));
      },
    });
    const response = await createHandler()(post("/api", body));
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThan(16 * 1024);
  });

  it("can still clone after a reader looks at request.body", async () => {
    const seen = vi.fn();
    const handler = createHandler({
      hooks: {
        onRequest: async ({ request }) => {
          expect(request.body).not.toBeNull();
          seen(await request.clone().text());
        },
      },
    });
    await handler(post("/api/agent/nope/run", "small"));
    expect(seen).toHaveBeenCalledWith("small");
  });

  it("limits a hook reading request.body directly", async () => {
    const handler = createHandler({
      hooks: {
        onRequest: async ({ request }) => {
          const reader = request.body!.getReader();
          while (!(await reader.read()).done);
        },
      },
    });
    const response = await handler(post("/api/nope", chunkedBody(2048)));
    expect(response.status).toBe(413);
  });

  it("does not read a body on a path outside basePath", async () => {
    const pull = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const response = await createHandler()(post("/elsewhere", body));
    expect(response.status).toBe(404);
    expect(pull).not.toHaveBeenCalled();
  });

  it("leaves the source uncancelled after an overrun", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(512)),
      cancel,
    });
    const response = await createHandler()(post("/api/agent/nope/run", body));
    expect(response.status).toBe(413);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps the caller's object and subclass members for hooks and handlers", async () => {
    class FrameworkRequest extends Request {
      #cookies = new Map([["session", "abc"]]);
      get cookies() {
        return this.#cookies;
      }
    }
    const request = new FrameworkRequest(
      "http://localhost/api/agent/nope/run",
      {
        method: "POST",
        body: "{}",
      },
    );
    const onRequest = vi.fn();
    const onBeforeHandler = vi.fn();
    const { signal } = request;

    await createHandler({ hooks: { onRequest, onBeforeHandler } })(request);

    expect(onRequest.mock.calls[0]![0].request).toBe(request);
    expect(onBeforeHandler.mock.calls[0]![0].request).toBe(request);
    expect(request.cookies.get("session")).toBe("abc");
    expect(request.signal).toBe(signal);
  });

  it("lets a hook rebuild the request, and still limits what it returns", async () => {
    const seen = vi.fn();
    const rebuild = createHandler({
      hooks: {
        onRequest: ({ request }) =>
          new Request(request, { headers: { "x-added": "1" } }),
        onBeforeHandler: async ({ request }) => {
          seen(request.headers.get("x-added"), await request.clone().text());
        },
      },
    });
    await rebuild(post("/api/agent/nope/run", "small"));
    expect(seen).toHaveBeenCalledWith("1", "small");

    const swap = createHandler({
      hooks: {
        onBeforeHandler: () =>
          post("/api/agent/default/run", chunkedBody(2048)),
      },
    });
    const response = await swap(post("/api/agent/default/run", "{}"));
    expect(response.status).toBe(413);
  });

  it("keeps a 404 when a hook already read the body on an unknown route", async () => {
    const handler = createHandler({
      hooks: {
        onRequest: async ({ request }) => {
          await request.text();
        },
      },
    });
    const response = await handler(post("/api", "{}"));
    expect(response.status).toBe(404);
  });

  it("answers 413 when a hook reads an oversized chunked body", async () => {
    const handler = createHandler({
      hooks: {
        onRequest: async ({ request }) => {
          await request.clone().text();
        },
      },
    });
    const response = await handler(post("/api/nope", chunkedBody(2048)));
    expect(response.status).toBe(413);
  });

  it("adds CORS headers to the 413", async () => {
    const handler = createHandler({ cors: true });
    const response = await handler(
      post("/api/nope", "{}", {
        "Content-Length": "1025",
        Origin: "https://app.example",
      }),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("leaves bodies within the limit readable, by hooks and handlers", async () => {
    const seen = vi.fn();
    const handler = createHandler({
      hooks: {
        onBeforeHandler: async ({ request }) => {
          seen(await request.clone().text());
        },
      },
    });
    const response = await handler(
      post("/api/agent/nope/run", chunkedBody(1024)),
    );
    expect(seen).toHaveBeenCalledWith(" ".repeat(1024));
    expect(response.status).toBe(404);
  });

  it("preserves the multipart boundary and gives transcription its own limit", async () => {
    const form = new FormData();
    form.set("audio", new File([new Uint8Array(2048)], "a.webm"));
    const handler = createHandler();

    const response = await handler(
      new Request("http://localhost/api/transcribe", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "hello", size: 2048 });
  });

  it("rejects transcription bodies over the transcription limit", async () => {
    const response = await createHandler()(
      post("/api/transcribe", chunkedBody(8192)),
    );
    expect(response.status).toBe(413);
  });

  describe("single-route", () => {
    const envelope = (method: string, padding: number) =>
      JSON.stringify({
        method,
        params: { agentId: "default" },
        body: { audio: "a".repeat(padding), mimeType: "audio/webm" },
      });
    const handler = () => createHandler({ mode: "single-route" });

    it("rejects a JSON method past the JSON limit", async () => {
      const response = await handler()(
        post("/api", envelope("agent/connect", 2048)),
      );
      expect(response.status).toBe(413);
    });

    it("allows transcribe up to the transcription limit", async () => {
      const response = await handler()(
        post("/api", envelope("transcribe", 2048)),
      );
      expect(response.status).not.toBe(413);
    });

    it("applies a transcription limit below the JSON limit", async () => {
      const response = await createHandler({
        mode: "single-route",
        maxBodyBytes: 8192,
        maxTranscriptionBodyBytes: 1024,
      })(post("/api", envelope("transcribe", 2048)));
      expect(response.status).toBe(413);
    });

    it("rejects anything past the transcription limit", async () => {
      const response = await handler()(
        post("/api", envelope("transcribe", 8192)),
      );
      expect(response.status).toBe(413);
    });

    describe("with a Request replaced in onBeforeHandler", () => {
      const threadUpdate = () =>
        post(
          "/api",
          JSON.stringify({
            method: "resource/request",
            params: { path: "/threads/thread-1", httpMethod: "PATCH" },
            body: { agentId: "default", name: "before" },
          }),
        );

      const update = async (replacementSize: number) => {
        const updateThread = vi.fn().mockResolvedValue({ id: "thread-1" });
        const runtime = {
          agents: Promise.resolve({}),
          mode: "intelligence",
          identifyUser: vi
            .fn()
            .mockResolvedValue({ id: "user-1", name: "User One" }),
          intelligence: { updateThread },
        } as unknown as CopilotRuntimeLike;
        const response = await createHandler({
          runtime,
          mode: "single-route",
          activateChannels: false,
          hooks: {
            onBeforeHandler: ({ request }) =>
              new Request(request.url, {
                method: request.method,
                headers: request.headers,
                body: JSON.stringify({
                  agentId: "default",
                  name: "a".repeat(replacementSize),
                }),
              }),
          },
        })(threadUpdate());
        return { response, updateThread };
      };

      it("rejects a body over the method's limit", async () => {
        // Between the JSON limit and the larger limit the envelope is read to.
        const { response, updateThread } = await update(2048);
        expect(response.status).toBe(413);
        expect(updateThread).not.toHaveBeenCalled();
      });

      it("passes a body under the method's limit to the handler", async () => {
        const { response, updateThread } = await update(16);
        expect(response.status).toBe(200);
        expect(updateThread).toHaveBeenCalledOnce();
      });
    });
  });

  it("is removable with Infinity", async () => {
    const response = await createHandler({ maxBodyBytes: Infinity })(
      post("/api/agent/nope/run", chunkedBody(2048)),
    );
    expect(response.status).toBe(404);
  });

  describe.each(["maxBodyBytes", "maxTranscriptionBodyBytes"] as const)(
    "%s validation",
    (option) => {
      const runtime = new CopilotRuntime({
        agents: { default: createAgent() },
      });
      const mounts = {
        fetch: (value: number) =>
          createCopilotRuntimeHandler({ runtime, [option]: value }),
        node: (value: number) =>
          createCopilotNodeListener({ runtime, [option]: value }),
        express: (value: number) =>
          createCopilotExpressHandler({
            runtime,
            basePath: "/api",
            [option]: value,
          }),
        hono: (value: number) =>
          createCopilotHonoHandler({
            runtime,
            basePath: "/api",
            [option]: value,
          }),
      };

      describe.each(Object.entries(mounts))("on the %s mount", (_, create) => {
        it.each([NaN, -1, "1024", null])("refuses %s", (value) => {
          expect(() => create(value as number)).toThrow(option);
        });

        it.each([0, 1024, Infinity])("accepts %s", (value) => {
          expect(() => create(value)).not.toThrow();
        });
      });
    },
  );

  it("is configurable through the Hono mount", async () => {
    const app = createCopilotHonoHandler({
      runtime: new CopilotRuntime({ agents: { default: createAgent() } }),
      basePath: "/api",
      maxBodyBytes: 10,
    });
    const response = await app.fetch(post("/api", chunkedBody(2048)));
    expect(response.status).toBe(413);
  });
});

describe("request body limit with a proxied request", () => {
  // Engines with real private state refuse a native getter called on a proxy.
  class BrandedRequest extends Request {
    #brand = true;
    override get body() {
      return this.#brand ? super.body : null;
    }
    override clone() {
      return this.#brand ? super.clone() : this;
    }
  }

  // Next.js App Router hands route handlers a proxy shaped like this one.
  const proxied = (path: string, init?: RequestInit) =>
    new Proxy(
      new BrandedRequest(`http://localhost/api${path}`, {
        duplex: "half",
        ...init,
      } as RequestInit),
      {
        get(target, name) {
          const value = Reflect.get(target, name);
          return typeof value === "function" ? value.bind(target) : value;
        },
      },
    );

  const json = (size: number) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: chunkedBody(size),
  });

  it("serves a request without a body", async () => {
    const response = await createHandler()(proxied("/info"));
    expect(response.status).toBe(200);
  });

  it("serves a body under the limit", async () => {
    const response = await createHandler({ maxBodyBytes: 1024 })(
      proxied("/agent/nope/run", json(16)),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a body over the limit", async () => {
    const response = await createHandler({ maxBodyBytes: 1024 })(
      proxied("/agent/nope/run", json(4096)),
    );
    expect(response.status).toBe(413);
  });

  it("keeps clone working in a hook", async () => {
    let cloned: string | undefined;
    const response = await createHandler({
      maxBodyBytes: 1024,
      hooks: {
        onRequest: async ({ request }) => {
          cloned = await request.clone().text();
        },
      },
    })(
      proxied("/agent/nope/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(cloned).toBe("{}");
    expect(response.status).toBe(404);
  });
});

describe("request body limit over Node HTTP", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  const listen = async (listener: Parameters<typeof createServer>[1]) => {
    server = createServer(listener);
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    return (server.address() as AddressInfo).port;
  };

  /** POST `chunks` as chunked encoding, ending the upload after a reply. */
  const upload = (port: number, path: string, chunks: number) =>
    new Promise<number>((resolve, reject) => {
      const req = httpRequest({
        port,
        host: "127.0.0.1",
        path,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      for (let i = 0; i < chunks; i++) req.write(Buffer.alloc(512, 32));
      req.end();
    });

  const nodeHandler = () => createCopilotNodeHandler(createHandler());

  it("answers 413 to a chunked upload through the Node handler", async () => {
    const port = await listen(nodeHandler());
    expect(await upload(port, "/api/agent/nope/run", 8)).toBe(413);
  });

  it("serves an upload within the limit", async () => {
    const port = await listen(nodeHandler());
    expect(await upload(port, "/api/agent/nope/run", 1)).toBe(404);
  });

  it("does not consume a body until something reads it", async () => {
    let dataListeners = -1;
    const port = await listen(
      createCopilotNodeHandler(async () => new Response(null, { status: 204 })),
    );
    server!.prependListener("request", (req) => {
      queueMicrotask(() => (dataListeners = req.listenerCount("data")));
    });
    expect(await upload(port, "/", 1)).toBe(204);
    expect(dataListeners).toBe(0);
  });

  /** Write everything, then read: the reply survives only if it was drained. */
  const rawUpload = (port: number, bytes: number) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1");
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("no response"));
      }, 10_000);
      let reply = "";
      socket.on("data", (d) => (reply += d));
      socket.on("error", () => undefined);
      socket.on("close", () => {
        clearTimeout(timer);
        resolve(reply);
      });
      socket.write(
        `POST /api/agent/default/run HTTP/1.1\r\nHost: x\r\nConnection: close\r\n` +
          `Content-Type: application/json\r\nContent-Length: ${bytes}\r\n\r\n`,
      );
      socket.write(Buffer.alloc(bytes, 32));
      socket.end();
    });

  const rejecting = () =>
    createCopilotNodeHandler(
      createHandler({
        maxBodyBytes: Infinity,
        hooks: {
          onRequest: () => {
            throw new Response("nope", { status: 401 });
          },
        },
      }),
    );

  it.each([100, 32 * 1024 * 1024])(
    "delivers a hook's rejection of an unread %d-byte upload",
    async (bytes) => {
      const port = await listen(rejecting());
      expect(await rawUpload(port, bytes)).toContain("401");
    },
    15_000,
  );

  it("keeps the connection usable after a small rejected body", async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const port = await listen(rejecting());
    const send = () =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          { port, host: "127.0.0.1", path: "/api", method: "POST", agent },
          (res) => {
            res.resume();
            res.on("end", () => resolve(req.reusedSocket ? 1 : 0));
          },
        );
        req.on("error", reject);
        req.end("x".repeat(100));
      });
    await send();
    expect(await send()).toBe(1);
    agent.destroy();
  });

  it("drops a connection past the discard byte budget", async () => {
    let closed: Promise<void> | undefined;
    const handler = rejecting();
    const port = await listen((req, res) => {
      closed = new Promise((resolve) => req.once("close", resolve));
      void handler(req, res);
    });
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => undefined);
    socket.write(
      "POST /api HTTP/1.1\r\nHost: x\r\nContent-Length: 1000000000\r\n\r\n",
    );
    const chunk = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 70 && !socket.destroyed; i++) {
      if (!socket.write(chunk)) await once(socket, "drain").catch(() => null);
    }
    await closed;
    socket.destroy();
  }, 15_000);

  it("drops a stalled upload after the discard time budget", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const timers: (() => void)[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms: number,
    ) => {
      if (ms === 5_000) timers.push(fn);
      return realSetTimeout(() => undefined, 0);
    }) as typeof setTimeout);
    try {
      let closed: Promise<void> | undefined;
      const handler = rejecting();
      const port = await listen((req, res) => {
        closed = new Promise((resolve) => req.once("close", resolve));
        void handler(req, res);
      });
      const socket = connect(port, "127.0.0.1");
      socket.on("error", () => undefined);
      socket.write(
        "POST /api HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\nabc",
      );
      await once(socket, "data");
      await vi.waitFor(() => expect(timers).toHaveLength(1));
      timers[0]!();
      await closed;
      socket.destroy();
    } finally {
      spy.mockRestore();
    }
  });

  it("answers 413 through the Express mount", async () => {
    const { default: express } = await import("express");
    const app = express();
    app.use(
      createCopilotExpressHandler({
        runtime: new CopilotRuntime({ agents: { default: createAgent() } }),
        basePath: "/api",
        maxBodyBytes: 1024,
      }),
    );
    const port = await listen(app);
    expect(await upload(port, "/api/agent/default/run", 8)).toBe(413);
  });
});
