import { afterEach, describe, expect, it, vi } from "vitest";
import { recordAnnotation, recordUserAction } from "../record-annotation";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestBody(
  fetchMock: ReturnType<typeof vi.fn>,
  call = 0,
): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recordAnnotation", () => {
  it("posts the annotation wire contract and returns the runtime result", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: "annotation-id", duplicate: false })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await recordAnnotation({
      runtimeUrl: "https://runtime.example.com/copilotkit",
      headers: { Authorization: "Bearer token" },
      credentials: "include",
      type: "user_action",
      payload: { title: "Renamed project", data: { name: "New name" } },
      threadId: "thread-id",
      clientEventId: "client-event-id",
      occurredAt: "2026-08-16T12:00:00.000Z",
    });

    expect(result).toEqual({ id: "annotation-id", duplicate: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://runtime.example.com/copilotkit/annotate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer token",
        },
        credentials: "include",
        body: expect.any(String),
      },
    );
    expect(requestBody(fetchMock)).toEqual({
      type: "user_action",
      payload: { title: "Renamed project", data: { name: "New name" } },
      threadId: "thread-id",
      clientEventId: "client-event-id",
      occurredAt: "2026-08-16T12:00:00.000Z",
    });
  });

  it("generates a fresh client event id for every call when none is supplied", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: "annotation-id", duplicate: false })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      runtimeUrl: "https://runtime.example.com/copilotkit",
      headers: {},
      type: "user_action",
      threadId: "thread-id",
    } as const;

    await recordAnnotation(input);
    await recordAnnotation(input);
    const firstId = requestBody(fetchMock).clientEventId;
    const secondId = requestBody(fetchMock, 1).clientEventId;

    expect(firstId).toEqual(expect.any(String));
    expect(secondId).toEqual(expect.any(String));
    expect(firstId).not.toBe(secondId);
  });

  it("omits optional request fields when they are not supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: "annotation-id", duplicate: false }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await recordAnnotation({
      runtimeUrl: "https://runtime.example.com/copilotkit",
      headers: {},
      type: "user_action",
      threadId: "thread-id",
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = requestBody(fetchMock);
    expect(init).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("payload");
    expect(body).not.toHaveProperty("occurredAt");
    expect(body).not.toHaveProperty("userId");
  });

  it("propagates network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("network request failed")),
    );

    await expect(
      recordAnnotation({
        runtimeUrl: "https://runtime.example.com/copilotkit",
        headers: {},
        type: "user_action",
        threadId: "thread-id",
      }),
    ).rejects.toThrow("network request failed");
  });

  it("includes the status when the runtime rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "bad input" }, 422)),
    );

    await expect(
      recordAnnotation({
        runtimeUrl: "https://runtime.example.com/copilotkit",
        headers: {},
        type: "user_action",
        threadId: "thread-id",
      }),
    ).rejects.toThrow(/422/);
  });

  it("rejects a successful response with an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));

    await expect(
      recordAnnotation({
        runtimeUrl: "https://runtime.example.com/copilotkit",
        headers: {},
        type: "user_action",
        threadId: "thread-id",
      }),
    ).rejects.toThrow(/empty body/);
  });

  it("rejects a successful response with a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("OK")));

    await expect(
      recordAnnotation({
        runtimeUrl: "https://runtime.example.com/copilotkit",
        headers: {},
        type: "user_action",
        threadId: "thread-id",
      }),
    ).rejects.toThrow(/non-JSON body/);
  });
});

describe("recordUserAction", () => {
  it("maps user-action details to the shared annotation contract", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: "annotation-id", duplicate: false })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await recordUserAction({
      runtimeUrl: "https://runtime.example.com/copilotkit",
      headers: { Authorization: "Bearer token" },
      credentials: "include",
      threadId: "thread-id",
      title: "Renamed project",
      description: null,
      data: { name: "New name" },
      clientEventId: "client-event-id",
      occurredAt: "2026-08-16T12:00:00.000Z",
    });

    expect(requestBody(fetchMock)).toEqual({
      type: "user_action",
      payload: {
        title: "Renamed project",
        description: null,
        data: { name: "New name" },
      },
      threadId: "thread-id",
      clientEventId: "client-event-id",
      occurredAt: "2026-08-16T12:00:00.000Z",
    });
  });

  it("omits the payload when no user-action details are supplied", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ id: "annotation-id", duplicate: false })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await recordUserAction({
      runtimeUrl: "https://runtime.example.com/copilotkit",
      headers: {},
      threadId: "thread-id",
    });

    expect(requestBody(fetchMock)).not.toHaveProperty("payload");
  });
});
