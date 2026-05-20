import express from "express";
import request from "supertest";
import { describe, it, expect, vi } from "vitest";
import { createExpressNodeHandler } from "../endpoints/express-fetch-bridge";
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
  const nodeHandler = createExpressNodeHandler(fetchHandler);

  if (opts.bodyParserFirst) {
    app.use(express.json());
  }

  app.all(/.*/, (req, res) => nodeHandler(req, res));
  return app;
}

/* ------------------------------------------------------------------------------------------------
 * Pre-parsed body (express.json() before handler)
 * --------------------------------------------------------------------------------------------- */

describe("express-fetch-bridge — pre-parsed body", () => {
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
 * URL reconstruction
 * --------------------------------------------------------------------------------------------- */

describe("express-fetch-bridge — URL reconstruction", () => {
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

describe("express-fetch-bridge — header preservation", () => {
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

describe("express-fetch-bridge — HTTP methods", () => {
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

describe("express-fetch-bridge — error handling", () => {
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

describe("express-fetch-bridge — streaming responses", () => {
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
