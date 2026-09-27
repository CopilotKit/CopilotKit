import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitIntelligence,
  INTELLIGENCE_GRANT_HEADER,
  INTELLIGENCE_USER_ID_HEADER,
} from "../client";

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
  run: { hasActiveRun: false, hasEverSucceeded: true, latest: null },
  pendingCandidateCount: 0,
  skillsPage: { page: 1, pageSize: 3, total: 0, totalPages: 0, items: [] },
  insightsPage: { page: 1, pageSize: 4, total: 0, totalPages: 0, items: [] },
  links: {
    learning: "https://app.copilotkit.ai/learning",
    candidates: null,
    runs: "https://app.copilotkit.ai/learning/runs",
  },
};

function client() {
  return new CopilotKitIntelligence({
    apiUrl: "https://api.example.com",
    wsUrl: "wss://ws.example.com/socket",
    apiKey: "cpk-project-key",
  });
}

function mockFetch() {
  const fetchMock = vi
    .fn()
    .mockImplementation(async () => Response.json(snapshot));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("getInspectorLearning identity and grant headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the documented header names", () => {
    expect(INTELLIGENCE_USER_ID_HEADER).toBe("x-cpki-user-id");
    expect(INTELLIGENCE_GRANT_HEADER).toBe("x-cpki-grant");
  });

  it("sends the user id and the grant as JSON", async () => {
    const fetchMock = mockFetch();
    const grant = {
      permissions: {
        "analytics.numbers": { agents: "*" as const },
        "conversations.text": { agents: ["support"] },
      },
    };

    await client().getInspectorLearning({ userId: "user-1", grant });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example.com/api/inspector/learning");
    expect(init.headers).toEqual({
      Authorization: "Bearer cpk-project-key",
      "x-cpki-user-id": "user-1",
      "x-cpki-grant": JSON.stringify(grant),
    });
  });

  it("omits both headers when the caller supplies neither", async () => {
    const fetchMock = mockFetch();
    await client().getInspectorLearning({});
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({
      Authorization: "Bearer cpk-project-key",
    });
  });
});
