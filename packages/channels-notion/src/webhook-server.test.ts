import { createHmac } from "node:crypto";
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotionWebhookEvent } from "./types.js";
import { createWebhookHandler } from "./webhook.js";
import { NotionWebhookServer } from "./webhook-server.js";

const TOKEN = "secret_verification_token";

const EVENT: NotionWebhookEvent = {
  id: "evt-1",
  timestamp: "2026-11-10T12:00:00.000Z",
  workspace_id: "ws-1",
  subscription_id: "sub-1",
  integration_id: "int-1",
  type: "comment.created",
  authors: [{ id: "user-1", type: "person" }],
  entity: { id: "comment-1", type: "comment" },
  data: { page_id: "page-1" },
};

const servers: NotionWebhookServer[] = [];

async function startServer(path?: string) {
  const onEvent = vi.fn<(event: NotionWebhookEvent) => void>();
  const server = new NotionWebhookServer({
    handler: createWebhookHandler({ verificationToken: TOKEN, onEvent }),
    path,
  });
  servers.push(server);
  await server.start(0, "127.0.0.1");
  const address = server.address();
  if (address === null) throw new Error("server is not listening");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { server, onEvent, baseUrl };
}

/**
 * POSTs to the webhook path with `node:http`, so a test controls the headers
 * and how much body it sends. Resolves the response status. A write error after
 * the server answers and closes the socket is expected, so it is ignored.
 */
function postRaw(
  baseUrl: string,
  options: { headers?: Record<string, string>; chunks: Buffer[] },
) {
  return new Promise<number>((resolve, reject) => {
    const req = request(`${baseUrl}/webhook`, {
      method: "POST",
      headers: options.headers,
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on("error", reject);
    req.flushHeaders();
    for (const chunk of options.chunks) req.write(chunk);
  });
}

const MIB = 1024 * 1024;

afterEach(async () => {
  const running = servers.splice(0);
  await Promise.all(running.map((server) => server.stop()));
});

describe("NotionWebhookServer", () => {
  it("passes a signed POST on the webhook path to the handler", async () => {
    const { baseUrl, onEvent } = await startServer();
    const rawBody = JSON.stringify(EVENT);
    const signature =
      "sha256=" + createHmac("sha256", TOKEN).update(rawBody).digest("hex");

    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-notion-signature": signature,
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledWith(EVENT));
  });

  it("answers the GET / health check with 200 ok", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("responds 404 to an unknown path", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/other`, { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("sends GET / to the handler when the webhook path is /", async () => {
    const { baseUrl } = await startServer("/");

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(405);
  });

  it("answers 413 before reading when Content-Length is over 1 MiB", async () => {
    const { baseUrl, onEvent } = await startServer();

    const status = await postRaw(baseUrl, {
      headers: { "content-length": String(2 * MIB) },
      chunks: [],
    });

    expect(status).toBe(413);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("answers 413 when a body without Content-Length grows past 1 MiB", async () => {
    const { baseUrl, onEvent } = await startServer();
    const chunk = Buffer.alloc(MIB / 2 + 1, "a");

    const status = await postRaw(baseUrl, { chunks: [chunk, chunk] });

    expect(status).toBe(413);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("reports no address after stop", async () => {
    const { server } = await startServer();

    await server.stop();

    expect(server.address()).toBeNull();
  });
});
