import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { createNodeFetchHandler } from "../endpoints/node-fetch-handler";
import type { CopilotRuntimeFetchHandler } from "../core/fetch-handler";

const getPort = (() => {
  let port = 19000;
  return () => port++;
})();

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, resolve));
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

describe("createNodeFetchHandler", () => {
  it("converts Node request to Fetch and sends response back", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (request) => {
      const url = new URL(request.url);
      return new Response(
        JSON.stringify({ path: url.pathname, method: request.method }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const nodeHandler = createNodeFetchHandler(fetchHandler);
    const port = getPort();
    const server = createServer(nodeHandler);
    await listen(server, port);

    try {
      const response = await fetch(`http://localhost:${port}/test`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ path: "/test", method: "GET" });
    } finally {
      await close(server);
    }
  });

  it("handles POST with JSON body", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async (request) => {
      const body = await request.json();
      return new Response(JSON.stringify({ received: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const nodeHandler = createNodeFetchHandler(fetchHandler);
    const port = getPort();
    const server = createServer(nodeHandler);
    await listen(server, port);

    try {
      const response = await fetch(`http://localhost:${port}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ received: { hello: "world" } });
    } finally {
      await close(server);
    }
  });

  it("returns 500 for unhandled errors in the fetch handler", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async () => {
      throw new Error("Unexpected error");
    };

    const nodeHandler = createNodeFetchHandler(fetchHandler);
    const port = getPort();
    const server = createServer(nodeHandler);
    await listen(server, port);

    try {
      const response = await fetch(`http://localhost:${port}/boom`);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toBe("Internal Server Error");
    } finally {
      await close(server);
    }
  });

  it("streams SSE responses without buffering", async () => {
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
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    };

    const nodeHandler = createNodeFetchHandler(fetchHandler);
    const port = getPort();
    const server = createServer(nodeHandler);
    await listen(server, port);

    try {
      const response = await fetch(`http://localhost:${port}/sse`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      const text = await response.text();
      expect(text).toContain("data: event1");
      expect(text).toContain("data: event2");
    } finally {
      await close(server);
    }
  });

  it("preserves response headers", async () => {
    const fetchHandler: CopilotRuntimeFetchHandler = async () => {
      return new Response("ok", {
        status: 201,
        headers: {
          "X-Custom-Header": "custom-value",
          "Content-Type": "text/plain",
        },
      });
    };

    const nodeHandler = createNodeFetchHandler(fetchHandler);
    const port = getPort();
    const server = createServer(nodeHandler);
    await listen(server, port);

    try {
      const response = await fetch(`http://localhost:${port}/custom`);
      expect(response.status).toBe(201);
      expect(response.headers.get("X-Custom-Header")).toBe("custom-value");
    } finally {
      await close(server);
    }
  });
});
