import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lambdaClient } from "@copilotkit/shared";
import { CopilotIntelligenceRuntime, CopilotRuntime } from "../core/runtime";
import { createCopilotHonoHandler } from "../endpoints/hono";
import { CopilotKitIntelligence } from "../intelligence-platform/client";

const trajectoryId = "trajectory-1";
const apiKey = "server-project-secret";
const grant = {
  joinToken: "single-use-browser-token",
  realtime: {
    clientUrl: "wss://gateway.example/client",
    topic: "trajectory:server-project:trajectory-1:capture",
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
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ ...grant, internalSecret: "must-not-reach-browser" }),
    );
  const identifyUser = vi.fn().mockResolvedValue({
    id: "server-user",
    name: "Server User",
  });
  const intelligence = new CopilotKitIntelligence({
    apiKey,
    apiUrl: "https://intelligence.example/",
    wsUrl: "wss://gateway.example",
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
  return { app, runtime, intelligence, identifyUser, upstream };
}

beforeEach(() => vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined));
afterEach(() => vi.restoreAllMocks());

describe.each(["single-route", "multi-route"] as const)(
  "trajectory connect through Hono (%s)",
  (mode) => {
    it("uses server identity and project credentials without an agent or Thread", async () => {
      const { app, upstream, identifyUser } = setup(mode);
      const request = connectRequest(mode, trajectoryId, {
        user: { id: "spoofed-user", name: "Spoof" },
        projectId: "spoofed-project",
        apiKey: "spoofed-key",
      });
      const response = await app.fetch(request);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual(grant);
      expect(identifyUser).toHaveBeenCalledExactlyOnceWith(request);
      expect(upstream).toHaveBeenCalledExactlyOnceWith(
        "https://intelligence.example/api/trajectories/trajectory-1/connect",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user: { id: "server-user", name: "Server User" },
          }),
          signal: request.signal,
        },
      );
    });

    it.each([
      "../another",
      "a/b",
      "a?project=other",
      "a#other",
      "x".repeat(129),
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
      [403, "FORBIDDEN"],
      [401, "TOKEN_INVALID"],
      [401, "IDENTITY_REQUIRED"],
    ])(
      "preserves a validated %s backend contract error",
      async (status, code) => {
        const { app, upstream } = setup(mode);
        upstream.mockResolvedValue(
          Response.json(
            { code, message: "Access denied", debug: { apiKey } },
            { status: Number(status) },
          ),
        );
        const response = await app.fetch(connectRequest(mode));
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({
          code,
          message: "Access denied",
        });
      },
    );

    it.each([
      { error: `Database failed with ${apiKey}` },
      { code: "FORBIDDEN", message: apiKey },
      { code: "UNRECOGNIZED", message: "internal error" },
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
      { ...grant, joinToken: "" },
      {
        ...grant,
        realtime: { ...grant.realtime, clientUrl: "https://bad.example" },
      },
      {
        ...grant,
        realtime: {
          ...grant.realtime,
          clientUrl: "wss://user:secret@gateway.example",
        },
      },
      { ...grant, realtime: { ...grant.realtime, topic: "" } },
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
