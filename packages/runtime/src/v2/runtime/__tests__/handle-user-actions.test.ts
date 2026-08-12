import { expect, it, vi } from "vitest";

import { handleAnnotate } from "../handlers/handle-user-actions";
import { CopilotRuntime } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";

const createIdentifyUser = () =>
  vi.fn().mockResolvedValue({ id: "user-1", name: "User One" });

const createIntelligenceRuntime = (options?: {
  identifyUser?: (
    request: Request,
  ) => { id: string; name: string } | Promise<{ id: string; name: string }>;
  intelligence?: Record<string, unknown>;
}) =>
  ({
    agents: Promise.resolve({}),
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner: {
      run: vi.fn(),
      connect: vi.fn(),
      isRunning: vi.fn(),
      stop: vi.fn(),
    },
    mode: "intelligence",
    generateThreadNames: false,
    identifyUser: options?.identifyUser ?? createIdentifyUser(),
    intelligence: options?.intelligence,
  }) as unknown as CopilotRuntime;

const validBody = () => ({
  type: "user_action",
  payload: { previous: { name: "Foo" }, next: { name: "Bar" } },
  threadId: "thread-1",
  clientEventId: "0190a1b2-c3d4-7890-abcd-ef1234567890",
  occurredAt: "2026-01-01T00:00:00.000Z",
});

const buildRequest = (body: Record<string, unknown>) =>
  new Request("https://example.com/annotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

it("returns 422 when intelligence is not configured", async () => {
  const runtime = new CopilotRuntime({ agents: {} });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(validBody()),
  });
  expect(response.status).toBe(422);
});

it("forwards to intelligence.annotate with the resolved userId", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "42", duplicate: false });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const body = validBody();
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(body),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    id: "42",
    duplicate: false,
  });
  expect(annotate).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user-1",
      threadId: "thread-1",
      type: "user_action",
      payload: { previous: { name: "Foo" }, next: { name: "Bar" } },
      clientEventId: "0190a1b2-c3d4-7890-abcd-ef1234567890",
      occurredAt: "2026-01-01T00:00:00.000Z",
    }),
  );
});

it("resolves userId server-side (not from the request body)", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "1", duplicate: false });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  // Body contains NO userId field — server must inject it from auth
  const bodyWithoutUserId = {
    type: "user_action",
    threadId: "thread-1",
  };
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(bodyWithoutUserId),
  });
  expect(response.status).toBe(200);
  expect(annotate).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "user-1" }),
  );
});

it("returns 400 when threadId is missing", async () => {
  const annotate = vi.fn();
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const { threadId: _drop, ...rest } = validBody();
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(rest),
  });
  expect(response.status).toBe(400);
  expect(annotate).not.toHaveBeenCalled();
});

it("returns 400 when threadId is empty string", async () => {
  const annotate = vi.fn();
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest({ ...validBody(), threadId: "" }),
  });
  expect(response.status).toBe(400);
  expect(annotate).not.toHaveBeenCalled();
});

it("returns 400 when type is missing", async () => {
  const annotate = vi.fn();
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const { type: _drop, ...rest } = validBody();
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(rest),
  });
  expect(response.status).toBe(400);
  expect(annotate).not.toHaveBeenCalled();
});

it("returns 400 when type is empty string", async () => {
  const annotate = vi.fn();
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest({ ...validBody(), type: "" }),
  });
  expect(response.status).toBe(400);
  expect(annotate).not.toHaveBeenCalled();
});

it("succeeds when payload is omitted (payload is optional)", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "1", duplicate: false });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const { payload: _drop, ...rest } = validBody();
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(rest),
  });
  expect(response.status).toBe(200);
  expect(annotate).toHaveBeenCalledWith(
    expect.objectContaining({ type: "user_action", threadId: "thread-1" }),
  );
  expect(annotate.mock.calls[0]![0].payload).toBeUndefined();
});

it("succeeds when clientEventId is omitted (optional)", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "1", duplicate: false });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const { clientEventId: _drop, ...rest } = validBody();
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(rest),
  });
  expect(response.status).toBe(200);
  expect(annotate).toHaveBeenCalledWith(
    expect.objectContaining({ type: "user_action", threadId: "thread-1" }),
  );
  expect(annotate.mock.calls[0]![0].clientEventId).toBeUndefined();
});

it("succeeds when occurredAt is omitted (optional)", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "1", duplicate: false });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const { occurredAt: _drop, ...rest } = validBody();
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(rest),
  });
  expect(response.status).toBe(200);
  expect(annotate.mock.calls[0]![0].occurredAt).toBeUndefined();
});

it("returns 400 for malformed JSON body", async () => {
  const annotate = vi.fn();
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const request = new Request("https://example.com/annotate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{{{",
  });
  const response = await handleAnnotate({ runtime, request });
  expect(response.status).toBe(400);
  expect(annotate).not.toHaveBeenCalled();
});

it("returns 502 with the expected error body when the platform call fails", async () => {
  const annotate = vi.fn().mockRejectedValue(new Error("platform exploded"));
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(validBody()),
  });
  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toEqual({
    error: "Failed to annotate",
  });
});

it("forwards 4xx PlatformRequestError statuses verbatim (not collapsed into 502)", async () => {
  const annotate = vi
    .fn()
    .mockRejectedValue(new PlatformRequestError("bad threadId", 400));
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(validBody()),
  });
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: expect.stringContaining("bad threadId"),
  });
});

it("collapses 5xx PlatformRequestError into a 502 (upstream is genuinely at fault)", async () => {
  const annotate = vi
    .fn()
    .mockRejectedValue(new PlatformRequestError("internal server error", 503));
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(validBody()),
  });
  expect(response.status).toBe(502);
});

it("returns the duplicate=true payload verbatim from the platform", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "42", duplicate: true });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const response = await handleAnnotate({
    runtime,
    request: buildRequest(validBody()),
  });
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ id: "42", duplicate: true });
});

it("forwards payload verbatim (any shape) to intelligence.annotate", async () => {
  const annotate = vi.fn().mockResolvedValue({ id: "1", duplicate: false });
  const runtime = createIntelligenceRuntime({ intelligence: { annotate } });
  const customPayload = { containers: ["user", "organization"] };
  await handleAnnotate({
    runtime,
    request: buildRequest({
      ...validBody(),
      type: "set_learning_containers",
      payload: customPayload,
    }),
  });
  expect(annotate).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "set_learning_containers",
      payload: customPayload,
    }),
  );
});
