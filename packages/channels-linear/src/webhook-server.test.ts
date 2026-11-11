import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { request } from "node:http";
import type { OutgoingHttpHeaders } from "node:http";
import { createWebhookHandler } from "./webhook.js";
import { LinearWebhookServer } from "./webhook-server.js";
import type { AgentSessionEventWebhook } from "./types.js";

const SECRET = "lin_wh_secret";

let server: LinearWebhookServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function startServer(path?: string) {
  const onEvent = vi.fn(async (_event: AgentSessionEventWebhook) => {});
  const handler = createWebhookHandler({ secret: SECRET, onEvent });
  server = new LinearWebhookServer({ handler, path });
  await server.start(0, "127.0.0.1");
  const port = server.address()?.port;
  return { onEvent, baseUrl: `http://127.0.0.1:${port}` };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const MIB = 1024 * 1024;

/**
 * POSTs `chunks` with node:http, so the test controls `Content-Length` and
 * chunked transfer. Resolves with the status. The server may close the
 * socket before every chunk is written, so a write error after the response
 * is ignored.
 */
function postChunks(
  url: string,
  chunks: Buffer[],
  headers: OutgoingHttpHeaders = {},
) {
  return new Promise<number | undefined>((resolve, reject) => {
    let answered = false;
    const req = request(url, { method: "POST", headers }, (res) => {
      answered = true;
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", (error) => {
      if (!answered) reject(error);
    });
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

describe("LinearWebhookServer", () => {
  it("passes a signed POST on the webhook path through to the handler", async () => {
    const { onEvent, baseUrl } = await startServer();
    const event: AgentSessionEventWebhook = {
      type: "AgentSessionEvent",
      action: "prompted",
      organizationId: "org-1",
      createdAt: "2023-11-14T22:13:20.000Z",
      webhookTimestamp: Date.now(),
      agentSession: { id: "session-1" },
      agentActivity: {
        id: "activity-1",
        content: { type: "prompt", body: "hi" },
      },
    };
    const body = JSON.stringify(event);

    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": createHmac("sha256", SECRET)
          .update(body)
          .digest("hex"),
      },
      body,
    });

    expect(response.status).toBe(200);
    await flush();
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("returns the handler's status and headers", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/webhook`);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("answers GET / with 200 ok for health checks", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("routes GET / to the handler when the webhook path is /", async () => {
    const { baseUrl } = await startServer("/");

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(405);
  });

  it("answers an unknown path with 404", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/nope`, { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("answers 413 without reading when Content-Length is over 1 MiB", async () => {
    const { onEvent, baseUrl } = await startServer();
    const body = Buffer.alloc(MIB + 1, "a");

    const status = await postChunks(`${baseUrl}/webhook`, [body], {
      "content-length": body.length,
    });

    expect(status).toBe(413);
    await flush();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("answers 413 when a chunked body passes 1 MiB", async () => {
    const { onEvent, baseUrl } = await startServer();
    const chunk = Buffer.alloc(256 * 1024, "a");

    const status = await postChunks(
      `${baseUrl}/webhook`,
      [chunk, chunk, chunk, chunk, chunk],
      { "transfer-encoding": "chunked" },
    );

    expect(status).toBe(413);
    await flush();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
