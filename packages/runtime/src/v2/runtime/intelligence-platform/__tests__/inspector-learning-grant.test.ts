import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CopilotKitIntelligence,
  INTELLIGENCE_GRANT_HEADER,
  INTELLIGENCE_USER_ID_HEADER,
  PlatformRequestError,
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

  it("sends a grant naming non-ASCII agent IDs as ASCII-only JSON", async () => {
    // Validate headers the way a real fetch does: a header value must be a
    // ByteString, so a raw non-Latin-1 character throws before any request.
    const fetchMock = vi.fn().mockImplementation(async (url, init) => {
      new Headers(init.headers);
      return Response.json(snapshot);
    });
    vi.stubGlobal("fetch", fetchMock);
    const grant = {
      permissions: {
        "analytics.numbers": { agents: ["支援", "café", "a b", "🤖"] },
      },
    };

    await client().getInspectorLearning({ userId: "user-1", grant });

    const header = fetchMock.mock.calls[0]![1].headers["x-cpki-grant"];
    expect(header).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(header)).toEqual(grant);
  });

  it("omits both headers when the caller supplies neither", async () => {
    const fetchMock = mockFetch();
    await client().getInspectorLearning({});
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({
      Authorization: "Bearer cpk-project-key",
    });
  });
  describe("error responses", () => {
    const rejectWith = async (response: Response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      return client()
        .getInspectorLearning({})
        .then(
          () => {
            throw new Error("expected getInspectorLearning to reject");
          },
          (error: unknown) => error,
        );
    };

    it("carries the Intelligence error code on a governance denial", async () => {
      const error = await rejectWith(
        Response.json(
          {
            error: {
              code: "GOVERNANCE_PERMISSION_DENIED",
              message: "denied",
              category: "permission",
              retryable: false,
            },
          },
          { status: 403 },
        ),
      );
      expect(error).toBeInstanceOf(PlatformRequestError);
      expect(error).toMatchObject({
        status: 403,
        retryable: false,
        code: "GOVERNANCE_PERMISSION_DENIED",
      });
    });

    it("carries the Intelligence error code on an invalid grant", async () => {
      const error = await rejectWith(
        Response.json(
          { error: { code: "GOVERNANCE_GRANT_INVALID" } },
          { status: 400 },
        ),
      );
      expect(error).toMatchObject({
        status: 400,
        code: "GOVERNANCE_GRANT_INVALID",
      });
    });

    it.each([
      [
        "a non-JSON body",
        new Response("<html>bad gateway</html>", { status: 502 }),
      ],
      ["an empty body", new Response(null, { status: 503 })],
      [
        "a malformed code",
        Response.json(
          { error: { code: "not a code; <script>" } },
          { status: 403 },
        ),
      ],
      [
        "a non-string code",
        Response.json({ error: { code: 42 } }, { status: 403 }),
      ],
    ])("omits the code for %s", async (_label, response) => {
      const error = await rejectWith(response);
      expect(error).toBeInstanceOf(PlatformRequestError);
      expect((error as PlatformRequestError).code).toBeUndefined();
      expect((error as PlatformRequestError).status).toBe(response.status);
    });
  });
});
