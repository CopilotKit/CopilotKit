import { createCopilotNodeListener } from "../endpoints/node";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { createCopilotNodeHandler } from "../endpoints/node-fetch-handler";

import { CopilotRuntime } from "../core/runtime";
import type { CopilotRuntimeFetchHandler } from "../core/fetch-handler";

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

/**
 * Creates an Express app that optionally runs express.json() before our handler,
 * simulating the "pre-parsed body" scenario.
 */
function createApp(
  fetchHandler: CopilotRuntimeFetchHandler,
  opts: { bodyParserFirst?: boolean } = {},
) {
  const app = express();
  const nodeHandler = createCopilotNodeHandler(fetchHandler);

  if (opts.bodyParserFirst) {
    app.use(express.json());
  }

  app.all(/.*/, (req, res) => nodeHandler(req, res));
  return app;
}

/* ------------------------------------------------------------------------------------------------
 * Pre-parsed body (express.json() before handler)
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotNodeHandler (pre-parsed bodies) — pre-parsed body", () => {
  it("receives JSON body when express.json() runs first", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const body = await req.json();
      return new Response(JSON.stringify({ received: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({ hello: "world" });

    expect(res.status).toBe(200);
    expect(res.body.received).toEqual({ hello: "world" });
  });

  it("receives JSON body when express.json() does NOT run first", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const body = await req.json();
      return new Response(JSON.stringify({ received: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: false });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({ hello: "world" });

    expect(res.status).toBe(200);
    expect(res.body.received).toEqual({ hello: "world" });
  });

  it("preserves nested objects in pre-parsed body", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const body = await req.json();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const payload = {
      messages: [{ role: "user", content: "hi" }],
      state: { count: 42, nested: { deep: true } },
      threadId: "t-123",
    };

    const res = await request(app)
      .post("/agent/default/run")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  it("preserves arrays in pre-parsed body", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const body = await req.json();
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send([1, 2, 3]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([1, 2, 3]);
  });

  it("empty object body is preserved", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const body = await req.json();
      return new Response(JSON.stringify({ received: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.received).toEqual({});
  });
});

/* ------------------------------------------------------------------------------------------------
 * `req.body` set without the stream being consumed
 * --------------------------------------------------------------------------------------------- */

/**
 * body-parser 1.x (Express 4) assigns `req.body = req.body || {}` *before* it
 * checks whether it should parse at all, so a request it declines — multipart,
 * text/plain — arrives with `req.body === {}` and the stream still full. This
 * middleware reproduces that state; the awaiting middleware after it lets the
 * HTTP parser finish, which is what sets `req.complete` on an unread stream.
 */
function legacyParserThatDeclinesToParse(): express.RequestHandler {
  return (req, _res, next) => {
    req.body = req.body || {};
    next();
  };
}

const echoBody: CopilotRuntimeFetchHandler = async (req) => {
  const text = await req.text();
  return new Response(
    JSON.stringify({ text, contentType: req.headers.get("content-type") }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

describe("createCopilotNodeHandler (pre-parsed bodies) — req.body set but stream not consumed", () => {
  function createLegacyApp(fetchHandler: CopilotRuntimeFetchHandler) {
    const app = express();
    const nodeHandler = createCopilotNodeHandler(fetchHandler);

    app.use(legacyParserThatDeclinesToParse());
    app.use(async (_req, _res, next) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      next();
    });
    app.all(/.*/, (req, res) => nodeHandler(req, res));
    return app;
  }

  it("streams a text/plain body instead of rebuilding it from an empty req.body", async () => {
    const res = await request(createLegacyApp(echoBody))
      .post("/test")
      .set("Content-Type", "text/plain")
      .send("hello");

    expect(res.status).toBe(200);
    // Previously the bridge saw `req.body === {}` plus `req.complete` and
    // rebuilt the request as `"{}"`, silently discarding the real payload.
    expect(res.body.text).toBe("hello");
  });

  it("streams a multipart body instead of rebuilding it from an empty req.body", async () => {
    const payload =
      '--xyz\r\nContent-Disposition: form-data; name="file"\r\n\r\nAUDIOBYTES\r\n--xyz--';

    const res = await request(createLegacyApp(echoBody))
      .post("/test")
      .set("Content-Type", "multipart/form-data; boundary=xyz")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.text).toContain("AUDIOBYTES");
    expect(res.body.contentType).toContain("multipart/form-data");
  });
});

/* ------------------------------------------------------------------------------------------------
 * URL reconstruction
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotNodeHandler (pre-parsed bodies) — URL reconstruction", () => {
  it("preserves pathname in reconstructed URL", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const url = new URL(req.url);
      return new Response(JSON.stringify({ path: url.pathname }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/api/copilotkit/agent/default/run")
      .set("Content-Type", "application/json")
      .send({ threadId: "t1" });

    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/api/copilotkit/agent/default/run");
  });

  it("preserves query string in reconstructed URL", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      const url = new URL(req.url);
      return new Response(
        JSON.stringify({
          search: url.search,
          param: url.searchParams.get("foo"),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test?foo=bar")
      .set("Content-Type", "application/json")
      .send({ data: true });

    expect(res.status).toBe(200);
    expect(res.body.param).toBe("bar");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Header preservation
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotNodeHandler (pre-parsed bodies) — header preservation", () => {
  it("preserves custom headers from original request", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      return new Response(
        JSON.stringify({
          auth: req.headers.get("authorization"),
          custom: req.headers.get("x-custom-header"),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer tok123")
      .set("X-Custom-Header", "my-value")
      .send({ data: true });

    expect(res.status).toBe(200);
    expect(res.body.auth).toBe("Bearer tok123");
    expect(res.body.custom).toBe("my-value");
  });

  it("sets content-type to application/json for object bodies", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      return new Response(
        JSON.stringify({ contentType: req.headers.get("content-type") }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({ data: true });

    expect(res.status).toBe(200);
    expect(res.body.contentType).toBe("application/json");
  });
});

/* ------------------------------------------------------------------------------------------------
 * HTTP method handling
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotNodeHandler (pre-parsed bodies) — HTTP methods", () => {
  it("GET requests bypass pre-parsed body logic", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      return new Response(JSON.stringify({ method: req.method }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app).get("/info");

    expect(res.status).toBe(200);
    expect(res.body.method).toBe("GET");
  });

  it("OPTIONS requests bypass pre-parsed body logic", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (req) => {
      return new Response(null, { status: 204 });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app).options("/test");

    expect(res.status).toBe(204);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Error handling
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotNodeHandler (pre-parsed bodies) — error handling", () => {
  it("returns 500 when fetch handler throws", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async () => {
      throw new Error("handler exploded");
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({ data: true });

    expect(res.status).toBe(500);
    expect(res.text).toBe("Internal Server Error");
  });

  it("returns 500 when fetch handler throws (no body parser)", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async () => {
      throw new Error("handler exploded");
    };

    const app = createApp(fetchHandler, { bodyParserFirst: false });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({ data: true });

    expect(res.status).toBe(500);
    expect(res.text).toBe("Internal Server Error");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Streaming responses
 * --------------------------------------------------------------------------------------------- */

describe("createCopilotNodeHandler (pre-parsed bodies) — streaming responses", () => {
  it("streams SSE response through pre-parsed body path", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: event1\n\n"));
          controller.enqueue(new TextEncoder().encode("data: event2\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    };

    const app = createApp(fetchHandler, { bodyParserFirst: true });

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "application/json")
      .send({ data: true });

    expect(res.status).toBe(200);
    expect(res.text).toContain("data: event1");
    expect(res.text).toContain("data: event2");
  });
});

/* ------------------------------------------------------------------------------------------------
 * Servers that are not the Express adapter (#6838)
 *
 * NestJS, a plain `http` server behind a body parser, or any framework that
 * hands us its Node request after reading the body. Before the pre-parsed path
 * moved into `createCopilotNodeHandler`, only the Express adapter handled this
 * and every other server hung waiting on the drained stream.
 * --------------------------------------------------------------------------------------------- */

/** A plain Node server whose "framework" reads the whole body before the handler. */
function createDrainingServer(
  nodeHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  parse: (raw: Buffer) => unknown,
): Server {
  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      (req as IncomingMessage & { body?: unknown }).body = parse(
        Buffer.concat(chunks),
      );
      void nodeHandler(req, res);
    });
  });
}

async function withServer<T>(
  server: Server,
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("createCopilotNodeHandler (pre-parsed bodies) — non-Express servers", () => {
  it("answers a POST whose body a framework already parsed, instead of hanging", async () => {
    const server = createDrainingServer(
      createCopilotNodeHandler(echoBody),
      (raw) => JSON.parse(raw.toString("utf8")),
    );

    const out = await withServer(server, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/copilotkit/agent/default/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: "t1" }),
        // Fail fast: the bug is a hang, not an error response.
        signal: AbortSignal.timeout(4000),
      });
      return { status: res.status, body: await res.json() };
    });

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body.text)).toEqual({ threadId: "t1" });
    expect(out.body.contentType).toBe("application/json");
  });

  it("passes a Buffer body through unchanged", async () => {
    const server = createDrainingServer(
      createCopilotNodeHandler(echoBody),
      (raw) => raw,
    );

    const out = await withServer(server, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "raw-bytes",
        signal: AbortSignal.timeout(4000),
      });
      return res.json();
    });

    expect(out.text).toBe("raw-bytes");
    expect(out.contentType).toBe("application/octet-stream");
  });
});

describe("createCopilotNodeHandler (pre-parsed bodies) — express.text()", () => {
  it("passes a string body through unchanged", async () => {
    const app = express();
    const nodeHandler = createCopilotNodeHandler(echoBody);
    app.use(express.text());
    app.all(/.*/, (req, res) => nodeHandler(req, res));

    const res = await request(app)
      .post("/test")
      .set("Content-Type", "text/plain")
      .send("hello");

    expect(res.status).toBe(200);
    expect(res.body.text).toBe("hello");
  });
});

/* ------------------------------------------------------------------------------------------------
 * A router mounted under a prefix
 *
 * Express strips the mount prefix from `req.url` and keeps it in `originalUrl`.
 * The streaming path builds its URL from `req.url`; the pre-parsed path used
 * `originalUrl`, so behind `app.use("/api/v1", router)` a parsed POST carried
 * the prefix, missed the handler's `basePath`, and returned 404.
 * --------------------------------------------------------------------------------------------- */

const echoPath: CopilotRuntimeFetchHandler = async (req) =>
  new Response(JSON.stringify({ path: new URL(req.url).pathname }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

describe("createCopilotNodeHandler (pre-parsed bodies) — mounted router", () => {
  it("gives a parsed POST the same path as a GET and an unparsed POST", async () => {
    const nodeHandler = createCopilotNodeHandler(echoPath);
    const router = express.Router();
    router.all(/.*/, (req, res) => nodeHandler(req, res));

    const parsedApp = express();
    parsedApp.use(express.json());
    parsedApp.use("/api/v1", router);

    const plainApp = express();
    plainApp.use("/api/v1", router);

    const parsedPost = await request(parsedApp)
      .post("/api/v1/copilotkit/info")
      .set("Content-Type", "application/json")
      .send({ a: 1 });
    const plainPost = await request(plainApp)
      .post("/api/v1/copilotkit/info")
      .set("Content-Type", "application/json")
      .send({ a: 1 });
    const get = await request(parsedApp).get("/api/v1/copilotkit/info");

    expect(get.body.path).toBe("/copilotkit/info");
    expect(plainPost.body.path).toBe("/copilotkit/info");
    expect(parsedPost.body.path).toBe("/copilotkit/info");
  });

  it("routes a parsed POST through createCopilotNodeListener mounted under a prefix", async () => {
    const agent = {
      clone: () => agent,
      description: "test agent",
    } as unknown as AbstractAgent;
    const runtime = new CopilotRuntime({ agents: { default: agent } });

    const statusFor = async (parseFirst: boolean) => {
      const app = express();
      if (parseFirst) app.use(express.json());
      app.use(
        "/api/v1",
        createCopilotNodeListener({
          runtime,
          basePath: "/copilotkit",
          cors: false,
        }),
      );
      const res = await request(app)
        .post("/api/v1/copilotkit/agent/default/stop/t1")
        .set("Content-Type", "application/json")
        .send({});
      return res.status;
    };

    const parsed = await statusFor(true);
    const unparsed = await statusFor(false);

    // Both reach the stop route; neither falls through to "Not found".
    expect(parsed).not.toBe(404);
    expect(parsed).toBe(unparsed);
  });
});
