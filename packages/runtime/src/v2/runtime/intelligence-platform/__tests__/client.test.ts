import { describe, it, expect, test, vi, beforeEach } from "vitest";
import { CopilotKitIntelligence, PlatformRequestError } from "../client";
import {
  findForbiddenPublicKeyPaths,
  READY_RUNTIME_ENTITLEMENTS,
} from "../../__tests__/runtime-entitlement-test-utils";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

const ACTIVE_MANAGED_RUNTIME_ENTITLEMENT_TRANSPORT = {
  organizationId: "org-private",
  source: "managedOrgSubscription",
  active: true,
  features: { threads: true },
  limits: { seats: 25 },
  planCode: "pro",
  entitlementSource: "stripe",
} as const;

const NORMALIZED_ACTIVE_MANAGED_RUNTIME_ENTITLEMENT = {
  status: "ready",
  entitlement: {
    source: "managedOrgSubscription",
    active: true,
    features: { threads: true },
    limits: { seats: 25 },
    planCode: "pro",
    entitlementSource: "stripe",
  },
} as const;

/** Build a real JSON response for the shared platform fetch mock. */
function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "content-type": "application/json" },
    }),
  );
}

/** Build a real text response for response-parser failure coverage. */
function textResponse(body: string, status = 200) {
  return Promise.resolve(
    new Response(body, {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "content-type": "text/plain" },
    }),
  );
}

/** Build a real empty response for successful no-content client operations. */
function emptyResponse(status = 204) {
  return Promise.resolve(
    new Response(null, {
      status,
      statusText: "No Content",
    }),
  );
}

/** Build an entitlement client with a trailing-slash URL and project API key. */
function runtimeEntitlementsClient() {
  fetchMock.mockReset();
  return new CopilotKitIntelligence({
    apiUrl: "https://api.example.com/",
    wsUrl: "wss://ws.example.com/socket",
    apiKey: "cpk-project-key",
  });
}

/** Require one HTTP-success body to fail strict Runtime entitlement parsing. */
async function expectRuntimeEntitlementValidationError(
  response: Promise<Response>,
): Promise<PlatformRequestError> {
  const client = runtimeEntitlementsClient();
  fetchMock.mockReturnValue(response);

  const error: unknown = await client
    .getRuntimeEntitlements()
    .catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(PlatformRequestError);
  if (!(error instanceof PlatformRequestError)) {
    throw new Error("Expected a typed Runtime entitlement validation error");
  }
  expect({ name: error.name, status: error.status }).toEqual({
    name: "PlatformRequestError",
    status: 502,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  return error;
}

test("getRuntimeEntitlements normalizes the current flat managed App API response", async () => {
  const client = runtimeEntitlementsClient();
  fetchMock.mockReturnValue(
    jsonResponse(ACTIVE_MANAGED_RUNTIME_ENTITLEMENT_TRANSPORT),
  );

  const result = await client.getRuntimeEntitlements();

  expect(result).toEqual(NORMALIZED_ACTIVE_MANAGED_RUNTIME_ENTITLEMENT);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example.com/api/entitlements/runtime",
    expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({
        Authorization: "Bearer cpk-project-key",
      }),
    }),
  );
});

test("getRuntimeEntitlements normalizes an inactive self-hosted App API response", async () => {
  const client = runtimeEntitlementsClient();
  fetchMock.mockReturnValue(
    jsonResponse({
      organizationId: "org-private",
      source: "selfHostedDeploymentLicense",
      active: false,
      features: {},
      limits: {},
    }),
  );

  const result = await client.getRuntimeEntitlements();

  expect(result).toEqual({
    status: "ready",
    entitlement: {
      source: "selfHostedDeploymentLicense",
      active: false,
      features: {},
      limits: {},
    },
  });
  expect(findForbiddenPublicKeyPaths(result)).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("recursive forbidden-key control detects identity and credential leaks", () => {
  const leakedProjection = {
    organizationId: "org-leaked",
    entitlement: {
      nested: [{ telemetry_id: "telemetry-leaked" }],
      licenseToken: "license-leaked",
    },
  };

  expect(findForbiddenPublicKeyPaths(leakedProjection)).toEqual([
    "$.organizationId",
    "$.entitlement.nested[0].telemetry_id",
    "$.entitlement.licenseToken",
  ]);
});

test("getRuntimeEntitlements aborts a bounded request with a typed timeout error", async () => {
  vi.useFakeTimers();
  try {
    const privateAbortDetail = "private-upstream-timeout-detail";
    const client = runtimeEntitlementsClient();
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException(privateAbortDetail, "AbortError"));
          });
        }),
    );

    const request = client.getRuntimeEntitlements();
    const capturedError = request.catch((error: unknown) => error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const signal = fetchMock.mock.calls[0][1].signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await vi.advanceTimersToNextTimerAsync();

    expect(signal.aborted).toBe(true);
    const error = await capturedError;
    expect(error).toBeInstanceOf(PlatformRequestError);
    if (!(error instanceof PlatformRequestError)) {
      throw new Error("Expected a typed Runtime entitlement timeout error");
    }
    expect(error.status).toBe(504);
    expect(error.message).not.toContain(privateAbortDetail);
  } finally {
    vi.useRealTimers();
  }
});

const UNKNOWN_FIELD_PRIVATE_VALUE = "private-runtime-entitlement-value";

test.each([
  {
    label: "flat transport",
    response: {
      ...ACTIVE_MANAGED_RUNTIME_ENTITLEMENT_TRANSPORT,
      unexpected: UNKNOWN_FIELD_PRIVATE_VALUE,
    },
  },
])(
  "getRuntimeEntitlements rejects a generic unknown property in the $label without leaking its value",
  async ({ response }) => {
    const error = await expectRuntimeEntitlementValidationError(
      jsonResponse(response),
    );

    expect(error.message).not.toContain(UNKNOWN_FIELD_PRIVATE_VALUE);
  },
);

test.each([
  ["non-JSON", () => textResponse("not json")],
  [
    "wrong active type",
    () =>
      jsonResponse({
        ...ACTIVE_MANAGED_RUNTIME_ENTITLEMENT_TRANSPORT,
        active: "yes",
      }),
  ],
  [
    "missing organizationId",
    () =>
      jsonResponse({
        source: "managedOrgSubscription",
        active: true,
        features: { threads: true },
        limits: {},
      }),
  ],
  [
    "unknown source enum",
    () =>
      jsonResponse({
        ...ACTIVE_MANAGED_RUNTIME_ENTITLEMENT_TRANSPORT,
        source: "managed",
      }),
  ],
  [
    "public ready union used as the private transport",
    () => jsonResponse(READY_RUNTIME_ENTITLEMENTS),
  ],
])(
  "getRuntimeEntitlements rejects %s successful body with a typed validation error",
  async (_label, response) => {
    await expectRuntimeEntitlementValidationError(response());
  },
);

test.each([300, 401, 503, 599])(
  "getRuntimeEntitlements rejects non-OK status %i after disposing without reading or leaking its body",
  async (status) => {
    consoleErrorSpy.mockClear();
    const client = runtimeEntitlementsClient();
    const privateUpstreamDetail = `private-upstream-detail-${status}`;
    const upstreamResponse = new Response(
      JSON.stringify({ error: privateUpstreamDetail }),
      { status },
    );
    fetchMock.mockResolvedValue(upstreamResponse);

    const error: unknown = await client
      .getRuntimeEntitlements()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PlatformRequestError);
    if (!(error instanceof PlatformRequestError)) {
      throw new Error("Expected a typed Runtime entitlement status error");
    }
    expect(error.status).toBe(status);
    expect(error.message).toBe(
      `Runtime entitlement request failed with status ${status}`,
    );
    expect(error.message).not.toContain(privateUpstreamDetail);
    expect(upstreamResponse.bodyUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
      privateUpstreamDetail,
    );
  },
);

test("getRuntimeEntitlements bounds stalled non-OK response disposal without leaking its body", async () => {
  vi.useFakeTimers();
  try {
    consoleErrorSpy.mockClear();
    const privateUpstreamDetail = "private-stalled-error-body-detail";
    let requestSignal: AbortSignal | null | undefined;
    let disposalStarted = false;
    const upstreamResponse = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          disposalStarted = true;
          return new Promise<void>((_resolve, reject) => {
            /** Reject stalled disposal when the request deadline aborts. */
            const rejectOnAbort = () => {
              reject(new DOMException(privateUpstreamDetail, "AbortError"));
            };
            if (requestSignal?.aborted === true) {
              rejectOnAbort();
            } else {
              requestSignal?.addEventListener("abort", rejectOnAbort, {
                once: true,
              });
            }
          });
        },
      }),
      { status: 503 },
    );
    const client = runtimeEntitlementsClient();
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal;
        return Promise.resolve(upstreamResponse);
      },
    );

    const request = client.getRuntimeEntitlements();
    const capturedError = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);

    expect(disposalStarted).toBe(true);
    expect(requestSignal?.aborted).toBe(false);

    await vi.advanceTimersToNextTimerAsync();

    const error = await capturedError;
    expect(error).toBeInstanceOf(PlatformRequestError);
    if (!(error instanceof PlatformRequestError)) {
      throw new Error("Expected a typed Runtime entitlement timeout error");
    }
    expect(error.status).toBe(504);
    expect(error.message).toBe("Runtime entitlement request timed out");
    expect(error.message).not.toContain(privateUpstreamDetail);
    expect(upstreamResponse.bodyUsed).toBe(true);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
      privateUpstreamDetail,
    );
  } finally {
    vi.useRealTimers();
  }
});

/*
 * Existing client coverage follows. These tests predate the repository's flat
 * test convention; new Runtime entitlement coverage above remains flat.
 */

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

  describe("listMemories", () => {
    it("sends GET /api/memories with the user in the x-cpki-user-id header", async () => {
      const payload = {
        memories: [
          {
            id: "m-1",
            kind: "topical",
            scope: "user",
            content: "User's dog is called Pepe.",
            sourceThreadIds: [],
            invalidatedAt: null,
          },
        ],
      };
      fetchMock.mockReturnValue(jsonResponse(payload));

      const result = await client.listMemories({ userId: "user-1" });

      expect(result).toEqual(payload);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/memories");
      expect(opts.method).toBe("GET");
      // The platform scopes by header, not a query param.
      expect(opts.headers["x-cpki-user-id"]).toBe("user-1");
      expect(opts.headers.Authorization).toBe("Bearer test-key");
    });

    it("forwards includeInvalidated as a query param", async () => {
      fetchMock.mockReturnValue(jsonResponse({ memories: [] }));

      await client.listMemories({ userId: "user-1", includeInvalidated: true });

      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example.com/api/memories?includeInvalidated=true",
      );
    });
  });

  describe("memory mutations", () => {
    it("createMemory POSTs /api/memories with the user header + body", async () => {
      fetchMock.mockReturnValue(
        jsonResponse(
          {
            id: "m1",
            kind: "topical",
            scope: "user",
            content: "c",
            sourceThreadIds: [],
            invalidatedAt: null,
            absorbed: false,
          },
          201,
        ),
      );

      const res = await client.createMemory({
        userId: "user-1",
        content: "c",
        kind: "topical",
        scope: "user",
      });

      expect(res.id).toBe("m1");
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/memories");
      expect(opts.method).toBe("POST");
      expect(opts.headers["x-cpki-user-id"]).toBe("user-1");
      expect(JSON.parse(opts.body)).toEqual({
        content: "c",
        kind: "topical",
        scope: "user",
        sourceThreadIds: [],
      });
    });

    it("createMemory omits scope from the body when not provided (platform defaults it)", async () => {
      fetchMock.mockReturnValue(
        jsonResponse(
          {
            id: "m1",
            kind: "topical",
            scope: "user",
            content: "c",
            sourceThreadIds: [],
            invalidatedAt: null,
            absorbed: false,
          },
          201,
        ),
      );

      await client.createMemory({
        userId: "user-1",
        content: "c",
        kind: "topical",
      });

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body).not.toHaveProperty("scope");
      expect(body).toEqual({
        content: "c",
        kind: "topical",
        sourceThreadIds: [],
      });
    });

    it("updateMemory PATCHes /api/memories/:id (supersede) and returns retiredId", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({
          id: "m2",
          kind: "topical",
          scope: "user",
          content: "c2",
          sourceThreadIds: [],
          invalidatedAt: null,
          retiredId: "m1",
        }),
      );

      const res = await client.updateMemory({
        userId: "user-1",
        id: "m1",
        content: "c2",
        kind: "topical",
        scope: "user",
      });

      expect(res.retiredId).toBe("m1");
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/memories/m1");
      expect(opts.method).toBe("PATCH");
      expect(opts.headers["x-cpki-user-id"]).toBe("user-1");
    });

    it("removeMemory DELETEs /api/memories/:id with the user header", async () => {
      fetchMock.mockReturnValue(emptyResponse(204));

      await client.removeMemory({ userId: "user-1", id: "m1" });

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/memories/m1");
      expect(opts.method).toBe("DELETE");
      expect(opts.headers["x-cpki-user-id"]).toBe("user-1");
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

  describe("subscribeToMemories", () => {
    it("sends POST identifying the user via the x-cpki-user-id header and returns the join token + code", async () => {
      fetchMock.mockReturnValue(
        jsonResponse({ joinToken: "jt-mem", joinCode: "jc-mem" }),
      );

      const result = await client.ɵsubscribeToMemories({
        userId: "user-1",
      });

      expect(result).toEqual({ joinToken: "jt-mem", joinCode: "jc-mem" });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/memories/subscribe");
      expect(opts.method).toBe("POST");
      // The platform's memory routes resolve identity from the header, not the
      // body — so no userId body, unlike ɵsubscribeToThreads.
      expect(opts.headers["x-cpki-user-id"]).toBe("user-1");
      expect(opts.body).toBeUndefined();
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

      const result = await client.getThread({
        threadId: "t-1",
        userId: "user-1",
      });

      expect(result).toEqual(thread);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example.com/api/threads/t-1?userId=user-1");
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

      const result = await client.getThreadMessages({
        threadId: "t-1",
        userId: "user-1",
      });

      expect(result).toEqual(payload);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.example.com/api/threads/t-1/messages?userId=user-1",
      );
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
        userId: "user-1",
        agentId: "agent-1",
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

  describe("annotate", () => {
    const validParams = {
      userId: "user-1",
      threadId: "thread-1",
      type: "user_action",
      payload: {
        title: "Renamed project",
        data: { previous: { name: "Foo" }, next: { name: "Bar" } },
      },
      clientEventId: "0190a1b2-c3d4-7890-abcd-ef1234567890",
    };

    it("uses PUT (idempotent) and URL-encodes the clientEventId in the path", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "42", duplicate: false }));

      const result = await client.annotate(validParams);

      expect(result).toEqual({ id: "42", duplicate: false });
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.example.com/connector/annotate/0190a1b2-c3d4-7890-abcd-ef1234567890",
      );
      expect(opts.method).toBe("PUT");
    });

    it("auto-generates a clientEventId (UUID) when omitted and includes it in the path", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      const { clientEventId: _omit, ...paramsWithoutId } = validParams;
      await client.annotate(paramsWithoutId);

      const [url] = fetchMock.mock.calls[0];
      // Path must end with /connector/annotate/<uuid>
      expect(url).toMatch(
        /^https:\/\/api\.example\.com\/connector\/annotate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("sends type, payload, userId, threadId in the body", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      await client.annotate(validParams);

      const [, opts] = fetchMock.mock.calls[0];
      expect(JSON.parse(opts.body)).toMatchObject({
        type: "user_action",
        payload: {
          title: "Renamed project",
          data: { previous: { name: "Foo" }, next: { name: "Bar" } },
        },
        userId: "user-1",
        threadId: "thread-1",
      });
    });

    it("does not send clientEventId in the body", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      await client.annotate(validParams);

      const [, opts] = fetchMock.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.clientEventId).toBeUndefined();
    });

    it("forwards occurredAt in the body when provided", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      await client.annotate({
        ...validParams,
        occurredAt: "2026-01-01T00:00:00.000Z",
      });

      const [, opts] = fetchMock.mock.calls[0];
      expect(JSON.parse(opts.body).occurredAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("omits occurredAt from the body when not provided", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      await client.annotate(validParams);

      const [, opts] = fetchMock.mock.calls[0];
      expect(JSON.parse(opts.body).occurredAt).toBeUndefined();
    });

    it("sends Authorization Bearer with the configured apiKey", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      await client.annotate(validParams);

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers.Authorization).toBe("Bearer test-key");
      expect(opts.headers["Content-Type"]).toBe("application/json");
    });

    it("encodes special characters in clientEventId path segments", async () => {
      fetchMock.mockReturnValue(jsonResponse({ id: "1", duplicate: false }));

      await client.annotate({
        ...validParams,
        clientEventId: "id/with?special&chars",
      });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        "https://api.example.com/connector/annotate/id%2Fwith%3Fspecial%26chars",
      );
    });

    it("throws PlatformRequestError on non-2xx with the platform's status", async () => {
      fetchMock.mockReturnValue(jsonResponse({ error: "bad" }, 400));

      await expect(client.annotate(validParams)).rejects.toMatchObject({
        status: 400,
      });
    });

    it("throws PlatformRequestError 502 when the platform returns an empty body", async () => {
      fetchMock.mockReturnValue(emptyResponse(200));

      await expect(client.annotate(validParams)).rejects.toMatchObject({
        status: 502,
      });
    });

    it("throws PlatformRequestError 502 when the platform returns JSON null", async () => {
      // `JSON.parse("null")` returns `null` (not `undefined`), so the
      // empty-body guard must use `== null` (loose) to catch both
      // shapes. A `=== undefined` guard would let `null` slip past
      // and surface as a TypeError in caller code.
      fetchMock.mockReturnValue(
        Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve(null),
          text: () => Promise.resolve("null"),
        } as Response),
      );

      await expect(client.annotate(validParams)).rejects.toMatchObject({
        status: 502,
      });
    });
  });
});
