import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../context";
import { useCopilotChatConfiguration } from "../../providers";
import { useRecordUserActionInCurrentThread } from "../use-record-user-action-in-current-thread";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

vi.mock("../../providers", () => ({
  useCopilotChatConfiguration: vi.fn(),
}));

let uuidCounter = 0;
vi.mock("@copilotkit/shared", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@copilotkit/shared");
  return {
    ...actual,
    randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
  };
});

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;
const mockUseCopilotChatConfiguration =
  useCopilotChatConfiguration as ReturnType<typeof vi.fn>;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
}

const mockFetch = (
  responses: Array<{ status: number; body: unknown }>,
): { calls: FetchCall[]; fetch: typeof fetch } => {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetch = vi.fn(async (url, init) => {
    let parsedBody: Record<string, unknown> | null = null;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = null;
      }
    }
    calls.push({ url: String(url), init, body: parsedBody });
    const response = responses[index++] ?? responses[responses.length - 1]!;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
};

const installCopilotKit = () => {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl: "https://bff.example.com/api/copilotkit",
      headers: undefined,
    },
  });
};

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

describe("useRecordUserActionInCurrentThread", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    uuidCounter = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("pre-fills threadId from the chat configuration", async () => {
    installCopilotKit();
    installChatConfig("thread-from-context");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useRecordUserActionInCurrentThread());
    await result.current({ title: "Clicked rename" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.body!.threadId).toBe("thread-from-context");
  });

  it("uses an auto-minted thread id from the provider just as well as an explicit one", async () => {
    installCopilotKit();
    // Even if the chat-config provider auto-minted the threadId (no
    // explicit caller choice), the hook still uses it. The platform
    // accepts unknown thread ids and the writer agent still learns
    // from user-action-only threads — orphans are not a concern.
    mockUseCopilotChatConfiguration.mockReturnValue({
      threadId: "auto-minted-uuid",
      agentId: "agent-1",
      labels: {},
      isModalOpen: false,
      setModalOpen: () => undefined,
      hasExplicitThreadId: false,
    });
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useRecordUserActionInCurrentThread());
    await result.current({ title: "x" });

    expect(calls[0]!.body!.threadId).toBe("auto-minted-uuid");
  });

  it("throws on call (not on mount) when no chat config is in scope", async () => {
    installCopilotKit();
    installChatConfig(null);
    const { fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    // Mounting the hook with no config is fine.
    const { result } = renderHook(() => useRecordUserActionInCurrentThread());

    // The call throws.
    await expect(result.current({ title: "x" })).rejects.toThrow(
      /no CopilotChatConfigurationProvider/,
    );
  });

  it("throws on call when config.threadId is empty", async () => {
    installCopilotKit();
    installChatConfig("");
    const { result } = renderHook(() => useRecordUserActionInCurrentThread());
    await expect(result.current({ title: "x" })).rejects.toThrow(
      /no CopilotChatConfigurationProvider/,
    );
  });

  it("forwards all other fields verbatim", async () => {
    installCopilotKit();
    installChatConfig("thread-1");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useRecordUserActionInCurrentThread());
    await result.current({
      title: "Renamed project",
      description: "User renamed Foo to Bar",
      previousData: { name: "Foo" },
      newData: { name: "Bar" },
      metadata: { source: "settings-page" },
    });

    expect(calls[0]!.body).toMatchObject({
      threadId: "thread-1",
      title: "Renamed project",
      description: "User renamed Foo to Bar",
      previousData: { name: "Foo" },
      newData: { name: "Bar" },
      metadata: { source: "settings-page" },
    });
  });

  it("allows omitting all optional fields", async () => {
    installCopilotKit();
    installChatConfig("thread-1");
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useRecordUserActionInCurrentThread());
    // No title, no description, no data — just thread context.
    await result.current({});

    expect(calls[0]!.body!.threadId).toBe("thread-1");
    expect(calls[0]!.body).not.toHaveProperty("title");
    expect(calls[0]!.body).not.toHaveProperty("description");
  });
});
