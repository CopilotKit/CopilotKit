import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../context";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { useRecordUserAction } from "../../hooks/use-record-user-action";
import { useAutoCaptureUserActions } from "../use-auto-capture-user-actions";
import { resetAutoCaptureGlobals } from "./reset-globals";

vi.mock("../../context", () => ({ useCopilotKit: vi.fn() }));
vi.mock("../../providers/CopilotChatConfigurationProvider", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));
vi.mock("../../hooks/use-record-user-action", () => ({
  useRecordUserAction: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseChatConfig = useCopilotChatConfiguration as ReturnType<typeof vi.fn>;
const mockUseRecordUserAction = useRecordUserAction as ReturnType<typeof vi.fn>;

const ORIGIN = window.location.origin;
const RUNTIME_URL = `${ORIGIN}/api/copilotkit`;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let originalFetch: typeof globalThis.fetch;
let recorder: ReturnType<typeof vi.fn>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  // Start from a pristine global in case a prior file leaked a patched fetch.
  resetAutoCaptureGlobals();
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () =>
    jsonResponse({ ok: true }),
  ) as unknown as typeof globalThis.fetch;

  recorder = vi.fn(async () => ({ id: "1", duplicate: false }));
  mockUseRecordUserAction.mockReturnValue(recorder);
  mockUseCopilotKit.mockReturnValue({
    // `intelligence` defined = Intelligence-backed runtime; required for
    // auto-capture to patch the globals (RD-30 gate).
    copilotkit: { runtimeUrl: RUNTIME_URL, headers: {}, intelligence: {} },
  });
  mockUseChatConfig.mockReturnValue({ threadId: "thread-1" });
});

afterEach(() => {
  resetAutoCaptureGlobals();
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("useAutoCaptureUserActions", () => {
  it("records a same-origin mutating request against the current chat thread", async () => {
    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: true }),
    );

    await globalThis.fetch(`${ORIGIN}/api/orders`, {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });

    await vi.waitFor(() => expect(recorder).toHaveBeenCalledTimes(1));
    expect(recorder.mock.calls[0]![0]).toMatchObject({
      threadId: "thread-1",
      title: "POST /api/orders",
      newData: { a: 1 },
    });

    unmount();
  });

  it("never records the platform's own /user-actions POST (no loop)", async () => {
    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: true }),
    );

    await globalThis.fetch(`${RUNTIME_URL}/user-actions`, {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    await flush();

    expect(recorder).not.toHaveBeenCalled();
    unmount();
  });

  it("warns once and skips when no thread is resolvable", async () => {
    mockUseChatConfig.mockReturnValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: true }),
    );

    await globalThis.fetch(`${ORIGIN}/api/a`, { method: "POST", body: "{}" });
    await globalThis.fetch(`${ORIGIN}/api/b`, { method: "POST", body: "{}" });
    await flush();

    expect(recorder).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    unmount();
  });

  it("uses an explicit config threadId over the chat thread", async () => {
    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: true, threadId: "explicit-9" }),
    );

    await globalThis.fetch(`${ORIGIN}/api/x`, { method: "POST", body: "{}" });

    await vi.waitFor(() => expect(recorder).toHaveBeenCalledTimes(1));
    expect(recorder.mock.calls[0]![0]).toMatchObject({ threadId: "explicit-9" });

    unmount();
  });

  it("does not patch fetch when disabled, and restores it on unmount", async () => {
    const beforeMount = globalThis.fetch;

    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: false }),
    );
    // Disabled → global fetch untouched.
    expect(globalThis.fetch).toBe(beforeMount);
    unmount();

    const { unmount: unmount2 } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: true }),
    );
    expect(globalThis.fetch).not.toBe(beforeMount);
    unmount2();
    // Restored after the last consumer unmounts.
    expect(globalThis.fetch).toBe(beforeMount);
  });

  it("runs a developer-supplied transform end-to-end (envelope already redacted)", async () => {
    let envelopeSeen: { requestBody?: unknown } = {};
    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({
        enabled: true,
        transform: (env) => {
          envelopeSeen = env;
          return { title: "custom-title", newData: { upgraded: true } };
        },
      }),
    );

    await globalThis.fetch(`${ORIGIN}/api/x`, {
      method: "POST",
      body: JSON.stringify({ password: "hunter2", k: "v" }),
      headers: { "content-type": "application/json" },
    });

    await vi.waitFor(() => expect(recorder).toHaveBeenCalledTimes(1));
    expect(recorder.mock.calls[0]![0]).toMatchObject({
      title: "custom-title",
      newData: { upgraded: true },
      threadId: "thread-1",
    });
    // The envelope handed to transform was already redacted.
    expect(envelopeSeen.requestBody).toEqual({ password: "***", k: "v" });

    unmount();
  });

  it("calls a threadId-resolver function fresh per request (latest-ref semantics)", async () => {
    let counter = 0;
    const resolver = () => `thread-${++counter}`;

    const { unmount } = renderHook(() =>
      useAutoCaptureUserActions({ enabled: true, threadId: resolver }),
    );

    await globalThis.fetch(`${ORIGIN}/api/a`, { method: "POST", body: "{}" });
    await globalThis.fetch(`${ORIGIN}/api/b`, { method: "POST", body: "{}" });

    await vi.waitFor(() => expect(recorder).toHaveBeenCalledTimes(2));
    expect(recorder.mock.calls[0]![0].threadId).toBe("thread-1");
    expect(recorder.mock.calls[1]![0].threadId).toBe("thread-2");

    unmount();
  });

  it("reflects a config change (denyUrls) on the very next request via the ref bridge", async () => {
    type Props = { deny?: Array<string | RegExp> };
    const { rerender, unmount } = renderHook<void, Props>(
      ({ deny }) =>
        useAutoCaptureUserActions({ enabled: true, denyUrls: deny }),
      { initialProps: {} },
    );

    await globalThis.fetch(`${ORIGIN}/api/keep`, { method: "POST", body: "{}" });
    await vi.waitFor(() => expect(recorder).toHaveBeenCalledTimes(1));

    rerender({ deny: [/\/api\//] });

    await globalThis.fetch(`${ORIGIN}/api/now-denied`, {
      method: "POST",
      body: "{}",
    });
    await flush();
    // Still just the one call — the new denyUrls applied without re-patching.
    expect(recorder).toHaveBeenCalledTimes(1);

    unmount();
  });
});
