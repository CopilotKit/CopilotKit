import { describe, expect, it, vi } from "vitest";
import {
  fetchInspectorLearning,
  InspectorLearningUnsupportedError,
} from "./inspector-learning.js";

const snapshot = {
  schemaVersion: 1,
  projectKey: "project-safe-key",
  snapshotVersion: "snapshot-1",
  webAppOrigin: "https://app.copilotkit.ai",
  configuration: { state: "not_configured" },
  pendingThreadCount: 0,
  run: { hasActiveRun: false, hasEverSucceeded: false, latest: null },
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
    runs: null,
  },
};

describe("fetchInspectorLearning", () => {
  it("uses the REST route with runtime auth options", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot));
    await fetchInspectorLearning({
      runtimeUrl: "https://runtime.example/api/copilotkit/",
      runtimeTransport: "rest",
      request: { agentId: "support", skillsPage: 2 },
      fetch,
      headers: { Authorization: "Bearer host-session" },
      credentials: "include",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://runtime.example/api/copilotkit/inspector-learning?agentId=support&skillsPage=2",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer host-session" },
        credentials: "include",
      }),
    );
  });

  it("uses the single endpoint envelope and maps 404 to unsupported", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(snapshot));
    await fetchInspectorLearning({
      runtimeUrl: "https://runtime.example/api/copilotkit",
      runtimeTransport: "single",
      request: { insightsPage: 3 },
      fetch,
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://runtime.example/api/copilotkit",
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      method: "inspector/learning",
      params: { insightsPage: "3" },
    });

    await expect(
      fetchInspectorLearning({
        runtimeUrl: "https://runtime.example/api/copilotkit",
        runtimeTransport: "rest",
        request: {},
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      }),
    ).rejects.toBeInstanceOf(InspectorLearningUnsupportedError);
  });

  it("rejects an invalid response at the browser boundary", async () => {
    await expect(
      fetchInspectorLearning({
        runtimeUrl: "https://runtime.example/api/copilotkit",
        runtimeTransport: "rest",
        request: {},
        fetch: vi.fn().mockResolvedValue(Response.json({ schemaVersion: 999 })),
      }),
    ).rejects.toThrow("response is invalid");
  });
});
