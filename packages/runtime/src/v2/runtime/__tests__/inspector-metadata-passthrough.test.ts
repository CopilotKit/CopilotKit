import { expect, test, vi } from "vitest";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform";

type RuntimeMode = "multi-route" | "single-route";

function createMetadataRequest(mode: RuntimeMode): Request {
  if (mode === "multi-route") {
    return new Request(
      "https://runtime.example/api/copilotkit/inspector-metadata",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer browser-token",
          Cookie: "session=browser-secret",
        },
      },
    );
  }

  return new Request("https://runtime.example/api/copilotkit", {
    method: "POST",
    headers: {
      Authorization: "Bearer browser-token",
      "Content-Type": "application/json",
      Cookie: "session=browser-secret",
    },
    body: JSON.stringify({ method: "inspector/metadata" }),
  });
}

function setup(upstreamPayload: unknown) {
  const fetchIntelligence = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(upstreamPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  fetchIntelligence.mockClear();
  const intelligence = new CopilotKitIntelligence({
    apiUrl: "https://api.example.com",
    wsUrl: "wss://ws.example.com",
    apiKey: "server-api-key",
  });
  const runtime = new CopilotRuntime({
    agents: {},
    intelligence,
    identifyUser: async () => ({ id: "user-1", name: "User One" }),
  });

  return {
    fetchIntelligence,
    intelligence,
    runtime,
    teardown() {
      fetchIntelligence.mockRestore();
    },
  };
}

test.each([
  {
    name: "known zero through the multi-route endpoint",
    mode: "multi-route",
    expiringSoonCount: 0,
  },
  {
    name: "a known positive count through the single-route endpoint",
    mode: "single-route",
    expiringSoonCount: 37,
  },
] satisfies ReadonlyArray<{
  readonly name: string;
  readonly mode: RuntimeMode;
  readonly expiringSoonCount: number;
}>)("passes $name", async ({ mode, expiringSoonCount }) => {
  const expectedMetadata = {
    schemaVersion: 1,
    plan: { code: "free", label: "Free" },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount,
    },
  };
  const { fetchIntelligence, runtime, teardown } = setup({
    ...expectedMetadata,
    futureTopLevelField: "drop-me",
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode,
  });
  const request = createMetadataRequest(mode);

  try {
    const response = await handler(request);

    expect(fetchIntelligence).toHaveBeenCalledTimes(1);
    expect(fetchIntelligence).toHaveBeenCalledWith(
      "https://api.example.com/api/inspector/metadata",
      {
        method: "GET",
        headers: { Authorization: "Bearer server-api-key" },
        signal: expect.any(AbortSignal),
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    await expect(response.json()).resolves.toStrictEqual(expectedMetadata);
  } finally {
    teardown();
  }
});

test("drops malformed expiry without dropping base usage or sibling modules", async () => {
  const { fetchIntelligence, runtime, teardown } = setup({
    schemaVersion: 1,
    plan: { code: "free", label: "Free" },
    usage: {
      used: 148,
      limit: { kind: "finite", value: 200 },
      expiringSoonCount: "37",
    },
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "multi-route",
  });
  const request = createMetadataRequest("multi-route");

  try {
    const response = await handler(request);

    expect(fetchIntelligence).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      schemaVersion: 1,
      plan: { code: "free", label: "Free" },
      usage: {
        used: 148,
        limit: { kind: "finite", value: 200 },
      },
    });
  } finally {
    teardown();
  }
});

test("advertises metadata support without fetching metadata", async () => {
  const { intelligence, runtime, teardown } = setup({ schemaVersion: 1 });
  const getInspectorMetadata = vi.spyOn(intelligence, "getInspectorMetadata");
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "multi-route",
  });
  const request = new Request("https://runtime.example/api/copilotkit/info", {
    method: "GET",
  });

  try {
    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inspectorMetadata).toBe(true);
    expect(getInspectorMetadata).not.toHaveBeenCalled();
  } finally {
    getInspectorMetadata.mockRestore();
    teardown();
  }
});
