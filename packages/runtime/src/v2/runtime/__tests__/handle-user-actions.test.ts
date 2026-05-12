import { describe, expect, it, vi } from "vitest";

import { handleRecordUserAction } from "../handlers/handle-user-actions";
import { CopilotRuntime } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";

describe("handleRecordUserAction", () => {
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
    clientEventId: "0190a1b2-c3d4-7890-abcd-ef1234567890",
    threadId: "thread-1",
    title: "Renamed project",
    description: "User renamed Foo to Bar",
    previousData: { name: "Foo" },
    newData: { name: "Bar" },
    metadata: { source: "settings-page" },
  });

  const buildRequest = (body: Record<string, unknown>) =>
    new Request("https://example.com/user-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns 422 when intelligence is not configured", async () => {
    const runtime = new CopilotRuntime({ agents: {} });
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(validBody()),
    });
    expect(response.status).toBe(422);
  });

  it("forwards to intelligence.recordUserAction with the resolved userId", async () => {
    const recordUserAction = vi
      .fn()
      .mockResolvedValue({ id: "42", duplicate: false });
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const body = validBody();
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(body),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "42",
      duplicate: false,
    });
    expect(recordUserAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        threadId: "thread-1",
        title: "Renamed project",
        description: "User renamed Foo to Bar",
        previousData: { name: "Foo" },
        newData: { name: "Bar" },
        metadata: { source: "settings-page" },
        clientEventId: "0190a1b2-c3d4-7890-abcd-ef1234567890",
      }),
    );
  });

  it("returns 400 when threadId is missing", async () => {
    const recordUserAction = vi.fn();
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const { threadId: _drop, ...rest } = validBody();
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(rest),
    });
    expect(response.status).toBe(400);
    expect(recordUserAction).not.toHaveBeenCalled();
  });

  it("returns 400 when clientEventId is missing", async () => {
    const recordUserAction = vi.fn();
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const { clientEventId: _drop, ...rest } = validBody();
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(rest),
    });
    expect(response.status).toBe(400);
    expect(recordUserAction).not.toHaveBeenCalled();
  });

  it("succeeds when title is omitted (title is optional)", async () => {
    const recordUserAction = vi
      .fn()
      .mockResolvedValue({ id: "1", duplicate: false });
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const { title: _drop, ...rest } = validBody();
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(rest),
    });
    expect(response.status).toBe(200);
    expect(recordUserAction).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1" }),
    );
    // Title is absent or undefined when the body didn't carry one.
    expect(recordUserAction.mock.calls[0]![0].title).toBeUndefined();
  });

  it("returns 502 with the expected error body when the platform call fails", async () => {
    const recordUserAction = vi
      .fn()
      .mockRejectedValue(new Error("platform exploded"));
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(validBody()),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to record user action",
    });
  });

  it("forwards 4xx PlatformRequestError statuses verbatim (not collapsed into 502)", async () => {
    const recordUserAction = vi
      .fn()
      .mockRejectedValue(new PlatformRequestError("bad threadId", 400));
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(validBody()),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("bad threadId"),
    });
  });

  it("collapses 5xx PlatformRequestError into a 502 (upstream is genuinely at fault)", async () => {
    const recordUserAction = vi
      .fn()
      .mockRejectedValue(
        new PlatformRequestError("internal server error", 503),
      );
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(validBody()),
    });
    expect(response.status).toBe(502);
  });

  it("silently drops an empty-string title (coerced to undefined)", async () => {
    const recordUserAction = vi
      .fn()
      .mockResolvedValue({ id: "1", duplicate: false });
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    await handleRecordUserAction({
      runtime,
      request: buildRequest({ ...validBody(), title: "" }),
    });
    // Empty string is treated as "no title" — the handler coerces via
    // `isNonEmptyString`. Pin this contract so a future change that
    // started rejecting empty strings instead is intentional, not
    // accidental.
    expect(recordUserAction.mock.calls[0]![0].title).toBeUndefined();
  });

  it("rejects an array as metadata (typeof [] === 'object' footgun)", async () => {
    const recordUserAction = vi.fn();
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    await handleRecordUserAction({
      runtime,
      request: buildRequest({ ...validBody(), metadata: [1, 2, 3] }),
    });
    // Arrays are not valid metadata; the handler drops them rather
    // than passing through as a record. Pin this so a future refactor
    // can't accidentally re-introduce the bug.
    expect(recordUserAction.mock.calls[0]![0].metadata).toBeUndefined();
  });

  it("returns the duplicate=true payload verbatim from the platform", async () => {
    const recordUserAction = vi
      .fn()
      .mockResolvedValue({ id: "42", duplicate: true });
    const runtime = createIntelligenceRuntime({
      intelligence: { recordUserAction },
    });
    const response = await handleRecordUserAction({
      runtime,
      request: buildRequest(validBody()),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "42",
      duplicate: true,
    });
  });
});
