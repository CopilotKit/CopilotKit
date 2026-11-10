import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createWebhookHandler } from "./webhook.js";
import type { GitHubWebhookEvent } from "./webhook.js";
import { GitHubWebhookServer } from "./webhook-server.js";

const SECRET = "test-secret";

const servers: GitHubWebhookServer[] = [];

async function startServer(path?: string) {
  const events: GitHubWebhookEvent[] = [];
  const server = new GitHubWebhookServer({
    handler: createWebhookHandler({
      secret: SECRET,
      onEvent: (event) => {
        events.push(event);
      },
    }),
    path,
  });
  servers.push(server);
  await server.start(0, "127.0.0.1");
  const address = server.address();
  if (address === null) throw new Error("server did not bind");
  return { baseUrl: `http://127.0.0.1:${address.port}`, events };
}

function signedPost(body: string) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issue_comment",
      "x-github-delivery": "delivery-1",
      "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`,
    },
    body,
  };
}

afterEach(async () => {
  const started = servers.splice(0);
  await Promise.all(started.map((server) => server.stop()));
});

describe("GitHubWebhookServer", () => {
  it("delivers a signed POST on the webhook path to the handler", async () => {
    const { baseUrl, events } = await startServer();

    const response = await fetch(
      `${baseUrl}/webhook`,
      signedPost(JSON.stringify({ action: "created" })),
    );

    expect(response.status).toBe(200);
    await expect
      .poll(() => events)
      .toEqual([
        {
          name: "issue_comment",
          deliveryId: "delivery-1",
          payload: { action: "created" },
        },
      ]);
  });

  it("passes the handler's rejection through (401 for a bad signature)", async () => {
    const { baseUrl, events } = await startServer();
    const init = signedPost("{}");

    const response = await fetch(`${baseUrl}/webhook`, {
      ...init,
      headers: { ...init.headers, "x-hub-signature-256": "sha256=00" },
    });

    expect(response.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("answers GET / with a 200 ok health check", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("answers 404 for any other path", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/other`, signedPost("{}"));

    expect(response.status).toBe(404);
  });

  it("routes GET / to the handler when the webhook path is /", async () => {
    const { baseUrl } = await startServer("/");

    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(405);
  });

  it("reports no address after stop", async () => {
    const server = new GitHubWebhookServer({
      handler: createWebhookHandler({ secret: SECRET, onEvent: () => {} }),
    });
    await server.start(0, "127.0.0.1");

    await server.stop();

    expect(server.address()).toBeNull();
  });
});
