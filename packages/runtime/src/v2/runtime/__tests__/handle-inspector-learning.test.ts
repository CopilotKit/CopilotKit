import { describe, expect, it, vi } from "vitest";
import type { CopilotRuntimeLike } from "../core/runtime";
import { handleInspectorLearning } from "../handlers/handle-inspector-learning";

const snapshot = {
  schemaVersion: 1,
  projectKey: "project-safe-key",
  snapshotVersion: "snapshot-1",
  webAppOrigin: "https://app.copilotkit.ai",
  configuration: {
    state: "configured",
    container: { id: "container-1", name: "Production" },
  },
  pendingThreadCount: 2,
  run: { hasActiveRun: false, hasEverSucceeded: true, latest: null },
  pendingCandidateCount: 0,
  skillsPage: {
    page: 1,
    pageSize: 3,
    total: 0,
    totalPages: 0,
    items: [],
  },
  insightsPage: {
    page: 1,
    pageSize: 4,
    total: 0,
    totalPages: 0,
    items: [],
  },
  links: {
    learning: "https://app.copilotkit.ai/learning",
    candidates: null,
    runs: "https://app.copilotkit.ai/learning/runs",
  },
} as const;

function runtime(overrides: Record<string, unknown> = {}): CopilotRuntimeLike {
  return {
    mode: "intelligence",
    intelligence: { getInspectorLearning: vi.fn().mockResolvedValue(snapshot) },
    identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "Ada" }),
    learning: { containerId: "container-static" },
    ...overrides,
  } as unknown as CopilotRuntimeLike;
}

describe("handleInspectorLearning", () => {
  it("uses only server-owned container scope and preserves browser pagination", async () => {
    const fixture = runtime();
    const response = await handleInspectorLearning({
      runtime: fixture,
      request: new Request(
        "https://runtime.example/inspector-learning?agentId=support&skillsPage=2",
      ),
    });

    expect(response.status).toBe(200);
    expect(fixture.intelligence?.getInspectorLearning).toHaveBeenCalledWith({
      agentId: "support",
      skillsPage: 2,
      runtimeContainerId: "container-static",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it("rejects unknown scope fields", async () => {
    const rejected = await handleInspectorLearning({
      runtime: runtime(),
      request: new Request(
        "https://runtime.example/inspector-learning?runtimeContainerId=attacker-scope",
      ),
    });
    expect(rejected.status).toBe(400);
  });

  it("hides the route for non-Intelligence runtimes", async () => {
    const fixture = runtime({ mode: "local" });
    const response = await handleInspectorLearning({
      runtime: fixture,
      request: new Request("https://runtime.example/inspector-learning"),
    });
    expect(response.status).toBe(404);
    expect(fixture.intelligence?.getInspectorLearning).not.toHaveBeenCalled();
  });

  it("requires a resolved request user before proxying Learning", async () => {
    const identifyUser = vi.fn().mockResolvedValue({ id: "", name: "Ada" });
    const fixture = runtime({ identifyUser });

    const response = await handleInspectorLearning({
      runtime: fixture,
      request: new Request("https://runtime.example/inspector-learning"),
    });

    expect(response.status).toBe(400);
    expect(identifyUser).toHaveBeenCalledOnce();
    expect(fixture.intelligence?.getInspectorLearning).not.toHaveBeenCalled();
  });
});
