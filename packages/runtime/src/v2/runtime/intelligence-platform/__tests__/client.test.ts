import { describe, it, expect, vi, beforeEach } from "vitest";
import { CopilotKitIntelligence } from "../client";

const fetchMock = vi.fn();
globalThis.fetch = fetchMock;
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function emptyResponse(status = 204) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: "No Content",
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(""),
  } as Response);
}

describe("CopilotKitIntelligence", () => {
  let client: CopilotKitIntelligence;

  beforeEach(() => {
    fetchMock.mockReset();
    consoleErrorSpy.mockClear();
    client = new CopilotKitIntelligence({
      apiUrl: "https://api.example.com",
      wsUrl: "wss://ws.example.com/socket",
      apiKey: "test-key",
    });
  });

  it("strips trailing slash from apiUrl", async () => {
    const c = new CopilotKitIntelligence({
      apiUrl: "https://api.example.com/",
      wsUrl: "wss://ws.example.com/socket",
      apiKey: "k",
    });
    fetchMock.mockReturnValue(jsonResponse({ threads: [], joinCode: "" }));
    await c.listThreads({ userId: "u", agentId: "a" });
    expect(fetchMock.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.example\.com\/api/,
    );
  });

  it("derives runner and client websocket URLs from a single intelligence websocket URL", () => {
    const c = new CopilotKitIntelligence({
      apiUrl: "https://api.example.com",
      wsUrl: "wss://ws.example.com",
      apiKey: "k",
    });

    expect(c.ɵgetRunnerWsUrl()).toBe("wss://ws.example.com/runner");
    expect(c.ɵgetClientWsUrl()).toBe("wss://ws.example.com/client");
  });

  it("sends Bearer authorization header", async () => {
    fetchMock.mockReturnValue(jsonResponse({ threads: [], joinCode: "" }));
    await client.listThreads({ userId: "u", agentId: "a" });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws on non-ok response", async () => {
    fetchMock.mockReturnValue(jsonResponse({ error: "nope" }, 403));
    await expect(
      client.listThreads({ userId: "u", agentId: "a" }),
    ).rejects.toThrow(/403/);
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
        "https://api.example.com/api/threads?userId=user-1&agentId=agent-1",
      );
      expect(opts.method).toBe("GET");
    });
  });

  describe("subscribeToThreads", () => {
    it("sends POST with userId and returns the join token", async () => {
      fetchMock.mockReturnValue(jsonResponse({ joinToken: "jt-subscribe" }));

      const result = await client.ɵsubscribeToThreads({
        userId: "user-1",
      });

      expect(result).toEqual({ joinToken: "jt-subscribe" });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/subscribe");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        userId: "user-1",
      });
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
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      const result = await client.updateThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
        updates: { name: "Renamed" },
      });

      expect(result).toEqual(thread);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1");
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

    it("fires onThreadUpdated with the returned thread", async () => {
      const onThreadUpdated = vi.fn();
      client = new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "test-key",
        onThreadUpdated,
      });
      const thread = { id: "t-1", name: "Renamed" };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      await client.updateThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
        updates: { name: "Renamed" },
      });

      expect(onThreadUpdated).toHaveBeenCalledWith(thread);
    });
  });

  describe("createThread", () => {
    it("sends POST to create endpoint with thread bootstrap payload", async () => {
      const thread = {
        id: "t-1",
        name: null,
        lastRunAt: "2026-01-01",
        lastUpdatedAt: "2026-01-02",
      };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      const result = await client.createThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(result).toEqual(thread);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });
    });

    it("fires onThreadCreated with the returned thread", async () => {
      const onThreadCreated = vi.fn();
      client = new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "test-key",
        onThreadCreated,
      });
      const thread = { id: "t-1", name: null };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      await client.createThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(onThreadCreated).toHaveBeenCalledWith(thread);
    });
  });

  describe("getThread", () => {
    it("sends GET to thread endpoint and unwraps the thread payload", async () => {
      const thread = {
        id: "t-1",
        name: "Thread",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-02",
      };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      const result = await client.getThread({ threadId: "t-1" });

      expect(result).toEqual(thread);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1");
      expect(opts.method).toBe("GET");
    });
  });

  describe("getThreadMessages", () => {
    it("sends GET to thread messages endpoint and returns the durable transcript", async () => {
      const payload = {
        messages: [
          {
            id: "m-1",
            role: "user",
            content: "Persisted",
          },
        ],
      };
      fetchMock.mockReturnValue(jsonResponse(payload));

      const result = await client.getThreadMessages({ threadId: "t-1" });

      expect(result).toEqual(payload);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1/messages");
      expect(opts.method).toBe("GET");
    });
  });

  describe("archiveThread", () => {
    it("patches the thread with archived=true", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({
          thread: { id: "t-1", name: "Archived", archived: true },
        }),
      );

      await client.archiveThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1");
      expect(opts.method).toBe("PATCH");
      expect(JSON.parse(opts.body)).toEqual({
        userId: "user-1",
        agentId: "agent-1",
        archived: true,
      });
    });

    it("fires onThreadUpdated after archiving", async () => {
      const onThreadUpdated = vi.fn();
      client = new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "test-key",
        onThreadUpdated,
      });
      const thread = { id: "t-1", name: "Archived", archived: true };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      await client.archiveThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(onThreadUpdated).toHaveBeenCalledWith(thread);
    });
  });

  describe("deleteThread", () => {
    it("sends DELETE with an audit reason in the body", async () => {
      fetchMock.mockReturnValue(jsonResponse(undefined));

      await client.deleteThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1");
      expect(opts.method).toBe("DELETE");
      expect(JSON.parse(opts.body)).toEqual({
        reason:
          "Deleted via CopilotKit runtime (userId=user-1, agentId=agent-1)",
      });
    });

    it("fires onThreadDeleted with the successful delete payload", async () => {
      const onThreadDeleted = vi.fn();
      client = new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "test-key",
        onThreadDeleted,
      });
      fetchMock.mockReturnValue(jsonResponse(undefined));

      await client.deleteThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(onThreadDeleted).toHaveBeenCalledWith({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });
    });

    it("swallows lifecycle callback errors after a successful request", async () => {
      client = new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "test-key",
        onThreadDeleted: () => {
          throw new Error("callback exploded");
        },
      });
      fetchMock.mockReturnValue(jsonResponse(undefined));

      await expect(
        client.deleteThread({
          threadId: "t-1",
          userId: "user-1",
          agentId: "agent-1",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("acquireThreadLock", () => {
    it("sends POST to lock endpoint and returns canonical run credentials", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({
          threadId: "t-1",
          runId: "r-1",
          joinToken: "jt-lock",
        }),
      );

      const result = await client.ɵacquireThreadLock({
        threadId: "t-1",
        runId: "r-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(result).toEqual({
        threadId: "t-1",
        runId: "r-1",
        joinToken: "jt-lock",
      });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1/lock");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        runId: "r-1",
        userId: "user-1",
        agentId: "agent-1",
      });
    });

    it("throws when lock is denied", async () => {
      fetchMock.mockReturnValue(jsonResponse("Thread is locked", 409));
      await expect(
        client.ɵacquireThreadLock({
          threadId: "t-1",
          runId: "r-1",
          userId: "user-1",
          agentId: "agent-1",
        }),
      ).rejects.toThrow(/409/);
    });

    it("sends compare-delete cleanup to the lock endpoint", async () => {
      fetchMock.mockReturnValue(emptyResponse());

      await client.ɵcleanupThreadLock({
        threadId: "t-1",
        runId: "r-1",
      });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1/lock");
      expect(opts.method).toBe("DELETE");
      expect(JSON.parse(opts.body)).toEqual({ runId: "r-1" });
    });
  });

  describe("getActiveJoinCode", () => {
    it("sends GET to join-code endpoint with userId query param and returns thread connection credentials", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ joinToken: "jt-active", joinCode: "jc-active" }),
      );

      const result = await client.ɵgetActiveJoinCode({
        threadId: "t-1",
        userId: "user-1",
      });

      expect(result).toEqual({ joinToken: "jt-active", joinCode: "jc-active" });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.example.com/api/threads/t-1/join-code?userId=user-1",
      );
      expect(opts.method).toBe("GET");
      expect(opts.body).toBeUndefined();
    });

    it("throws when no active join code exists", async () => {
      fetchMock.mockReturnValue(jsonResponse("Not found", 404));
      await expect(
        client.ɵgetActiveJoinCode({ threadId: "t-1", userId: "user-1" }),
      ).rejects.toThrow(/404/);
    });
  });

  describe("multi-listener subscriptions", () => {
    it("supports multiple onThreadCreated listeners", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      client.onThreadCreated(listener1);
      client.onThreadCreated(listener2);

      const thread = { id: "t-1", name: null };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      await client.createThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(listener1).toHaveBeenCalledWith(thread);
      expect(listener2).toHaveBeenCalledWith(thread);
    });

    it("unsubscribe removes a specific listener", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const unsub1 = client.onThreadCreated(listener1);
      client.onThreadCreated(listener2);

      unsub1();

      const thread = { id: "t-1", name: null };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      await client.createThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith(thread);
    });

    it("config callback and runtime listener both fire", async () => {
      const configCb = vi.fn();
      const runtimeCb = vi.fn();
      client = new CopilotKitIntelligence({
        apiUrl: "https://api.example.com",
        wsUrl: "wss://ws.example.com/socket",
        apiKey: "test-key",
        onThreadUpdated: configCb,
      });
      client.onThreadUpdated(runtimeCb);

      const thread = { id: "t-1", name: "Updated" };
      fetchMock.mockReturnValue(jsonResponse({ thread }));

      await client.updateThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
        updates: { name: "Updated" },
      });

      expect(configCb).toHaveBeenCalledWith(thread);
      expect(runtimeCb).toHaveBeenCalledWith(thread);
    });

    it("one failing listener does not prevent others from running", async () => {
      const failingCb = vi.fn(() => {
        throw new Error("boom");
      });
      const healthyCb = vi.fn();
      client.onThreadDeleted(failingCb);
      client.onThreadDeleted(healthyCb);

      fetchMock.mockReturnValue(jsonResponse(undefined));

      await client.deleteThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(failingCb).toHaveBeenCalled();
      expect(healthyCb).toHaveBeenCalledWith({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });
    });
  });

  describe("connectThread", () => {
    it("returns null on 204", async () => {
      fetchMock.mockReturnValue(emptyResponse());

      const result = await client.ɵconnectThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(result).toBeNull();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1/connect");
      expect(opts.method).toBe("POST");
      expect(JSON.parse(opts.body)).toEqual({
        userId: "user-1",
        agentId: "agent-1",
      });
    });

    it("returns credentials-only connect response", async () => {
      const payload = {
        threadId: "t-1",
        joinToken: "jt-connect",
      };
      fetchMock.mockReturnValue(jsonResponse(payload));

      const result = await client.ɵconnectThread({
        threadId: "t-1",
        userId: "user-1",
        agentId: "agent-1",
      });

      expect(result).toEqual(payload);
    });
  });
});
