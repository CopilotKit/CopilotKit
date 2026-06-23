import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { WebhookServer } from "./webhook-server.js";

const sign = (secret: string, body: string) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

async function get(server: WebhookServer, path: string) {
  const port = (server.address() as any).port;
  return fetch(`http://127.0.0.1:${port}${path}`);
}
async function post(
  server: WebhookServer,
  path: string,
  body: string,
  sig?: string,
) {
  const port = (server.address() as any).port;
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(sig ? { "X-Hub-Signature-256": sig } : {}),
    },
    body,
  });
}

describe("WebhookServer", () => {
  it("echoes hub.challenge when verify token matches", async () => {
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "VTOK",
      appSecret: "SECRET",
      onEvent: async () => {},
    });
    await server.start(0);
    try {
      const res = await get(
        server,
        "/webhook?hub.mode=subscribe&hub.verify_token=VTOK&hub.challenge=12345",
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("12345");
    } finally {
      await server.stop();
    }
  });

  it("rejects a verify with a wrong token", async () => {
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "VTOK",
      appSecret: "S",
      onEvent: async () => {},
    });
    await server.start(0);
    try {
      const res = await get(
        server,
        "/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=1",
      );
      expect(res.status).toBe(403);
    } finally {
      await server.stop();
    }
  });

  it("accepts a correctly-signed POST and invokes onEvent", async () => {
    const onEvent = vi.fn(async () => {});
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "V",
      appSecret: "SECRET",
      onEvent,
    });
    await server.start(0);
    try {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [],
      });
      const res = await post(server, "/webhook", body, sign("SECRET", body));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(onEvent).toHaveBeenCalledOnce();
    } finally {
      await server.stop();
    }
  });

  it("rejects a POST with a bad signature", async () => {
    const onEvent = vi.fn(async () => {});
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "V",
      appSecret: "SECRET",
      onEvent,
    });
    await server.start(0);
    try {
      const res = await post(server, "/webhook", "{}", "sha256=deadbeef");
      expect(res.status).toBe(401);
      expect(onEvent).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it("rejects a POST with a correctly-formatted but wrong signature", async () => {
    const onEvent = vi.fn(async () => {});
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "V",
      appSecret: "SECRET",
      onEvent,
    });
    await server.start(0);
    try {
      const body = "{}";
      // valid length (64 hex) but computed with the WRONG secret
      const wrong =
        "sha256=" +
        createHmac("sha256", "NOT_THE_SECRET").update(body).digest("hex");
      const res = await post(server, "/webhook", body, wrong);
      expect(res.status).toBe(401);
      expect(onEvent).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it("responds 200 ok to GET / for health checks", async () => {
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "V",
      appSecret: "S",
      onEvent: async () => {},
    });
    await server.start(0);
    try {
      const res = await get(server, "/");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      await server.stop();
    }
  });

  it("still 404s an unknown path (health route doesn't broaden 200)", async () => {
    const server = new WebhookServer({
      path: "/webhook",
      verifyToken: "V",
      appSecret: "S",
      onEvent: async () => {},
    });
    await server.start(0);
    try {
      const res = await get(server, "/nope");
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});
