import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCopilotKit } from "../../context";
import { useCopilotChatConfiguration } from "../../providers";
import { useLearningContainers } from "../use-learning-containers";
import { useLearningContainersInCurrentThread } from "../use-learning-containers-in-current-thread";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../../providers", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseCopilotChatConfiguration =
  useCopilotChatConfiguration as ReturnType<typeof vi.fn>;

/** Shared fetch-call tracking type. */
interface FetchCall {
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Install a mock `globalThis.fetch` that records all calls and returns the
 * provided canned responses in order (repeating the last one indefinitely).
 */
const mockFetch = (
  responses: Array<{ status: number; body: unknown }>,
): { calls: FetchCall[]; restore: () => void } => {
  const calls: FetchCall[] = [];
  let index = 0;
  const original = globalThis.fetch;
  const fake = vi.fn(async (url: unknown, init: RequestInit | undefined) => {
    let parsedBody: Record<string, unknown> | null = null;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = null;
      }
    }
    calls.push({ url: String(url), body: parsedBody });
    const response = responses[index++] ?? responses[responses.length - 1]!;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = fake as unknown as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

/** Set up the copilotkit context mock with a runtimeUrl. */
const installCopilotKit = (
  runtimeUrl: string | null = "https://bff.example.com/api/copilotkit",
) => {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: { runtimeUrl, headers: undefined },
  });
};

/** Set up the chat-config context mock. */
const installChatConfig = (threadId: string | null | undefined) => {
  if (threadId == null) {
    mockUseCopilotChatConfiguration.mockReturnValue(null);
    return;
  }
  mockUseCopilotChatConfiguration.mockReturnValue({
    threadId,
    agentId: "agent-1",
    labels: {},
    isModalOpen: false,
    setModalOpen: () => undefined,
    hasExplicitThreadId: true,
  });
};

// ─── useLearningContainers ────────────────────────────────────────────────────

test("mount with default [project] → NO emit", () => {
  installCopilotKit();
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);

  renderHook(() =>
    useLearningContainers({ threadId: "t1", learningContainers: ["project"] }),
  );

  expect(calls).toHaveLength(0);
  restore();
});

test("mount with [team] → ONE emit with type:set_learning_containers and containers:[team]", async () => {
  installCopilotKit();
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);

  renderHook(() =>
    useLearningContainers({ threadId: "t1", learningContainers: ["team"] }),
  );

  // Fire-and-forget; wait a tick for the promise to settle.
  await act(async () => {});

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://bff.example.com/api/copilotkit/annotate");
  expect(calls[0]!.body!.type).toBe("set_learning_containers");
  expect(
    (calls[0]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["team"]);
  expect(calls[0]!.body!.threadId).toBe("t1");
  restore();
});

test("change [team]→[dept] → emits dept; rerender same [dept] (new array, same content) → NO additional emit", async () => {
  installCopilotKit();
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
    { status: 200, body: { id: "2", duplicate: false } },
    { status: 200, body: { id: "3", duplicate: false } },
  ]);

  const { rerender, unmount } = renderHook(
    ({ containers }: { containers: string[] }) =>
      useLearningContainers({ threadId: "t1", learningContainers: containers }),
    { initialProps: { containers: ["team"] } },
  );

  await act(async () => {});
  // Should have emitted once for mount with "team".
  expect(calls).toHaveLength(1);
  expect(
    (calls[0]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["team"]);

  // Change to ["dept"].
  rerender({ containers: ["dept"] });
  await act(async () => {});
  expect(calls).toHaveLength(2);
  expect(
    (calls[1]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["dept"]);

  // Rerender with a NEW array that has the same content → no extra emit.
  rerender({ containers: ["dept"] });
  await act(async () => {});
  expect(calls).toHaveLength(2);

  // Clean up (unmount resets, but we don't count that here).
  unmount();
  restore();
});

test("change [team]→[organization] mid-mount → emits [organization] (a real switch is recorded)", async () => {
  installCopilotKit();
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
    { status: 200, body: { id: "2", duplicate: false } },
    { status: 200, body: { id: "3", duplicate: false } },
  ]);

  const { rerender, unmount } = renderHook(
    ({ containers }: { containers: string[] }) =>
      useLearningContainers({ threadId: "t1", learningContainers: containers }),
    { initialProps: { containers: ["team"] } },
  );

  await act(async () => {});
  expect(calls).toHaveLength(1);

  // Switch to a different non-default value — a deliberate change always emits.
  rerender({ containers: ["organization"] });
  await act(async () => {});

  // Two emits so far (team on mount, organization on switch).
  expect(calls).toHaveLength(2);
  expect(
    (calls[1]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["organization"]);

  unmount();
  restore();
});

test("unmount → emits reset [project] for the captured threadId", async () => {
  installCopilotKit();
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
    { status: 200, body: { id: "2", duplicate: false } },
  ]);

  const { unmount } = renderHook(() =>
    useLearningContainers({
      threadId: "thread-xyz",
      learningContainers: ["team"],
    }),
  );

  await act(async () => {});
  // 1 emit on mount.
  expect(calls).toHaveLength(1);

  unmount();
  await act(async () => {});

  // 1 more emit for the reset.
  expect(calls).toHaveLength(2);
  expect(calls[1]!.body!.type).toBe("set_learning_containers");
  expect(
    (calls[1]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["project"]);
  expect(calls[1]!.body!.threadId).toBe("thread-xyz");
  restore();
});

test("threadId change → resets old thread then syncs new thread", async () => {
  installCopilotKit();
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
    { status: 200, body: { id: "2", duplicate: false } },
    { status: 200, body: { id: "3", duplicate: false } },
  ]);

  const { rerender, unmount } = renderHook(
    ({ threadId }: { threadId: string }) =>
      useLearningContainers({ threadId, learningContainers: ["team"] }),
    { initialProps: { threadId: "old-thread" } },
  );

  await act(async () => {});
  expect(calls).toHaveLength(1);
  expect(calls[0]!.body!.threadId).toBe("old-thread");

  rerender({ threadId: "new-thread" });
  await act(async () => {});

  // Cleanup reset for old-thread + emit for new-thread.
  expect(calls).toHaveLength(3);
  expect(calls[1]!.body!.threadId).toBe("old-thread");
  expect(
    (calls[1]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["project"]);
  expect(calls[2]!.body!.threadId).toBe("new-thread");
  expect(
    (calls[2]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["team"]);

  unmount();
  restore();
});

test("failing emit does not throw from render and warns via console.warn", async () => {
  installCopilotKit();
  const original = globalThis.fetch;
  globalThis.fetch = vi
    .fn()
    .mockRejectedValue(
      new TypeError("network fail"),
    ) as unknown as typeof globalThis.fetch;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  // Should not throw.
  const { unmount } = renderHook(() =>
    useLearningContainers({ threadId: "t1", learningContainers: ["team"] }),
  );

  await act(async () => {});
  // No throw and a warning was emitted.
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining("failed to record set_learning_containers"),
    expect.any(TypeError),
  );

  unmount();
  globalThis.fetch = original;
  warnSpy.mockRestore();
});

test("runtimeUrl absent → all emits skipped and warns once", async () => {
  installCopilotKit(null);
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  const { rerender, unmount } = renderHook(() =>
    useLearningContainers({ threadId: "t1", learningContainers: ["team"] }),
  );

  await act(async () => {});
  // Rerender to confirm the warning is not emitted a second time.
  rerender();
  await act(async () => {});
  unmount();
  await act(async () => {});

  expect(calls).toHaveLength(0);
  // Warning emitted exactly once (guarded by ref).
  const missingUrlWarns = warnSpy.mock.calls.filter((args) =>
    String(args[0]).includes("runtimeUrl not configured"),
  );
  expect(missingUrlWarns).toHaveLength(1);

  restore();
  warnSpy.mockRestore();
});

// ─── useLearningContainersInCurrentThread ─────────────────────────────────────

test("useLearningContainersInCurrentThread with no current thread → throws", () => {
  installCopilotKit();
  installChatConfig(null);

  expect(() =>
    renderHook(() =>
      useLearningContainersInCurrentThread({ learningContainers: ["team"] }),
    ),
  ).toThrow(/no active threadId/);
});

test("useLearningContainersInCurrentThread with empty threadId → throws", () => {
  installCopilotKit();
  installChatConfig("");

  expect(() =>
    renderHook(() =>
      useLearningContainersInCurrentThread({ learningContainers: ["team"] }),
    ),
  ).toThrow(/no active threadId/);
});

test("useLearningContainersInCurrentThread delegates to useLearningContainers with config threadId", async () => {
  installCopilotKit();
  installChatConfig("thread-from-config");
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);

  renderHook(() =>
    useLearningContainersInCurrentThread({ learningContainers: ["team"] }),
  );

  await act(async () => {});

  expect(calls).toHaveLength(1);
  expect(calls[0]!.body!.threadId).toBe("thread-from-config");
  expect(
    (calls[0]!.body!.payload as Record<string, unknown>).containers,
  ).toEqual(["team"]);
  restore();
});

test("useLearningContainersInCurrentThread with default containers → NO emit", async () => {
  installCopilotKit();
  installChatConfig("thread-from-config");
  const { calls, restore } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);

  renderHook(() =>
    useLearningContainersInCurrentThread({ learningContainers: ["project"] }),
  );

  await act(async () => {});

  expect(calls).toHaveLength(0);
  restore();
});

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
});
