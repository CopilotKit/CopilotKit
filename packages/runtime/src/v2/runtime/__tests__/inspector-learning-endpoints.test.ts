import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotExpressHandler } from "../endpoints/express";
import { createCopilotHonoHandler } from "../endpoints/hono";

const snapshot = {
  schemaVersion: 1,
  projectKey: "project-safe-key",
  snapshotVersion: "snapshot-1",
  webAppOrigin: "https://app.copilotkit.ai",
  configuration: {
    state: "configured",
    container: { id: "container-1", name: "Production" },
  },
  pendingThreadCount: 0,
  pendingCandidateCount: 0,
  run: { hasActiveRun: false, hasEverSucceeded: true, latest: null },
  skillsPage: { page: 1, pageSize: 3, total: 0, totalPages: 0, items: [] },
  insightsPage: { page: 1, pageSize: 4, total: 0, totalPages: 0, items: [] },
  links: {
    learning: "https://app.copilotkit.ai/learning",
    candidates: null,
    runs: null,
  },
} as const;

function learningRuntime(): CopilotRuntimeLike {
  return {
    mode: "intelligence",
    debug: { enabled: true, events: false, lifecycle: false, verbose: false },
    identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "Ada" }),
    intelligence: { getInspectorLearning: vi.fn().mockResolvedValue(snapshot) },
  } as unknown as CopilotRuntimeLike;
}

describe("Inspector Learning endpoint wrappers", () => {
  it("forwards the Learning opt-in through Express", async () => {
    const app = express();
    app.use(
      createCopilotExpressHandler({
        runtime: learningRuntime(),
        basePath: "/",
        inspectorLearning: true,
      }),
    );

    expect((await request(app).get("/inspector-learning")).status).toBe(200);
  });

  it("forwards the Learning opt-in through Hono", async () => {
    const app = createCopilotHonoHandler({
      runtime: learningRuntime(),
      basePath: "/",
      inspectorLearning: true,
    });

    expect(
      (
        await app.fetch(
          new Request("https://runtime.example/inspector-learning"),
        )
      ).status,
    ).toBe(200);
  });
});
