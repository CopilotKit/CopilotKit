import { expect, test, vi } from "vitest";
import { lambdaClient, logger } from "@copilotkit/shared";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { createCopilotHonoHandler } from "../endpoints/hono";
import { CopilotKitIntelligence } from "../intelligence-platform/client";

const trajectoryId = "550e8400-e29b-41d4-a716-446655440000";
const user = { id: "verified-user", name: "Verified User" };
type Mode = "single-route" | "multi-route";

function setup(mode: Mode) {
  const telemetry = vi.spyOn(lambdaClient, "send").mockResolvedValue(undefined);
  const logError = vi
    .spyOn(logger, "error")
    .mockImplementation(() => undefined);
  const upstream = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      Response.json({ trajectoryId, joinToken: "single-use-token" }),
    );
  const selector = vi.fn(async () => ["server-space"]);
  const identifyUser = vi.fn(async (_request: Request) => user);
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    identifyUser,
    intelligence: new CopilotKitIntelligence({
      apiKey: "server-project-key",
      apiUrl: "https://intelligence.example",
      wsUrl: "wss://gateway.example",
      getTrajectoryLearningContainerIds: selector,
    }),
  });
  const app = createCopilotHonoHandler({ runtime, mode, basePath: "/runtime" });
  const spoofedBody = {
    user: { id: "browser-user", name: "Browser User" },
    appUserId: "browser-user",
    projectId: "browser-project",
    learningContainerIds: ["browser-space"],
  };
  const request = new Request(
    mode === "single-route"
      ? "https://runtime.example/runtime"
      : `https://runtime.example/runtime/trajectory/${trajectoryId}/connect`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "single-route"
          ? {
              method: "trajectory/connect",
              params: { trajectoryId, learningContainerIds: ["param-space"] },
              body: spoofedBody,
            }
          : spoofedBody,
      ),
    },
  );
  return {
    app,
    request,
    selector,
    identifyUser,
    upstream,
    logError,
    teardown: () => {
      upstream.mockRestore();
      telemetry.mockRestore();
      logError.mockRestore();
    },
  };
}

test.each(["single-route", "multi-route"] as const)(
  "%s uses only the authenticated server selector for Trajectory assignments",
  async (mode) => {
    const fixture = setup(mode);
    try {
      const response = await fixture.app.fetch(fixture.request);

      expect(response.status).toBe(200);
      expect(fixture.identifyUser).toHaveBeenCalledExactlyOnceWith(
        fixture.request,
      );
      expect(fixture.selector).toHaveBeenCalledExactlyOnceWith(
        { trajectoryId, user },
        expect.any(AbortSignal),
      );
      expect(fixture.upstream).toHaveBeenCalledExactlyOnceWith(
        "https://intelligence.example/api/trajectories/join",
        expect.objectContaining({
          headers: {
            Authorization: "Bearer server-project-key",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            trajectoryId,
            appUserId: user.id,
            learningContainerIds: ["server-space"],
          }),
        }),
      );
    } finally {
      fixture.teardown();
    }
  },
);

test.each(["single-route", "multi-route"] as const)(
  "%s does not run the Space selector before successful user identification",
  async (mode) => {
    const fixture = setup(mode);
    fixture.identifyUser.mockResolvedValue({ id: "", name: "Rejected User" });
    try {
      const response = await fixture.app.fetch(fixture.request);

      expect(response.status).toBe(401);
      expect(fixture.selector).not.toHaveBeenCalled();
      expect(fixture.upstream).not.toHaveBeenCalled();
    } finally {
      fixture.teardown();
    }
  },
);

test.each(["single-route", "multi-route"] as const)(
  "%s fails closed when the Space selector rejects and hides its private error",
  async (mode) => {
    const fixture = setup(mode);
    fixture.selector.mockRejectedValue(
      new Error("private tenant policy detail"),
    );
    try {
      const response = await fixture.app.fetch(fixture.request);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        code: "LEARNING_CONTAINER_SELECTION_FAILED",
        message: "Failed to resolve Trajectory Learning Containers",
      });
      expect(fixture.logError).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Failed to resolve Trajectory Learning Containers",
      );
      expect(fixture.upstream).not.toHaveBeenCalled();
    } finally {
      fixture.teardown();
    }
  },
);

test.each([
  { label: "invalid ID", ids: [""] },
  {
    label: "over 100 IDs",
    ids: Array.from({ length: 101 }, (_, index) => `space-${index}`),
  },
])(
  "a server selector with $label returns a terminal configuration error",
  async ({ ids }) => {
    const fixture = setup("single-route");
    fixture.selector.mockResolvedValue(ids);
    try {
      const response = await fixture.app.fetch(fixture.request);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        code: "LEARNING_CONTAINER_SELECTION_FAILED",
        message: "Failed to resolve Trajectory Learning Containers",
      });
      expect(fixture.logError).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        "Failed to resolve Trajectory Learning Containers",
      );
      expect(fixture.upstream).not.toHaveBeenCalled();
    } finally {
      fixture.teardown();
    }
  },
);
