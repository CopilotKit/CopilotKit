import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntelligencePlatformClient } from "../client";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

describe("IntelligencePlatformClient", () => {
  let client: IntelligencePlatformClient;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new IntelligencePlatformClient({
      apiUrl: "https://api.example.com",
      apiKey: "test-key",
    });
  });

  it("strips trailing slash from apiUrl", async () => {
    const c = new IntelligencePlatformClient({
      apiUrl: "https://api.example.com/",
      apiKey: "k",
    });
    fetchMock.mockReturnValue(jsonResponse({ threads: [], joinCode: "" }));
    await c.listThreads({ userId: "u", agentId: "a" });
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.example\.com\/v1/,
    );
  });

  it("sends Bearer authorization header", async () => {
    fetchMock.mockReturnValue(jsonResponse({ threads: [], joinCode: "" }));
    await client.listThreads({ userId: "u", agentId: "a" });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws on non-ok response", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockReturnValue(jsonResponse({ error: "nope" }, 403));
    await expect(
      client.listThreads({ userId: "u", agentId: "a" }),
    ).rejects.toThrow(/403/);
    consoleSpy.mockRestore();
  });

  describe("listThreads", () => {
    it("sends GET with userId and agentId query params", async () => {
      const payload = {
        threads: [
          {
            id: "t-1",
            name: "Thread",
            lastRunAt: "2026-01-01",
            lastUpdatedAt: "2026-01-01",
          },
        ],
        joinCode: "jc-list",
      };
      fetchMock.mockReturnValue(jsonResponse(payload));

      const result = await client.listThreads({
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(result).toEqual(payload);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.example.com/v1/threads?userId=user-1&agentId=agent-1",
      );
      expect(opts.method).toBe("GET");
    });
  });

  describe("updateThread", () => {
    it("sends PATCH with userId, agentId, and updates in body", async () => {
      const thread = {
        id: "t-1",
        name: "Renamed",
        lastRunAt: "2026-01-01",
        lastUpdatedAt: "2026-01-02",
      };
      fetchMock.mockReturnValue(jsonResponse(thread));

      const result = await client.updateThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
        updates: { name: "Renamed" },
      });

      expect(result).toEqual(thread);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/threads/t-1");
      expect(opts.method).toBe("PATCH");
      expect(JSON.parse(opts.body)).toEqual({
        userId: "user-1",
        agentId: "agent-1",
        name: "Renamed",
      });
    });

    it("encodes threadId in the URL", async () => {
      fetchMock.mockReturnValue(jsonResponse({}));
      await client.updateThread({
        threadId: "id/with spaces",
        userId: "u",
        agentId: "a",
        updates: {},
      });
      expect(fetchMock.mock.calls[0][0]).toContain(
        "/threads/id%2Fwith%20spaces",
      );
    });
  });

  describe("archiveThread", () => {
    it("sends POST to archive endpoint with userId and agentId", async () => {
      fetchMock.mockReturnValue(jsonResponse(undefined));

      await client.archiveThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/threads/t-1/archive");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        userId: "user-1",
        agentId: "agent-1",
      });
    });
  });

  describe("deleteThread", () => {
    it("sends DELETE with userId and agentId in body", async () => {
      fetchMock.mockReturnValue(jsonResponse(undefined));

      await client.deleteThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/threads/t-1");
      expect(opts.method).toBe("DELETE");
      expect(JSON.parse(opts.body)).toEqual({
        userId: "user-1",
        agentId: "agent-1",
      });
    });
  });

  describe("acquireThreadLock", () => {
    it("sends POST to lock endpoint and returns joinCode", async () => {
      fetchMock.mockReturnValue(jsonResponse({ joinCode: "jc-lock" }));

      const result = await client.acquireThreadLock({ threadId: "t-1" });

      expect(result).toEqual({ joinCode: "jc-lock" });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/threads/t-1/lock");
      expect(opts.method).toBe("POST");
    });

    it("throws when lock is denied", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      fetchMock.mockReturnValue(jsonResponse("Thread is locked", 409));
      await expect(
        client.acquireThreadLock({ threadId: "t-1" }),
      ).rejects.toThrow(/409/);
      consoleSpy.mockRestore();
    });
  });

  describe("getActiveJoinCode", () => {
    it("sends GET to join-code endpoint and returns joinCode", async () => {
      fetchMock.mockReturnValue(jsonResponse({ joinCode: "jc-active" }));

      const result = await client.getActiveJoinCode({ threadId: "t-1" });

      expect(result).toEqual({ joinCode: "jc-active" });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/v1/threads/t-1/join-code");
      expect(opts.method).toBe("GET");
    });

    it("throws when no active join code exists", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      fetchMock.mockReturnValue(jsonResponse("Not found", 404));
      await expect(
        client.getActiveJoinCode({ threadId: "t-1" }),
      ).rejects.toThrow(/404/);
      consoleSpy.mockRestore();
    });
  });
});
