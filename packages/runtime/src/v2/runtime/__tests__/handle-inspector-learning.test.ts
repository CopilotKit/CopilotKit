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
      userId: "user-1",
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

  it("sends no grant when no access policy is configured", async () => {
    const fixture = runtime();
    await handleInspectorLearning({
      runtime: fixture,
      request: new Request("https://runtime.example/inspector-learning"),
    });
    const call = vi.mocked(fixture.intelligence!.getInspectorLearning).mock
      .calls[0]![0];
    expect(call).toMatchObject({ userId: "user-1" });
    expect(call).not.toHaveProperty("grant");
  });

  it("forwards the resolved access grant for the request user", async () => {
    const access = vi.fn().mockResolvedValue({
      permissions: { "learning.insights_skills": { agents: ["support"] } },
    });
    const fixture = runtime({ access });
    const request = new Request("https://runtime.example/inspector-learning");

    const response = await handleInspectorLearning({
      runtime: fixture,
      request,
    });

    expect(response.status).toBe(200);
    expect(access).toHaveBeenCalledWith({
      request,
      user: { id: "user-1", name: "Ada" },
      surface: "inspector",
    });
    expect(fixture.intelligence?.getInspectorLearning).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        grant: {
          permissions: { "learning.insights_skills": { agents: ["support"] } },
        },
      }),
    );
  });

  it("sends an explicit empty grant when the policy returns null", async () => {
    const fixture = runtime({ access: vi.fn().mockResolvedValue(null) });
    await handleInspectorLearning({
      runtime: fixture,
      request: new Request("https://runtime.example/inspector-learning"),
    });
    expect(fixture.intelligence?.getInspectorLearning).toHaveBeenCalledWith(
      expect.objectContaining({ grant: { permissions: {} } }),
    );
  });

  it("fails with 500 and does not proxy when the policy is malformed", async () => {
    const fixture = runtime({
      access: vi.fn().mockResolvedValue({ permissions: { "*": {} } }),
    });
    const response = await handleInspectorLearning({
      runtime: fixture,
      request: new Request("https://runtime.example/inspector-learning"),
    });
    expect(response.status).toBe(500);
    expect(fixture.intelligence?.getInspectorLearning).not.toHaveBeenCalled();
  });
});
