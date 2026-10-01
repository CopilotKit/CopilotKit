import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { CopilotIntelligenceRuntime, CopilotRuntime } from "../core/runtime";
import { createCopilotHonoHandler } from "../endpoints/hono";
import { CopilotKitIntelligence } from "../intelligence-platform/client";

const trajectoryId = "550e8400-e29b-41d4-a716-446655440000";
const apiKey = "server-project-secret";
const joinResponse = { joinToken: "single-use-browser-token", trajectoryId };
const grant = {
  joinToken: joinResponse.joinToken,
  realtime: {
    clientUrl: "wss://gateway.example/client",
    topic: `trajectory:${trajectoryId}`,
  },
};

type Mode = "single-route" | "multi-route";

function connectRequest(
  mode: Mode,
  id: unknown = trajectoryId,
  body: unknown = {},
): Request {
  return new Request(
    mode === "single-route"
      ? "https://runtime.example/api/copilotkit"
      : `https://runtime.example/api/copilotkit/trajectory/${encodeURIComponent(String(id))}/connect`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-session",
        "X-User-Id": "spoofed-user",
        "X-Project-Id": "spoofed-project",
        Cookie: "session=verified-by-runtime",
      },
      body: JSON.stringify(
        mode === "single-route"
          ? {
              method: "trajectory/connect",
              params: { trajectoryId: id, projectId: "spoofed-project" },
              body,
            }
          : body,
      ),
    },
  );
}

function setup(mode: Mode) {
  const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      ...joinResponse,
      internalSecret: "must-not-reach-browser",
      realtime: { clientUrl: "wss://untrusted.example", topic: "other" },
    }),
  );
  const identifyUser = vi.fn().mockResolvedValue({
    id: "server-user",
    name: "Server User",
  });
  const getLearningContainerId = vi.fn(() => "run-container");
  const intelligence = new CopilotKitIntelligence({
    apiKey,
    apiUrl: "https://intelligence.example/",
    wsUrl: "wss://gateway.example",
    getLearningContainerId,
  });
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence,
    identifyUser,
  });
  const app = createCopilotHonoHandler({
    runtime,
    mode,
    basePath: "/api/copilotkit",
  });
  return {
    app,
    runtime,
    intelligence,
    identifyUser,
    upstream,
    getLearningContainerId,
  };
}

beforeEach(() => vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined));
afterEach(() => vi.restoreAllMocks());

describe.each(["single-route", "multi-route"] as const)(
  "trajectory connect through Hono (%s)",
  (mode) => {
    it("uses server identity and project credentials without an agent or Thread", async () => {
      const { app, upstream, identifyUser, getLearningContainerId } =
        setup(mode);
      const request = connectRequest(mode, trajectoryId, {
        user: { id: "spoofed-user", name: "Spoof" },
        projectId: "spoofed-project",
        apiKey: "spoofed-key",
        appUserId: "spoofed-bare-user",
        learningContainerIds: ["browser-container"],
      });
      const response = await app.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual(grant);
      expect(identifyUser).toHaveBeenCalledExactlyOnceWith(request);
      expect(getLearningContainerId).not.toHaveBeenCalled();
      expect(upstream).toHaveBeenCalledExactlyOnceWith(
        "https://intelligence.example/api/trajectories/join",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trajectoryId,
            appUserId: "server-user",
          }),
          signal: request.signal,
          redirect: "error",
        },
      );
    });

    it.each([
      "../another",
      "a/b",
      "a?project=other",
      "a#other",
      "x".repeat(129),
      "trajectory-1",
    ])(
      "rejects unsafe trajectory ID %s before resolving identity",
      async (id) => {
        const { app, upstream, identifyUser } = setup(mode);
        const response = await app.fetch(connectRequest(mode, id));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          code: "INVALID_REQUEST",
          message: "A valid trajectoryId is required",
        });
        expect(identifyUser).not.toHaveBeenCalled();
        expect(upstream).not.toHaveBeenCalled();
      },
    );

    it.each([{ id: "", name: "Name" }, { id: "user", name: "" }, null])(
      "requires a valid server identity (%j)",
      async (identity) => {
        const { app, upstream, identifyUser } = setup(mode);
        identifyUser.mockResolvedValue(identity);
        const response = await app.fetch(connectRequest(mode));
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
          code: "IDENTITY_REQUIRED",
        });
        expect(upstream).not.toHaveBeenCalled();
      },
    );

    it("does not expose identifyUser failures or contact Intelligence", async () => {
      const { app, upstream, identifyUser } = setup(mode);
      identifyUser.mockRejectedValue(new Error("secret authentication detail"));
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        code: "IDENTITY_REQUIRED",
        message: "Trajectory capture requires an identified user",
      });
      expect(upstream).not.toHaveBeenCalled();
    });

    it.each([
      [401, "AUTH_UNAUTHENTICATED"],
      [400, "VALIDATION_ERROR"],
      [409, "TRAJECTORY_APP_USER_CONFLICT"],
      [404, "LEARNING_CONTAINER_NOT_FOUND"],
      [429, "RATE_LIMIT_EXCEEDED"],
      [500, "INTERNAL_SERVER_ERROR"],
      [503, "MARKETPLACE_LICENSE_REQUIRED"],
    ])(
      "preserves a validated %s backend contract error",
      async (status, code) => {
        const { app, upstream } = setup(mode);
        upstream.mockResolvedValue(
          Response.json(
            {
              error: {
                code,
                message: "Access denied",
                category: "auth",
                retryable: false,
              },
              requestId: "request-1",
              traceId: "trace-1",
              debug: { apiKey },
            },
            { status: Number(status) },
          ),
        );
        const response = await app.fetch(connectRequest(mode));
        expect(response.status).toBe(status);
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(await response.json()).toEqual({
          code,
          message: "Access denied",
        });
      },
    );

    it.each([
      { error: `Database failed with ${apiKey}` },
      { error: { code: "AUTH_UNAUTHENTICATED", message: apiKey } },
      { error: { code: "UNRECOGNIZED", message: "internal error" } },
    ])("does not forward a non-public backend error (%j)", async (error) => {
      const { app, upstream } = setup(mode);
      upstream.mockResolvedValue(Response.json(error, { status: 503 }));
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        code: "CONNECTION_FAILED",
        message: "Intelligence rejected the trajectory connection request",
      });
    });

    it.each([
      { ...joinResponse, joinToken: "" },
      { ...joinResponse, trajectoryId: "not-a-uuid" },
      { ...joinResponse, trajectoryId: "550e8400-e29b-41d4-a716-446655440001" },
      { joinToken: joinResponse.joinToken },
      {},
    ])("rejects a malformed connection grant (%j)", async (payload) => {
      const { app, upstream } = setup(mode);
      upstream.mockResolvedValue(Response.json(payload));
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        code: "CONNECTION_FAILED",
      });
    });

    it("reports an unavailable backend route without exposing its response body", async () => {
      const { app, upstream } = setup(mode);
      upstream.mockResolvedValue(
        new Response("<html>internal deployment detail</html>", {
          status: 404,
        }),
      );
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        code: "CONNECTION_FAILED",
        message: "Intelligence rejected the trajectory connection request",
      });
    });

    it("sanitizes a network failure", async () => {
      const { app, upstream } = setup(mode);
      upstream.mockRejectedValue(
        new Error(`connection failed using ${apiKey}`),
      );
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        code: "CONNECTION_FAILED",
        message: "Could not connect to Intelligence",
      });
    });

    it("returns IDENTITY_REQUIRED when identifyUser is missing", async () => {
      const { runtime, upstream } = setup(mode);
      Object.defineProperty(runtime, "identifyUser", { value: undefined });
      const app = createCopilotHonoHandler({
        runtime,
        mode,
        basePath: "/api/copilotkit",
      });
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "IDENTITY_REQUIRED",
      });
      expect(upstream).not.toHaveBeenCalled();
    });

    it("requires Intelligence configuration", async () => {
      const app = createCopilotHonoHandler({
        runtime: new CopilotRuntime({ agents: {} }),
        mode,
        basePath: "/api/copilotkit",
      });
      const response = await app.fetch(connectRequest(mode));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "CONNECTION_FAILED",
      });
    });
  },
);

it.each([null, 123, "", ".", ".."])(
  "rejects a missing or invalid envelope trajectoryId (%j)",
  async (id) => {
    const { app, upstream } = setup("single-route");
    const request = connectRequest("single-route", id);
    const response = await app.fetch(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(upstream).not.toHaveBeenCalled();
  },
);
