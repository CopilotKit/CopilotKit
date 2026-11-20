import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  mergeForwardableHeaders,
  resolveForwardHeadersPolicy,
} from "../../../../../packages/runtime/src/v2/runtime/handlers/header-utils";
import type { ForwardHeadersConfig } from "../../../../../packages/runtime/src/v2/runtime/handlers/header-utils";
import { DEMO_AUTH_HEADER } from "../../src/app/demos/auth/demo-token";

// Capture the route's real options/hook without initializing Mastra or making
// model calls. Exercise the runtime's header-policy implementation below; this
// is a wiring regression test, not a substitute for the shared D6 auth probe.
const captured = vi.hoisted(() => ({
  runtime: undefined as { forwardHeaders?: ForwardHeadersConfig } | undefined,
  onRequest: undefined as ((input: { request: Request }) => void) | undefined,
  handle: vi.fn(async () => new Response("ok")),
}));

vi.mock("@/mastra", () => ({ mastra: {} }));
vi.mock("@ag-ui/mastra", () => ({ getLocalAgent: () => ({}) }));
vi.mock("@/mastra/_header_forwarding", () => ({
  withForwardedHeaders: (_request: Request, fn: () => unknown) => fn(),
}));
vi.mock("@copilotkit/runtime/v2", () => ({
  CopilotRuntime: function (options: {
    forwardHeaders?: ForwardHeadersConfig;
  }) {
    captured.runtime = options;
  },
  createCopilotRuntimeHandler: ({
    hooks,
  }: {
    hooks: { onRequest: (input: { request: Request }) => void };
  }) => {
    captured.onRequest = hooks.onRequest;
    return captured.handle;
  },
}));

function request(authorization: string | undefined, method = "POST") {
  const headers = new Headers({
    "x-aimock-context": "mastra",
    "x-diag-run-id": "offline-auth-regression",
  });
  if (authorization !== undefined) headers.set("Authorization", authorization);
  return new Request("https://example.test/api/copilotkit-auth", {
    method,
    headers,
  }) as NextRequest;
}

beforeEach(async () => {
  vi.resetModules();
  captured.runtime = undefined;
  captured.onRequest = undefined;
  captured.handle.mockClear();
  await import("../../src/app/api/copilotkit-auth/[[...slug]]/route");
});

describe("Mastra auth route credential isolation", () => {
  it("accepts demo sign-in but does not forward that credential to the agent", () => {
    const req = request(DEMO_AUTH_HEADER);
    expect(captured.onRequest).toBeTypeOf("function");
    expect(() => captured.onRequest!({ request: req })).not.toThrow();

    const forwarded = mergeForwardableHeaders(
      undefined,
      req,
      resolveForwardHeadersPolicy(captured.runtime?.forwardHeaders),
    );
    // @ag-ui/mastra passes agent.headers into modelSettings.headers. Leaving
    // the browser bearer here can override the model provider's credential.
    expect(forwarded).not.toHaveProperty("authorization");
    expect(forwarded["x-aimock-context"]).toBe("mastra");
    expect(forwarded["x-diag-run-id"]).toBe("offline-auth-regression");
    expect(req.headers.get("authorization")).toBe(DEMO_AUTH_HEADER);
  });

  it.each([undefined, "Bearer invalid-demo-token"])(
    "still rejects missing/invalid sign-in (%s)",
    async (authorization) => {
      expect(captured.onRequest).toBeTypeOf("function");
      let rejection: unknown;
      try {
        captured.onRequest!({ request: request(authorization) });
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeInstanceOf(Response);
      expect((rejection as Response).status).toBe(401);
      expect(await (rejection as Response).json()).toMatchObject({
        error: "unauthorized",
      });
    },
  );

  it("preserves explicitly configured server-side agent credentials", () => {
    const forwarded = mergeForwardableHeaders(
      { Authorization: "Bearer offline-server-credential" },
      request(DEMO_AUTH_HEADER),
      resolveForwardHeadersPolicy(captured.runtime?.forwardHeaders),
    );
    expect(new Headers(forwarded).get("authorization")).toBe(
      "Bearer offline-server-credential",
    );
  });

  it.each(["GET", "POST"] as const)(
    "%s passes the original request to the authenticated handler",
    async (method) => {
      const route =
        await import("../../src/app/api/copilotkit-auth/[[...slug]]/route");
      const req = request(DEMO_AUTH_HEADER, method);
      await route[method](req);
      expect(captured.handle).toHaveBeenCalledOnce();
      expect(captured.handle).toHaveBeenCalledWith(req);
    },
  );
});
