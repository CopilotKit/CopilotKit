import { describe, it, expect, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createTeamsServer, isTrustedServiceUrl } from "./listener.js";

/**
 * Regression coverage for the crash-resilience fix: a failed turn (e.g. a Bot
 * Connector 401) must be contained, not become an unhandled rejection that
 * crashes the whole process. The handler `.catch`es and 500s instead.
 */
describe("createTeamsServer", () => {
  async function listen(adapter: unknown) {
    const server = createTeamsServer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: adapter as any,
      port: 0,
      onTurnContext: async () => {},
    });
    const httpServer = await server.start();
    const { port } = httpServer.address() as AddressInfo;
    return { server, port };
  }

  it("contains a rejecting adapter.process and responds 500 (no crash)", async () => {
    const process = vi
      .fn()
      .mockRejectedValue(new Error("Unknown error type: 401 denied"));
    const { server, port } = await listen({ process });

    const res = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "message", text: "hi" }),
    });

    // Pre-fix this request hung forever (the rejection was `void`ed and `res`
    // was never written); now it is caught and answered.
    expect(res.status).toBe(500);
    expect(process).toHaveBeenCalledTimes(1);
    await server.stop();
  });

  it("serves the /healthz liveness probe", async () => {
    const { server, port } = await listen({ process: vi.fn() });
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    await server.stop();
  });
});

/**
 * Security: with credentials configured, an unauthenticated POST must never
 * reach `adapter.process`, because a forged activity's `serviceUrl` is where
 * the bot would send its own access token.
 */
describe("createTeamsServer authentication", () => {
  it("rejects a request without a Bot Framework token when credentialed", async () => {
    const process = vi.fn();
    const server = createTeamsServer({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      adapter: { process } as any,
      port: 0,
      authConfig: { clientId: "app-id", clientSecret: "s", tenantId: "t" },
      onTurnContext: async () => {},
    });
    const httpServer = await server.start();
    const { port } = httpServer.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        text: "hi",
        serviceUrl: "https://attacker.example",
        conversation: { id: "c" },
      }),
    });

    expect(res.status).toBe(401);
    expect(process).not.toHaveBeenCalled();
    await server.stop();
  });

  it("only trusts https Bot Connector serviceUrl hosts", () => {
    expect(isTrustedServiceUrl("https://smba.trafficmanager.net/amer/")).toBe(
      true,
    );
    expect(isTrustedServiceUrl("https://directline.botframework.com/")).toBe(
      true,
    );
    expect(isTrustedServiceUrl("https://evil.trafficmanager.net/")).toBe(false);
    expect(isTrustedServiceUrl("https://botframework.com.evil.example/")).toBe(
      false,
    );
    expect(isTrustedServiceUrl("http://smba.trafficmanager.net/")).toBe(false);
    expect(isTrustedServiceUrl("https://attacker.example/")).toBe(false);
    expect(isTrustedServiceUrl(undefined)).toBe(false);
    expect(
      isTrustedServiceUrl("https://bot.sovereign.example/", [
        ".sovereign.example",
      ]),
    ).toBe(true);
  });
});
