import { expect, test, vi } from "vitest";

import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type {
  HandlerHookContext,
  ResponseHookContext,
  RouteInfo,
} from "../core/hooks";
import { CopilotRuntime } from "../core/runtime";

/** Builds an Intelligence runtime whose thread-list dependency is observable. */
function setup() {
  const listThreads = vi.fn().mockResolvedValue({
    threads: [{ id: "thread-1", agentId: "researcher" }],
    nextCursor: null,
  });
  const identifyUser = vi
    .fn()
    .mockResolvedValue({ id: "user-1", name: "User One" });
  const runtime = {
    agents: Promise.resolve({}),
    mode: "intelligence",
    identifyUser,
    intelligence: {
      listThreads,
      getRuntimeEntitlements: vi.fn().mockResolvedValue(undefined),
      ɵgetClientWsUrl: vi.fn().mockReturnValue("wss://example.com/client"),
    },
    runner: {
      run: vi.fn(),
      connect: vi.fn(),
      isRunning: vi.fn(),
      stop: vi.fn(),
    },
  } as unknown as CopilotRuntimeLike;
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
  });

  return { handler, identifyUser, listThreads };
}

interface ResourceCase {
  path: string;
  httpMethod: string;
  body?: Record<string, unknown>;
  route: RouteInfo;
}

/** Sends one REST-shaped operation through the single-route resource envelope. */
function resourceRequest(input: ResourceCase): Request {
  return new Request("https://example.com/api/copilotkit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "resource/request",
      params: { path: input.path, httpMethod: input.httpMethod },
      ...(input.body ? { body: input.body } : {}),
    }),
  });
}

test("single-route resource requests dispatch to the thread list handler", async () => {
  const { handler, identifyUser, listThreads } = setup();
  const request = new Request("https://example.com/api/copilotkit", {
    method: "POST",
    headers: {
      Authorization: "Bearer browser-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "resource/request",
      params: {
        path: "/threads?agentId=researcher",
        httpMethod: "GET",
      },
    }),
  });

  const response = await handler(request);

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    threads: [{ id: "thread-1", agentId: "researcher" }],
    nextCursor: null,
  });
  expect(identifyUser).toHaveBeenCalledTimes(1);
  expect(listThreads).toHaveBeenCalledWith({
    userId: "user-1",
    agentId: "researcher",
  });
});

test("single-route resource requests preserve every Intelligence REST operation", async () => {
  const observed: Array<{
    route: RouteInfo;
    method: string;
    path: string;
    search: string;
    body: unknown;
  }> = [];
  const cases: ResourceCase[] = [
    {
      path: "/threads?agentId=researcher&limit=20",
      httpMethod: "GET",
      route: { method: "threads/list" },
    },
    {
      path: "/threads/subscribe",
      httpMethod: "POST",
      body: {},
      route: { method: "threads/subscribe" },
    },
    {
      path: "/threads/thread%201",
      httpMethod: "PATCH",
      body: { name: "Renamed" },
      route: { method: "threads/update", threadId: "thread 1" },
    },
    {
      path: "/threads/thread-1",
      httpMethod: "DELETE",
      body: {},
      route: { method: "threads/update", threadId: "thread-1" },
    },
    {
      path: "/threads/thread-1/archive",
      httpMethod: "POST",
      body: { archived: true },
      route: { method: "threads/archive", threadId: "thread-1" },
    },
    {
      path: "/threads/thread-1/messages",
      httpMethod: "GET",
      route: { method: "threads/messages", threadId: "thread-1" },
    },
    {
      path: "/threads/thread-1/events",
      httpMethod: "GET",
      route: { method: "threads/events", threadId: "thread-1" },
    },
    {
      path: "/threads/thread-1/state",
      httpMethod: "GET",
      route: { method: "threads/state", threadId: "thread-1" },
    },
    {
      path: "/threads/clear",
      httpMethod: "POST",
      body: {},
      route: { method: "threads/clear" },
    },
    {
      path: "/memories?includeInvalidated=true",
      httpMethod: "GET",
      route: { method: "memories/list" },
    },
    {
      path: "/memories",
      httpMethod: "POST",
      body: { content: "Prefers short answers" },
      route: { method: "memories/list" },
    },
    {
      path: "/memories/recall",
      httpMethod: "POST",
      body: { query: "answer style" },
      route: { method: "memories/recall" },
    },
    {
      path: "/memories/subscribe",
      httpMethod: "POST",
      body: {},
      route: { method: "memories/subscribe" },
    },
    {
      path: "/memories/memory%201",
      httpMethod: "PATCH",
      body: { content: "Prefers concise answers" },
      route: { method: "memories/mutate", memoryId: "memory 1" },
    },
    {
      path: "/memories/memory-1",
      httpMethod: "DELETE",
      body: {},
      route: { method: "memories/mutate", memoryId: "memory-1" },
    },
    {
      path: "/annotate",
      httpMethod: "POST",
      body: { type: "user_action", threadId: "thread-1" },
      route: { method: "annotate" },
    },
  ];
  const runtime = new CopilotRuntime({
    agents: {},
    exposeMemoryRoutes: true,
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
    hooks: {
      onBeforeHandler: async ({ request, route, path }: HandlerHookContext) => {
        observed.push({
          route,
          method: request.method,
          path,
          search: new URL(request.url).search,
          body:
            request.method === "GET" ? undefined : await request.clone().json(),
        });
        throw new Response(null, { status: 204 });
      },
    },
  });

  for (const input of cases) {
    const response = await handler(resourceRequest(input));
    expect(response.status).toBe(204);
  }

  expect(observed).toEqual(
    cases.map((input) => ({
      route: input.route,
      method: input.httpMethod,
      path: `/api/copilotkit${input.path.split("?")[0]}`,
      search: input.path.includes("?") ? `?${input.path.split("?")[1]}` : "",
      body: input.body,
    })),
  );
});

test("single-route info advertises resource operations without changing legacy thread flags", async () => {
  const { handler } = setup();
  const request = new Request("https://example.com/api/copilotkit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "info" }),
  });

  const response = await handler(request);
  const info = await response.json();

  expect(response.status).toBe(200);
  expect(info.threadEndpoints).toEqual({
    list: false,
    inspect: false,
    mutations: false,
    realtimeMetadata: false,
  });
  expect(info.singleRoute).toEqual({
    resourceOperations: true,
    threadEndpoints: {
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: true,
    },
  });
});

test("single-route resource requests reject hidden memory routes before hooks", async () => {
  const onBeforeHandler = vi.fn(({ request }: HandlerHookContext) => request);
  const runtime = new CopilotRuntime({ agents: {} });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
    hooks: { onBeforeHandler },
  });

  const response = await handler(
    resourceRequest({
      path: "/memories",
      httpMethod: "GET",
      route: { method: "memories/list" },
    }),
  );

  expect(response.status).toBe(404);
  expect(onBeforeHandler).not.toHaveBeenCalled();
});

test("single-route hidden memory routes return 404 before method validation", async () => {
  const runtime = new CopilotRuntime({ agents: {} });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
  });

  const response = await handler(
    resourceRequest({
      path: "/memories",
      httpMethod: "PUT",
      route: { method: "memories/list" },
    }),
  );

  expect(response.status).toBe(404);
  expect(response.headers.get("allow")).toBeNull();
});

test("single-route resource requests reject unsafe paths and non-resource routes", async () => {
  const runtime = new CopilotRuntime({ agents: {} });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
  });
  const cases = [
    { path: "https://attacker.example/threads", status: 400 },
    { path: "//attacker.example/threads", status: 400 },
    { path: "/agent/researcher/run", status: 404 },
  ];

  for (const input of cases) {
    const response = await handler(
      resourceRequest({
        path: input.path,
        httpMethod: "GET",
        route: { method: "threads/list" },
      }),
    );
    expect(response.status).toBe(input.status);
  }
});

test("single-route resource requests preserve REST method errors", async () => {
  const onResponse = vi.fn(({ response }: ResponseHookContext) => response);
  const runtime = new CopilotRuntime({ agents: {} });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
    hooks: { onResponse },
  });

  const response = await handler(
    resourceRequest({
      path: "/threads/thread-1/messages",
      httpMethod: "POST",
      route: { method: "threads/messages", threadId: "thread-1" },
    }),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
  expect(onResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/api/copilotkit/threads/thread-1/messages",
      route: { method: "threads/messages", threadId: "thread-1" },
    }),
  );
});

test("single-route resource errors report the matched resource path", async () => {
  const onError = vi.fn().mockReturnValue(new Response(null, { status: 503 }));
  const runtime = new CopilotRuntime({ agents: {} });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
    mode: "single-route",
    activateChannels: false,
    hooks: {
      onBeforeHandler: () => {
        throw new Error("resource failed");
      },
      onError,
    },
  });

  const response = await handler(
    resourceRequest({
      path: "/threads/thread-1/messages",
      httpMethod: "GET",
      route: { method: "threads/messages", threadId: "thread-1" },
    }),
  );

  expect(response.status).toBe(503);
  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/api/copilotkit/threads/thread-1/messages",
    }),
  );
});
